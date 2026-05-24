import http from 'node:http';
import https from 'node:https';

export const TUNNEL_HEALTH_SCHEMA_VERSION = 1;
export const DEFAULT_TUNNEL_MODELS_URL = 'http://127.0.0.1:18001/v1/models';
export const DEFAULT_TUNNEL_TIMEOUT_MS = 3000;
export const DEFAULT_TUNNEL_COMPATIBILITY_MAX_TOKENS = 65535;

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned non-JSON response: ${text.slice(0, 120)}`);
  }
}

function bodyPreview(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

function errorTextFromBody(body) {
  if (!body) return '';
  try {
    const parsed = JSON.parse(body);
    return parsed?.error?.message || parsed?.message || bodyPreview(body);
  } catch {
    return bodyPreview(body);
  }
}

function isContextLengthFailure(text) {
  return /maximum context length|requested\s+\d+\s+tokens|max_tokens|context length/i.test(text);
}

export function chatCompletionsUrlFromModelsUrl(modelsUrl) {
  const url = new URL(modelsUrl);
  if (url.pathname.endsWith('/models')) {
    url.pathname = url.pathname.replace(/\/models$/, '/chat/completions');
  } else {
    url.pathname = url.pathname.replace(/\/?$/, '/v1/chat/completions');
  }
  url.search = '';
  return url.href;
}

export function selectTunnelModel(modelsPayload, preferredModel = '') {
  if (preferredModel) return preferredModel;
  const first = Array.isArray(modelsPayload?.data) ? modelsPayload.data[0] : null;
  const id = first?.id || first?.model;
  if (!id || typeof id !== 'string') {
    throw new Error('Models endpoint data array must include at least one model id.');
  }
  return id;
}

export function buildTunnelCompatibilityPayload({
  model,
  maxTokens = DEFAULT_TUNNEL_COMPATIBILITY_MAX_TOKENS
}) {
  return {
    model,
    messages: [
      {
        role: 'user',
        content: 'Reply with exactly OK.'
      }
    ],
    temperature: 0,
    max_tokens: maxTokens,
    stop: ['OK', '\n'],
    stream: false
  };
}

export function requestEndpoint({
  url,
  method = 'GET',
  headers = {},
  body = '',
  timeoutMs = DEFAULT_TUNNEL_TIMEOUT_MS,
  resolveOnSuccessfulHeaders = false
}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    let settled = false;

    function finish(fn, value) {
      if (settled) return;
      settled = true;
      fn(value);
    }

    const request = client.request(parsed, {
      method,
      headers,
      timeout: timeoutMs
    }, (response) => {
      const statusCode = response.statusCode || 0;
      if (resolveOnSuccessfulHeaders && statusCode >= 200 && statusCode < 300) {
        finish(resolve, {
          statusCode,
          body: '',
          acceptedOnHeaders: true
        });
        response.destroy();
        request.destroy();
        return;
      }

      const chunks = [];
      response.on('data', (chunk) => {
        chunks.push(chunk);
      });
      response.on('end', () => {
        finish(resolve, {
          statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
          acceptedOnHeaders: false
        });
      });
      response.on('error', (error) => {
        finish(reject, error);
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error(`Timed out after ${timeoutMs}ms`));
    });
    request.on('error', (error) => {
      finish(reject, error);
    });
    if (body) request.write(body);
    request.end();
  });
}

export async function checkTunnelHealth(options = {}) {
  const modelsUrl = options.modelsUrl || DEFAULT_TUNNEL_MODELS_URL;
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TUNNEL_TIMEOUT_MS);
  const request = options.request || requestEndpoint;

  const modelsResponse = await request({
    url: modelsUrl,
    method: 'GET',
    timeoutMs
  });

  if (modelsResponse.statusCode < 200 || modelsResponse.statusCode >= 300) {
    throw new Error(`Models endpoint HTTP ${modelsResponse.statusCode}: ${bodyPreview(modelsResponse.body)}`);
  }

  const modelsPayload = parseJson(modelsResponse.body, 'Models endpoint');
  if (!Array.isArray(modelsPayload.data)) {
    throw new Error('Models endpoint JSON must include a data array.');
  }

  const modelCount = modelsPayload.data.length;
  const model = modelCount > 0 ? selectTunnelModel(modelsPayload, options.model || '') : '';
  const report = {
    schemaVersion: TUNNEL_HEALTH_SCHEMA_VERSION,
    source: 'gui-agent-benchmark-tunnel-health',
    status: 'passed',
    modelsUrl,
    modelCount,
    compatibility: {
      status: options.skipCompatibility ? 'skipped' : 'pending'
    }
  };

  if (options.skipCompatibility) return report;
  if (!model) throw new Error('Models endpoint data array must include at least one model id.');

  const chatUrl = options.chatUrl || chatCompletionsUrlFromModelsUrl(modelsUrl);
  const maxTokens = Number(options.maxTokens || DEFAULT_TUNNEL_COMPATIBILITY_MAX_TOKENS);
  const payload = buildTunnelCompatibilityPayload({ model, maxTokens });
  const chatResponse = await request({
    url: chatUrl,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify(payload),
    timeoutMs
  });

  if (chatResponse.statusCode < 200 || chatResponse.statusCode >= 300) {
    const detail = errorTextFromBody(chatResponse.body);
    if (isContextLengthFailure(detail)) {
      throw new Error(
        `Chat compatibility failed with a context-length error. The local tunnel is probably pointing at direct vLLM port 8000; UI-TARS should use the proxy on remote port 8001. HTTP ${chatResponse.statusCode}: ${detail}`
      );
    }
    throw new Error(`Chat compatibility HTTP ${chatResponse.statusCode}: ${detail}`);
  }

  report.compatibility = {
    status: 'passed',
    chatUrl,
    model,
    maxTokens,
    stream: false
  };
  return report;
}
