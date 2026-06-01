import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  RAW_UITARS_TRACE_SCHEMA_VERSION,
  validateRawUitarsTrace,
  validateRawUitarsTraceBundle
} from './uitars-raw-trace.mjs';
import {
  CdpWebSocket,
  assertAllowedWebSocketEndpoint,
  discoverLocalUitarsCdpEndpoint,
  fetchJson,
  makeCdpUrl,
  normalizeCdpEndpoint
} from './uitars-preflight.mjs';

const SENSITIVE_KEY_PATTERN = /^(?:webSocketDebuggerUrl|api_?key|auth|cookie|token|authorization|password)$/i;
const SCREENSHOT_KEY_PATTERN = /(?:screenshot|image|frame|base64)/i;
const SENSITIVE_TEXT_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
  /["']?(?:api_?key|auth|token|password|authorization|cookie)["']?\s*[:=]\s*["']?[^"',}\s]+/i,
  /\bwebSocketDebuggerUrl\b/i,
  /\bws:\/\/[^\s"'<>]+\/devtools\//i,
  /\/Users\/[^/\s]+\/\.ssh\b/i,
  /(^|[\s"'`])~\/\.ssh\b/i,
  /(^|[\s"'`])\/root(?:\/|[\s"'`]|$)/i,
  /\bssh\s+-L\b/i,
  /\bssh\s+[^\s]+@[^\s]+/i
];
const TASK_ACTION_ALIASES = new Map([
  ['hotkey', 'press'],
  ['key', 'press'],
  ['input', 'type']
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function timestampFrom(value, fallback) {
  const date = new Date(value || fallback);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function timestampFromMessage(message, fallback) {
  return timestampFrom(
    message?.createdAt ||
      message?.timestamp ||
      message?.time ||
      message?.timing?.start ||
      message?.timing?.end,
    fallback
  );
}

function timestampMsFromMessage(message, fallback) {
  const timestamp = timestampFromMessage(message, fallback);
  const value = Date.parse(timestamp);
  return Number.isNaN(value) ? Date.parse(fallback) : value;
}

function hasInlineImagePayload(value) {
  if (typeof value !== 'string') return false;
  const compact = value.replace(/\s/g, '');
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(compact)) return true;
  return compact.length > 512 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
}

function sanitizeForArtifact(value, key = '') {
  if (SENSITIVE_KEY_PATTERN.test(key)) return undefined;
  if (typeof value === 'string') {
    if (hasInlineImagePayload(value) || (SCREENSHOT_KEY_PATTERN.test(key) && value.length > 512)) {
      return {
        omitted: true,
        reason: 'inline screenshot/image payload omitted',
        present: true
      };
    }
    if (/\bws:\/\/[^\s"'<>]+\/devtools\//i.test(value)) return undefined;
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeForArtifact(item, key))
      .filter((item) => item !== undefined);
  }
  if (!isPlainObject(value)) return value;

  const sanitized = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    const sanitizedValue = sanitizeForArtifact(childValue, childKey);
    if (sanitizedValue !== undefined) sanitized[childKey] = sanitizedValue;
  }
  return sanitized;
}

function containsSensitiveText(text) {
  if (SENSITIVE_TEXT_PATTERNS.some((pattern) => pattern.test(text))) return true;
  for (const match of text.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
    const ip = match[0];
    const octets = ip.split('.').map((part) => Number(part));
    if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) continue;
    if (ip === '127.0.0.1' || ip.startsWith('127.')) continue;
    return true;
  }
  return false;
}

function assertNoSensitiveContent(label, value) {
  const text = JSON.stringify(value);
  if (containsSensitiveText(text)) {
    throw new Error(`${label} contains sensitive-looking content; export aborted before writing artifacts.`);
  }
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (isPlainObject(item) && typeof item.text === 'string') return item.text;
        if (isPlainObject(item) && typeof item.content === 'string') return item.content;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (isPlainObject(content)) {
    if (typeof content.text === 'string') return content.text;
    if (typeof content.content === 'string') return content.content;
    if (typeof content.message === 'string') return content.message;
  }
  return '';
}

function normalizeRole(role) {
  const lower = String(role || '').toLowerCase();
  if (lower === 'user' || lower === 'human') return 'operator';
  if (lower === 'assistant' || lower === 'gpt') return 'assistant';
  if (lower === 'tool' || lower === 'browser') return 'tool';
  if (lower === 'system') return 'system';
  if (lower === 'benchmark') return 'benchmark';
  return 'assistant';
}

function normalizeActionName(name) {
  const lower = String(name || '').trim().toLowerCase();
  return TASK_ACTION_ALIASES.get(lower) || lower;
}

function actionCandidates(message) {
  const candidates = [];
  if (isPlainObject(message?.action)) candidates.push(message.action);
  if (isPlainObject(message?.toolCall)) candidates.push(message.toolCall);
  if (isPlainObject(message?.tool_call)) candidates.push(message.tool_call);
  if (isPlainObject(message?.function_call)) candidates.push(message.function_call);
  if (Array.isArray(message?.predictionParsed)) {
    candidates.push(...message.predictionParsed.filter(isPlainObject));
  } else if (isPlainObject(message?.predictionParsed)) {
    candidates.push(message.predictionParsed);
  }
  const content = message?.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (!isPlainObject(item)) continue;
      if (item.type === 'tool_call' || item.type === 'action' || item.name || item.action) candidates.push(item);
    }
  }
  return candidates;
}

function actionFromCandidate(candidate) {
  const name = normalizeActionName(candidate.name || candidate.action || candidate.action_type || candidate.type);
  if (!name || name === 'tool_call' || name === 'action') return null;
  let args = {};
  if (isPlainObject(candidate.args)) args = candidate.args;
  else if (isPlainObject(candidate.arguments)) args = candidate.arguments;
  else if (isPlainObject(candidate.action_inputs)) args = candidate.action_inputs;
  return {
    name,
    args: sanitizeForArtifact(args) || {}
  };
}

function messageListFromState(state) {
  if (Array.isArray(state?.messages)) return state.messages;
  if (Array.isArray(state?.chatMessages)) return state.chatMessages;
  if (Array.isArray(state?.conversation?.messages)) return state.conversation.messages;
  if (Array.isArray(state?.agent?.messages)) return state.agent.messages;
  return [];
}

function normalizePromptText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function messageText(message) {
  return textFromContent(message?.content || message?.text || message?.message || message?.value);
}

function findPromptBoundaryIndex(messages, prompt) {
  const expected = normalizePromptText(prompt);
  if (!expected) return -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const role = normalizeRole(message?.role || message?.sender || message?.from);
    if (role !== 'operator') continue;
    const actual = normalizePromptText(messageText(message));
    if (actual === expected) return index;
  }
  return -1;
}

function selectRunScopedMessages({
  messages,
  prompt,
  createdAt,
  runStartedAt = '',
  requirePromptBoundary = false
}) {
  const explicitStart = runStartedAt ? Date.parse(runStartedAt) : NaN;
  if (!Number.isNaN(explicitStart)) {
    return {
      messages: messages.filter((message) => timestampMsFromMessage(message, createdAt) >= explicitStart),
      startedAt: new Date(explicitStart).toISOString(),
      boundaryFromRenderer: false
    };
  }

  const promptBoundaryIndex = findPromptBoundaryIndex(messages, prompt);
  if (promptBoundaryIndex !== -1) {
    const boundaryMessage = messages[promptBoundaryIndex];
    return {
      messages: messages.slice(promptBoundaryIndex),
      startedAt: timestampFromMessage(boundaryMessage, createdAt),
      boundaryFromRenderer: true
    };
  }

  if (requirePromptBoundary) {
    throw new Error('Live native transcript export could not find the matching prompt in UI-TARS renderer state; refusing to export unbounded stale messages.');
  }

  return {
    messages,
    startedAt: createdAt,
    boundaryFromRenderer: false
  };
}

function evaluationFromFinalCapture(finalCapture) {
  const evaluation = finalCapture?.evaluation || finalCapture?.final?.evaluation || finalCapture;
  if (!isPlainObject(evaluation)) {
    return {
      success: false,
      score: 0,
      primaryFailureCode: 'FINAL_CAPTURE_NOT_PROVIDED',
      failedCriteria: ['final capture not provided']
    };
  }
  const failedCriteria = Array.isArray(evaluation.failedCriteria)
    ? evaluation.failedCriteria
    : Array.isArray(evaluation.details)
      ? evaluation.details
        .filter((detail) => detail?.pass === false)
        .map((detail) => detail.criterion || detail.name || 'failed criterion')
      : [];
  return {
    success: Boolean(evaluation.success),
    score: Number.isFinite(evaluation.score) ? evaluation.score : 0,
    primaryFailureCode: nonEmptyString(evaluation.primaryFailureCode)
      ? evaluation.primaryFailureCode
      : Boolean(evaluation.success)
        ? 'NONE'
        : 'UNKNOWN_FAILURE',
    failedCriteria
  };
}

function artifactRefFor({ taskId, messageIndex, actionIndex }) {
  const suffix = actionIndex === null ? 'message' : `action-${String(actionIndex + 1).padStart(2, '0')}`;
  return `tasks/${taskId}/raw/message-${String(messageIndex + 1).padStart(3, '0')}-${suffix}.json`;
}

export function convertUitarsStateToRawTrace({
  state,
  taskId,
  taskTitle,
  experimentDir,
  prompt = '',
  finalCapture = null,
  createdAt = new Date().toISOString(),
  runStartedAt = '',
  requirePromptBoundary = false
}) {
  if (!nonEmptyString(taskId)) throw new Error('taskId is required.');
  if (!nonEmptyString(experimentDir)) throw new Error('experimentDir is required.');

  const scope = selectRunScopedMessages({
    messages: messageListFromState(state),
    prompt,
    createdAt,
    runStartedAt,
    requirePromptBoundary
  });
  const messages = scope.messages;
  const events = [];
  if (nonEmptyString(prompt) && !scope.boundaryFromRenderer) {
    events.push({
      id: 'uitars-message-000-prompt',
      type: 'prompt',
      role: 'operator',
      timestamp: scope.startedAt,
      text: prompt
    });
  }

  messages.forEach((message, messageIndex) => {
    const timestamp = timestampFromMessage(message, createdAt);
    const role = normalizeRole(message?.role || message?.sender || message?.from);
    const text = textFromContent(message?.content || message?.text || message?.message || message?.value);
    const actions = actionCandidates(message).map(actionFromCandidate).filter(Boolean);

    if (actions.length === 0) {
      const type = role === 'tool' ? 'tool_result' : role === 'operator' ? 'prompt' : 'observation';
      const event = {
        id: `uitars-message-${String(messageIndex + 1).padStart(3, '0')}-${type}`,
        type,
        role,
        timestamp,
        text: text || `${type.replaceAll('_', ' ')} preserved from UI-TARS renderer state`
      };
      if (type === 'tool_result') {
        event.artifactRefs = [artifactRefFor({ taskId, messageIndex, actionIndex: null })];
      }
      events.push(event);
      return;
    }

    actions.forEach((action, actionIndex) => {
      events.push({
        id: `uitars-message-${String(messageIndex + 1).padStart(3, '0')}-action-${String(actionIndex + 1).padStart(2, '0')}`,
        type: 'action',
        role: 'assistant',
        timestamp,
        text: text || `Native UI-TARS action: ${action.name}`,
        artifactRefs: [artifactRefFor({ taskId, messageIndex, actionIndex })],
        action
      });
    });
  });

  return {
    schemaVersion: RAW_UITARS_TRACE_SCHEMA_VERSION,
    source: 'ui-tars-raw-transcript',
    taskId,
    taskTitle: taskTitle || taskId,
    artifactBase: experimentDir,
    createdAt,
    runScope: {
      startedAt: scope.startedAt,
      boundary: scope.boundaryFromRenderer ? 'renderer_prompt' : runStartedAt ? 'explicit_run_started_at' : 'synthetic_prompt'
    },
    events,
    final: evaluationFromFinalCapture(finalCapture)
  };
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function buildArtifactsForRawTrace({ rawTrace, state, prompt, createdAt, runStartedAt, requirePromptBoundary }) {
  const messages = selectRunScopedMessages({
    messages: messageListFromState(state),
    prompt,
    createdAt,
    runStartedAt,
    requirePromptBoundary
  }).messages;
  const artifacts = new Map();
  for (const event of rawTrace.events) {
    for (const ref of event.artifactRefs || []) {
      const match = ref.match(/message-(\d+)-/);
      const messageIndex = match ? Number(match[1]) - 1 : -1;
      artifacts.set(ref, {
        source: 'ui-tars-renderer-state-message',
        eventId: event.id,
        message: sanitizeForArtifact(messages[messageIndex] || {}),
        action: event.action || null
      });
    }
  }
  return artifacts;
}

function validateRawTraceAndArtifactsBeforeWrite({ rawTrace, artifacts }) {
  const schemaErrors = validateRawUitarsTrace(rawTrace);
  if (schemaErrors.length > 0) {
    throw new Error(`raw UI-TARS trace is invalid; export aborted before writing artifacts: ${schemaErrors.join('; ')}`);
  }
  assertNoSensitiveContent('raw UI-TARS trace', rawTrace);
  for (const [ref, artifact] of artifacts.entries()) {
    assertNoSensitiveContent(`raw artifact ${ref}`, artifact);
  }
  for (const event of rawTrace.events) {
    for (const ref of event.artifactRefs || []) {
      if (!artifacts.has(ref)) {
        throw new Error(`raw artifact ${ref} was not prepared; export aborted before writing artifacts.`);
      }
    }
  }
}

async function writePreparedArtifacts({ rawTrace, artifacts }) {
  for (const [ref, artifact] of artifacts.entries()) {
    await writeJson(join(rawTrace.artifactBase, ref), artifact);
  }
}

export function uitarsRendererStateExpression() {
  return `(async () => {
    const screenshotKey = /(?:screenshot|image|frame|base64|webSocketDebuggerUrl)/i;
    function clean(value, key = '') {
      if (screenshotKey.test(key)) {
        return { omitted: true, reason: 'renderer payload omitted before CDP return', present: true };
      }
      if (Array.isArray(value)) return value.map((item) => clean(item, key));
      if (!value || typeof value !== 'object') return value;
      const out = {};
      for (const [childKey, childValue] of Object.entries(value)) {
        if (typeof childValue === 'function' || typeof childValue === 'undefined') continue;
        out[childKey] = clean(childValue, childKey);
      }
      return out;
    }
    const candidates = [
      ['zustandBridge.getState', () => window.zustandBridge && window.zustandBridge.getState && window.zustandBridge.getState()],
      ['store.getState', () => window.store && window.store.getState && window.store.getState()],
      ['__UI_TARS_STORE__.getState', () => window.__UI_TARS_STORE__ && window.__UI_TARS_STORE__.getState && window.__UI_TARS_STORE__.getState()]
    ];
    for (const [source, getter] of candidates) {
      try {
        const state = await getter();
        const messages = state && (
          state.messages ||
          state.chatMessages ||
          (state.conversation && state.conversation.messages) ||
          (state.agent && state.agent.messages)
        );
        if (Array.isArray(messages)) {
          return clean({ source, messages });
        }
      } catch {
        continue;
      }
    }
    throw new Error('No UI-TARS renderer state messages were found.');
  })()`;
}

function targetRank(target) {
  if (!target?.webSocketDebuggerUrl) return -1;
  if (!['page', 'webview'].includes(String(target.type || ''))) return -1;
  const haystack = `${target.title || ''} ${target.url || ''}`.toLowerCase();
  if (haystack.includes('ui-tars') || haystack.includes('local browser operator')) return 3;
  if (haystack.includes('renderer')) return 2;
  return 1;
}

function rankTargets(targets) {
  return [...targets]
    .map((target) => ({ target, rank: targetRank(target) }))
    .filter((entry) => entry.rank > 0)
    .sort((left, right) => right.rank - left.rank)
    .map((entry) => entry.target);
}

async function evaluateRendererState(target, { allowRemoteCdp = false, timeoutMs = 5000 } = {}) {
  assertAllowedWebSocketEndpoint(target.webSocketDebuggerUrl, allowRemoteCdp);
  const client = await CdpWebSocket.connect(target.webSocketDebuggerUrl, { timeoutMs });
  try {
    const result = await client.send('Runtime.evaluate', {
      expression: uitarsRendererStateExpression(),
      returnByValue: true,
      awaitPromise: true,
      userGesture: false
    }, { timeoutMs });
    const exceptionText = result?.exceptionDetails?.exception?.description ||
      result?.exceptionDetails?.exception?.value ||
      result?.exceptionDetails?.text ||
      '';
    if (exceptionText) throw new Error(exceptionText);
    const value = result?.result?.value;
    if (!isPlainObject(value) || !Array.isArray(value.messages)) {
      throw new Error('Runtime.evaluate did not return a UI-TARS messages object.');
    }
    return value;
  } finally {
    client.close();
  }
}

export async function readUitarsRendererStateFromCdp(options = {}) {
  let cdpUrl = options.cdpUrl;
  if (!cdpUrl && options.discoverLocalUitars) {
    const discovery = await discoverLocalUitarsCdpEndpoint();
    const status = discovery?.status;
    if (!['ok', 'ready'].includes(status)) {
      throw new Error(discovery?.reason || 'Unable to discover local UI-TARS CDP endpoint.');
    }
    cdpUrl = discovery.cdpUrl || discovery.endpoint;
  }
  if (!cdpUrl) throw new Error('Provide --cdp-url, UI_TARS_CDP_URL, or --discover-local-uitars for live export.');
  const normalized = normalizeCdpEndpoint(cdpUrl, { allowRemoteCdp: Boolean(options.allowRemoteCdp) });
  const targets = await fetchJson(makeCdpUrl(normalized, '/json/list'), { timeoutMs: options.timeoutMs });
  if (!Array.isArray(targets)) throw new Error('CDP /json/list did not return an array.');
  const errors = [];
  for (const target of rankTargets(targets)) {
    try {
      const state = await evaluateRendererState(target, options);
      assertNoSensitiveContent('UI-TARS renderer state', state);
      return { state, targetTitle: target.title || '', targetUrl: target.url || '' };
    } catch (error) {
      errors.push(`${target.title || target.id || 'target'}: ${error.message}`);
    }
  }
  throw new Error(`No UI-TARS renderer target yielded state messages: ${errors.join('; ')}`);
}

async function resolveLiveExportCdpEndpoints(options = {}) {
  let rendererCdpUrl = options.rendererCdpUrl || options.cdpUrl || '';
  if (!rendererCdpUrl && options.discoverLocalUitars) {
    const discovery = await discoverLocalUitarsCdpEndpoint();
    const status = discovery?.status;
    if (!['ok', 'ready'].includes(status)) {
      throw new Error(discovery?.reason || 'Unable to discover local UI-TARS CDP endpoint.');
    }
    rendererCdpUrl = discovery.cdpUrl || discovery.endpoint;
  }
  if (!rendererCdpUrl) {
    throw new Error('Provide --renderer-cdp-url, --cdp-url, UI_TARS_RENDERER_CDP_URL, UI_TARS_CDP_URL, or --discover-local-uitars for live export.');
  }

  const guardCdpUrl = options.guardCdpUrl || options.targetCdpUrl || options.cdpUrl || rendererCdpUrl;
  return { guardCdpUrl, rendererCdpUrl };
}

export async function exportUitarsNativeTranscriptFromLiveCdp(options) {
  const { guardCdpUrl, rendererCdpUrl } = await resolveLiveExportCdpEndpoints(options);
  if (options.requireLiveGuard) {
    const benchmarkUrl = options.benchmarkUrl || options.finalCapture?.benchmarkUrl;
    if (!benchmarkUrl) {
      throw new Error('Provide --benchmark-url or finalCapture.benchmarkUrl when --require-live-guard is enabled for live export.');
    }
    const { evaluateLiveTargetGuard } = await import('./uitars-live-target-guard.mjs');
    const liveGuard = await evaluateLiveTargetGuard({
      cdpUrl: guardCdpUrl,
      rendererCdpUrl,
      benchmarkUrl,
      taskId: options.taskId,
      allowRemoteCdp: options.allowRemoteCdp,
      allowRemoteBenchmark: options.allowRemoteBenchmark,
      timeoutMs: options.timeoutMs,
      requireRendererState: true
    });
    assertNoSensitiveContent('live target guard report', liveGuard);
    if (options.experimentDir && options.taskId) {
      await writeJson(join(options.experimentDir, 'tasks', options.taskId, 'raw', 'live-guard.json'), liveGuard);
    }
    if (liveGuard.verdict !== 'safe_to_prompt') {
      throw new Error(`blocked by live target guard: ${liveGuard.reason || liveGuard.verdict}`);
    }
  }
  const live = await readUitarsRendererStateFromCdp({
    ...options,
    cdpUrl: rendererCdpUrl
  });
  return exportUitarsNativeTranscriptFromState({
    ...options,
    state: live.state,
    requirePromptBoundary: options.requirePromptBoundary ?? true
  });
}

export async function exportUitarsNativeTranscriptFromState(options) {
  assertNoSensitiveContent('UI-TARS renderer state', options.state);
  const rawTrace = convertUitarsStateToRawTrace(options);
  const rawTracePath = join(options.experimentDir, 'tasks', options.taskId, 'raw-trace.json');
  const artifacts = buildArtifactsForRawTrace({
    rawTrace,
    state: options.state,
    prompt: options.prompt,
    createdAt: rawTrace.createdAt,
    runStartedAt: options.runStartedAt,
    requirePromptBoundary: Boolean(options.requirePromptBoundary)
  });
  validateRawTraceAndArtifactsBeforeWrite({ rawTrace, artifacts });
  await writePreparedArtifacts({ rawTrace, artifacts });
  await writeJson(rawTracePath, rawTrace);
  const bundleErrors = await validateRawUitarsTraceBundle(rawTrace, {
    bundleRoot: options.experimentDir
  });
  if (bundleErrors.length > 0) {
    throw new Error(`exported raw UI-TARS bundle is invalid: ${bundleErrors.join('; ')}`);
  }
  return {
    rawTrace,
    rawTracePath
  };
}

export async function readJsonFile(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
