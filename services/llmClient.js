const axios = require('axios');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const AnthropicClient = Anthropic.default || Anthropic;
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY })
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

const ANTHROPIC_FALLBACK_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-7',
  'claude-haiku-4-5-20251001'
];

const OLLAMA_RUNTIME_DIR = path.join(process.cwd(), '.ollama-runtime');
let ollamaBootstrapPromise = null;

function ollamaTimeoutMs() {
  const parsed = Number(process.env.OLLAMA_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 240000;
}

function stripCodeFence(text) {
  const raw = String(text || '').trim();
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

// Extract the first complete top-level JSON object from a response that may carry prose
// before or after it. Scans with string/escape awareness so braces inside strings — or a
// stray '}' in trailing prose — do not confuse the boundary. If the object never closes
// (truncated mid-generation) the remainder from the first '{' is returned for repair.
function extractJsonCandidate(text) {
  const raw = stripCodeFence(text);
  const start = raw.indexOf('{');
  if (start === -1) return raw;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return raw.slice(start);
}

// Deterministically close a JSON payload: drop a lone trailing backslash left mid-escape,
// terminate an open string, then close every open bracket in the correct order.
function closeOpenStructures(raw) {
  const stack = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }

  let out = raw;
  if (inString) {
    if (escaped) out = out.slice(0, -1); // drop the dangling backslash (truncated mid-escape)
    out += '"';
  }
  while (stack.length) {
    out += stack.pop() === '{' ? '}' : ']';
  }
  return out;
}

// Drop the last "atom" from a JSON fragment: a complete trailing string (back to and
// including its opening quote) or a trailing bare-token run (a partial number / true /
// false / null). Used to walk back past a value that cannot be closed cleanly.
function dropTrailingAtom(s) {
  if (!s) return '';
  if (s[s.length - 1] === '"') {
    let j = s.length - 2;
    while (j >= 0) {
      if (s[j] === '"') {
        let backslashes = 0;
        let k = j - 1;
        while (k >= 0 && s[k] === '\\') { backslashes += 1; k -= 1; }
        if (backslashes % 2 === 0) break; // unescaped quote = opening quote
      }
      j -= 1;
    }
    return s.slice(0, Math.max(0, j));
  }
  const bare = s.match(/[^{}[\],:\s"]+$/);
  if (bare) return s.slice(0, bare.index);
  return s.slice(0, -1);
}

// Best-effort recovery for JSON truncated mid-generation (the usual failure when a model
// hits its max_tokens ceiling). Repeatedly: trim dangling separators, close open structures,
// and try to parse; if that still fails, drop the last atom and retry. Bounded by the input
// length so it always terminates.
function repairTruncatedJson(candidate) {
  let raw = String(candidate || '');
  for (let guard = 0; guard < 500 && raw.length; guard += 1) {
    const trimmed = raw.replace(/[,:\s]+$/, '');
    if (!trimmed) break;
    const closed = closeOpenStructures(trimmed);
    try {
      JSON.parse(closed);
      return closed;
    } catch (_err) {
      const shorter = dropTrailingAtom(trimmed);
      if (shorter.length >= trimmed.length) break;
      raw = shorter;
    }
  }
  return closeOpenStructures(raw.replace(/[,:\s]+$/, ''));
}

// Parse model JSON tolerantly: strip prose/fences, then repair truncation if needed.
function parseJsonLoose(content) {
  const candidate = extractJsonCandidate(content);
  try {
    return { data: JSON.parse(candidate), repaired: false };
  } catch (_err) {
    const repaired = repairTruncatedJson(candidate);
    return { data: JSON.parse(repaired), repaired: true };
  }
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
  const anthropicModel = process.env.ANTHROPIC_MODEL || ANTHROPIC_FALLBACK_MODELS[0];
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
    },
    anthropic: {
      key: 'anthropic',
      label: 'Anthropic',
      available: Boolean(anthropic),
      models: anthropic ? ANTHROPIC_FALLBACK_MODELS : [],
      default_model: anthropicModel,
      error: anthropic ? '' : 'Anthropic API key is not configured.'
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

async function callAnthropic({ systemPrompt, userPrompt, temperature = 0.35, maxTokens = 1200, json = false, model }) {
  if (!anthropic) throw new Error('Anthropic API key is not configured');
  const resolvedModel = model || process.env.ANTHROPIC_MODEL || ANTHROPIC_FALLBACK_MODELS[0];
  const effectiveSystem = json
    ? `${systemPrompt}\n\nYou must respond with valid JSON only. Do not include any text outside the JSON object.`
    : systemPrompt;

  const response = await anthropic.messages.create({
    model: resolvedModel,
    max_tokens: maxTokens,
    temperature,
    system: effectiveSystem,
    messages: [{ role: 'user', content: userPrompt }]
  });

  return {
    backend: 'anthropic',
    model: resolvedModel,
    content: response.content[0]?.text || ''
  };
}

async function generateText(opts) {
  const preferredBackend = opts.backend || process.env.WRITING_AGENT_BACKEND || 'ollama';

  if (preferredBackend === 'anthropic') {
    try {
      return await callAnthropic(opts);
    } catch (anthropicErr) {
      if (!openai) throw anthropicErr;
      const fallback = await callOpenAI({
        ...opts,
        model: opts.openaiModel || process.env.OPENAI_MODEL || OPENAI_FALLBACK_MODELS[0]
      });
      return { ...fallback, fallback_reason: anthropicErr.message };
    }
  }

  if (preferredBackend === 'openai') {
    try {
      return await callOpenAI(opts);
    } catch (openaiErr) {
      const ollamaResult = await callOllama({
        ...opts,
        model: opts.ollamaModel || process.env.OLLAMA_MODEL || OLLAMA_FALLBACK_MODELS[0]
      });
      return { ...ollamaResult, fallback_reason: openaiErr.message };
    }
  }

  try {
    return await callOllama(opts);
  } catch (ollamaErr) {
    if (anthropic) {
      const fallback = await callAnthropic({
        ...opts,
        model: opts.anthropicModel || process.env.ANTHROPIC_MODEL || ANTHROPIC_FALLBACK_MODELS[0]
      });
      return { ...fallback, fallback_reason: ollamaErr.message };
    }
    if (openai) {
      const fallback = await callOpenAI({
        ...opts,
        model: opts.openaiModel || process.env.OPENAI_MODEL || OPENAI_FALLBACK_MODELS[0]
      });
      return { ...fallback, fallback_reason: ollamaErr.message };
    }
    throw new Error(`Ollama failed and no cloud fallback is configured: ${ollamaErr.message}`);
  }
}

async function generateJson(opts) {
  const result = await generateText({ ...opts, json: true });
  try {
    const { data, repaired } = parseJsonLoose(result.content);
    return {
      ...result,
      data,
      json_repaired: repaired || undefined
    };
  } catch (parseErr) {
    throw new Error(`JSON parse failed: ${parseErr.message}. Raw (first 200 chars): ${String(result.content || '').slice(0, 200)}`);
  }
}

module.exports = {
  generateText,
  generateJson,
  stripCodeFence,
  parseJsonLoose,
  listWritingBackends
};
