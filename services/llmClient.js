const axios = require('axios');
const OpenAI = require('openai');
const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const OLLAMA_FALLBACK_MODELS = [
  'phi3:latest',
  'mistral:latest',
  'llama2:latest',
  'qwen3:8b',
  'qwen2.5:7b',
  'llama3.1:8b',
  'mistral:7b'
];

const OPENAI_FALLBACK_MODELS = [
  'gpt-4o',
  'gpt-4.1',
  'gpt-4.1-mini'
];

const OLLAMA_RUNTIME_DIR = path.join(process.cwd(), '.ollama-runtime');
let ollamaBootstrapPromise = null;

function ollamaTimeoutMs() {
  return Number(process.env.OLLAMA_TIMEOUT_MS || 240000);
}

function stripCodeFence(text) {
  const raw = String(text || '').trim();
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function ollamaBaseUrl() {
  return (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function probeOllama() {
  try {
    const response = await axios.get(`${ollamaBaseUrl()}/api/tags`, {
      timeout: Math.min(ollamaTimeoutMs(), 5000)
    });
    return Array.isArray(response.data?.models) ? response.data.models : [];
  } catch (_error) {
    return null;
  }
}

function resolveOllamaExecutable() {
  const candidates = [
    process.env.OLLAMA_PATH,
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
    'ollama'
  ].filter(Boolean);
  return candidates[0];
}

async function ensureOllamaServer() {
  const existing = await probeOllama();
  if (existing) return true;
  if (ollamaBootstrapPromise) return ollamaBootstrapPromise;

  ollamaBootstrapPromise = (async () => {
    await fs.mkdir(OLLAMA_RUNTIME_DIR, { recursive: true });
    const exe = resolveOllamaExecutable();
    const child = spawn(exe, ['serve'], {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...process.env,
        LOCALAPPDATA: OLLAMA_RUNTIME_DIR
      }
    });
    child.unref();

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await delay(1000);
      const models = await probeOllama();
      if (models) {
        ollamaBootstrapPromise = null;
        return true;
      }
    }

    ollamaBootstrapPromise = null;
    return false;
  })();

  return ollamaBootstrapPromise;
}

async function callOllama({ systemPrompt, userPrompt, temperature = 0.35, maxTokens = 1200, json = false, model }) {
  const baseURL = ollamaBaseUrl();
  const resolvedModel = model || process.env.OLLAMA_MODEL || OLLAMA_FALLBACK_MODELS[0];

  let response;
  try {
    response = await axios.post(
      `${baseURL}/api/chat`,
      {
        model: resolvedModel,
        stream: false,
        format: json ? 'json' : undefined,
        options: {
          temperature,
          num_predict: maxTokens
        },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      },
      {
        timeout: ollamaTimeoutMs()
      }
    );
  } catch (error) {
    const booted = await ensureOllamaServer();
    if (!booted) throw error;
    response = await axios.post(
      `${baseURL}/api/chat`,
      {
        model: resolvedModel,
        stream: false,
        format: json ? 'json' : undefined,
        options: {
          temperature,
          num_predict: maxTokens
        },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      },
      {
        timeout: ollamaTimeoutMs()
      }
    );
  }

  return {
    backend: 'ollama',
    model: resolvedModel,
    content: response.data?.message?.content || ''
  };
}

async function fetchOllamaModels() {
  try {
    const response = await axios.get(`${ollamaBaseUrl()}/api/tags`, {
      timeout: Math.min(ollamaTimeoutMs(), 5000)
    });

    return (response.data?.models || [])
      .map(model => model?.name)
      .filter(Boolean);
  } catch (error) {
    const booted = await ensureOllamaServer();
    if (!booted) throw error;
    const response = await axios.get(`${ollamaBaseUrl()}/api/tags`, {
      timeout: Math.min(ollamaTimeoutMs(), 5000)
    });
    return (response.data?.models || [])
      .map(model => model?.name)
      .filter(Boolean);
  }
}

async function fetchOpenAIModels() {
  if (!openai) return [];

  try {
    const response = await openai.models.list();
    return (response.data || [])
      .map(model => model?.id)
      .filter(id => /^gpt-(4o|4\.1)/.test(id))
      .sort();
  } catch (_error) {
    return [];
  }
}

async function listWritingBackends() {
  const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o';
  const backends = {
    ollama: {
      key: 'ollama',
      label: 'Ollama',
      available: false,
      models: [],
      error: ''
    },
    openai: {
      key: 'openai',
      label: 'OpenAI',
      available: Boolean(openai),
      models: openai ? [openaiModel] : [],
      error: openai ? '' : 'OpenAI API key is not configured.'
    }
  };

  try {
    const models = await fetchOllamaModels();
    backends.ollama.available = models.length > 0;
    backends.ollama.models = models.length ? models : OLLAMA_FALLBACK_MODELS;
    backends.ollama.error = models.length ? '' : 'No Ollama models were returned by the local server.';
  } catch (error) {
    backends.ollama.available = false;
    backends.ollama.models = OLLAMA_FALLBACK_MODELS;
    backends.ollama.error = error.message;
  }

  if (openai) {
    const models = await fetchOpenAIModels();
    backends.openai.models = models.length ? models : OPENAI_FALLBACK_MODELS;
  }

  return backends;
}

async function callOpenAI({ systemPrompt, userPrompt, temperature = 0.35, maxTokens = 1200, json = false, model }) {
  if (!openai) throw new Error('OpenAI API key is not configured');
  const resolvedModel = model || process.env.OPENAI_MODEL || 'gpt-4o';
  const response = await openai.chat.completions.create({
    model: resolvedModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    response_format: json ? { type: 'json_object' } : undefined,
    temperature,
    max_tokens: maxTokens
  });

  return {
    backend: 'openai',
    model: resolvedModel,
    content: response.choices[0]?.message?.content || ''
  };
}

async function generateText(opts) {
  const preferredBackend = opts.backend || process.env.WRITING_AGENT_BACKEND || 'ollama';
  if (preferredBackend === 'openai') {
    try {
      return await callOpenAI(opts);
    } catch (openaiErr) {
      const ollamaResult = await callOllama({
        ...opts,
        model: opts.ollamaModel || process.env.OLLAMA_MODEL || OLLAMA_FALLBACK_MODELS[0]
      });
      return {
        ...ollamaResult,
        fallback_reason: openaiErr.message
      };
    }
  }

  try {
    return await callOllama(opts);
  } catch (ollamaErr) {
    if (!openai) {
      throw new Error(`Ollama failed and no OpenAI fallback is configured: ${ollamaErr.message}`);
    }
    const fallback = await callOpenAI({
      ...opts,
      model: opts.openaiModel || process.env.OPENAI_MODEL || OPENAI_FALLBACK_MODELS[0]
    });
    return {
      ...fallback,
      fallback_reason: ollamaErr.message
    };
  }
}

async function generateJson(opts) {
  const result = await generateText({ ...opts, json: true });
  return {
    ...result,
    data: JSON.parse(stripCodeFence(result.content))
  };
}

module.exports = {
  generateText,
  generateJson,
  stripCodeFence,
  listWritingBackends
};
