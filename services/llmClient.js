const axios = require('axios');
const OpenAI = require('openai');

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const OLLAMA_FALLBACK_MODELS = [
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

function stripCodeFence(text) {
  const raw = String(text || '').trim();
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

async function callOllama({ systemPrompt, userPrompt, temperature = 0.35, maxTokens = 1200, json = false, model }) {
  const baseURL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const resolvedModel = model || process.env.OLLAMA_MODEL || 'qwen3.5:8b';

  const response = await axios.post(
    `${baseURL.replace(/\/$/, '')}/api/chat`,
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
      timeout: Number(process.env.OLLAMA_TIMEOUT_MS || 90000)
    }
  );

  return {
    backend: 'ollama',
    model: resolvedModel,
    content: response.data?.message?.content || ''
  };
}

async function fetchOllamaModels() {
  const baseURL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const response = await axios.get(`${baseURL.replace(/\/$/, '')}/api/tags`, {
    timeout: Number(process.env.OLLAMA_TIMEOUT_MS || 5000)
  });

  return (response.data?.models || [])
    .map(model => model?.name)
    .filter(Boolean);
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
        model: opts.ollamaModel || process.env.OLLAMA_MODEL || opts.model
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
    const fallback = await callOpenAI(opts);
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
