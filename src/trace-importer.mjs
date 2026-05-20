import { evaluateTask } from './judge.mjs';
import {
  RUN_ID_PATTERN,
  failureReasonForEvaluation,
  importRuns,
  validateRun
} from './runs.mjs';

const TRACE_VERSION = 1;
const INPUT_EVENT_TYPES = new Set([
  'change',
  'fill',
  'input',
  'input_changed',
  'input_text',
  'set_value',
  'text_input',
  'type'
]);

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function normalizeOptions(storageOrOptions, maybeOptions = {}) {
  if (storageOrOptions && typeof storageOrOptions.getItem === 'function') {
    return {
      storage: storageOrOptions,
      tasks: Array.isArray(maybeOptions.tasks) ? maybeOptions.tasks : []
    };
  }

  const options = storageOrOptions || {};
  return {
    storage: options.storage,
    tasks: Array.isArray(options.tasks) ? options.tasks : []
  };
}

function assertJsonSafe(value, path, seen = new Set()) {
  if (value === null) return;
  if (['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} must be JSON-safe`);
    return;
  }
  if (typeof value !== 'object') {
    throw new Error(`${path} must be JSON-safe`);
  }
  if (seen.has(value)) {
    throw new Error(`${path} must be JSON-safe`);
  }
  if (!Array.isArray(value) && !isPlainObject(value)) {
    throw new Error(`${path} must be JSON-safe`);
  }

  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonSafe(item, `${path}[${index}]`, seen));
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) throw new Error(`${path}.${key} must be JSON-safe`);
      assertJsonSafe(item, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function normalizeTimestamp(value, path) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${path} must be an ISO-compatible timestamp`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${path} must be an ISO-compatible timestamp`);
  }
  return date.toISOString();
}

function normalizeOptionalTimestamp(value, path, { allowNull = false } = {}) {
  if (value === undefined || (allowNull && value === null)) return null;
  return normalizeTimestamp(value, path);
}

function durationMs(startedAt, endedAt) {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, end - start);
}

function compactTimestamp(timestamp) {
  return timestamp.replace(/\D/g, '').slice(0, 17);
}

function makeRunId(startedAt, traceIndex) {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `trace-${compactTimestamp(startedAt)}-${traceIndex + 1}-${suffix}`;
}

function normalizeRunId(trace, traceIndex, startedAt, path) {
  const rawId = trace.runId ?? trace.id ?? trace.traceId;
  if (rawId === undefined || rawId === null) return makeRunId(startedAt, traceIndex);
  if (typeof rawId !== 'string' || rawId.trim() === '') {
    throw new Error(`${path}.id must be a non-empty string when provided`);
  }
  if (!RUN_ID_PATTERN.test(rawId)) {
    throw new Error(`${path}.id must use only letters, numbers, underscores, or hyphens and be at most 128 characters`);
  }
  return rawId;
}

function findTask(tasks, taskId) {
  return tasks.find((task) => task.id === taskId) || null;
}

function assertTaskRegistry(tasks, path) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error(`${path} requires a non-empty task registry for trace imports`);
  }
}

function humanizeType(type) {
  return type
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function nullableString(value, path) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error(`${path} must be null or a string`);
  return value;
}

function requiredString(value, path) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function contextKey(type, field) {
  return [type, field].filter(Boolean).join('.');
}

function looksLikeImageData(value, key = '') {
  if (typeof value !== 'string') return false;
  const compact = value.replace(/\s/g, '');
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(compact)) return true;
  if (!/(base64|frame|image|screenshot|thumbnail)/i.test(key)) return false;
  return compact.length > 512 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
}

function summarizeImageData(value) {
  const compact = value.replace(/\s/g, '');
  const match = compact.match(/^data:(image\/[a-z0-9.+-]+);base64,/i);
  const payloadLength = match ? compact.slice(match[0].length).length : compact.length;
  return {
    omitted: 'base64 image data',
    mediaType: match ? match[1] : 'image/*',
    chars: payloadLength
  };
}

function sanitizeForRun(value, path, key = '', seen = new Set()) {
  if (looksLikeImageData(value, key)) return summarizeImageData(value);
  if (value === null) return null;
  if (['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} must be JSON-safe`);
    return value;
  }
  if (typeof value !== 'object') {
    throw new Error(`${path} must be JSON-safe`);
  }
  if (seen.has(value)) {
    throw new Error(`${path} must be JSON-safe`);
  }
  if (Array.isArray(value)) {
    seen.add(value);
    const sanitized = value.map((item, index) => sanitizeForRun(item, `${path}[${index}]`, key, seen));
    seen.delete(value);
    return sanitized;
  }
  if (!isPlainObject(value)) {
    throw new Error(`${path} must be JSON-safe`);
  }

  seen.add(value);
  const sanitized = {};
  for (const [itemKey, item] of Object.entries(value)) {
    if (item === undefined) throw new Error(`${path}.${itemKey} must be JSON-safe`);
    sanitized[itemKey] = sanitizeForRun(item, `${path}.${itemKey}`, contextKey(key, itemKey), seen);
  }
  seen.delete(value);
  return sanitized;
}

function parseJsonl(text, jsonError) {
  const lines = text.split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter((entry) => entry.line !== '');
  if (lines.length === 0) throw new Error('Import payload is empty.');

  const traces = [];
  for (const entry of lines) {
    let parsed;
    try {
      parsed = JSON.parse(entry.line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Import payload must be valid JSON or JSONL. JSON parse failed: ${jsonError.message}; JSONL line ${entry.number} failed: ${message}`);
    }
    if (!isPlainObject(parsed) || !Array.isArray(parsed.events)) {
      throw new Error(`JSONL line ${entry.number} must be a complete trace object with an events array. Event-stream JSONL is not supported yet.`);
    }
    traces.push(parsed);
  }

  return { kind: 'traces', traces };
}

function classifyParsedPayload(parsed) {
  if (Array.isArray(parsed) || Array.isArray(parsed?.runs)) {
    return { kind: 'runs', payload: parsed };
  }
  if (Array.isArray(parsed?.traces)) {
    return { kind: 'traces', traces: parsed.traces };
  }
  if (isPlainObject(parsed) && (
    hasOwn(parsed, 'events')
    || hasOwn(parsed, 'taskId')
    || hasOwn(parsed, 'traceVersion')
    || hasOwn(parsed, 'source')
  )) {
    return { kind: 'traces', traces: [parsed] };
  }
  throw new Error('Import payload must be an existing run export, a trace object, a { traces } wrapper, or JSONL trace objects.');
}

export function parseTraceImportPayload(payload) {
  if (typeof payload !== 'string') return classifyParsedPayload(payload);

  const text = payload.trim();
  if (!text) throw new Error('Import payload is empty.');
  try {
    return classifyParsedPayload(JSON.parse(text));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return parseJsonl(text, error);
  }
}

function eventType(event, path) {
  const type = event.type ?? event.action ?? event.kind;
  return requiredString(type, `${path}.type`);
}

function actionValueFromEvent(event, path, type) {
  const parts = {};
  const mappings = [
    ['value', 'value'],
    ['text', 'text'],
    ['inputValue', 'inputValue'],
    ['metadata', 'metadata'],
    ['details', 'details'],
    ['observation', 'observation'],
    ['screenshot', 'screenshot'],
    ['screenshotRef', 'screenshotRef'],
    ['screenshotPath', 'screenshotPath'],
    ['screenshotUrl', 'screenshotUrl'],
    ['image', 'image'],
    ['url', 'url'],
    ['coordinates', 'coordinates']
  ];

  for (const [field, outputField] of mappings) {
    if (hasOwn(event, field)) {
      parts[outputField] = sanitizeForRun(event[field], `${path}.${field}`, contextKey(type, field));
    }
  }

  const keys = Object.keys(parts);
  if (keys.length === 0) return null;
  if (keys.length === 1 && hasOwn(parts, 'value')) return parts.value;
  return parts;
}

function inputValueFromEvent(event, path, type) {
  if (hasOwn(event, 'value')) return sanitizeForRun(event.value, `${path}.value`, contextKey(type, 'value'));
  if (hasOwn(event, 'inputValue')) return sanitizeForRun(event.inputValue, `${path}.inputValue`, contextKey(type, 'inputValue'));
  if (hasOwn(event, 'text')) return sanitizeForRun(event.text, `${path}.text`, contextKey(type, 'text'));
  return null;
}

function isInputLike(event, type) {
  return event.input === true || INPUT_EVENT_TYPES.has(type);
}

function normalizeEvent(event, eventIndex, timestamp, tracePath) {
  const path = `${tracePath}.events[${eventIndex}]`;
  if (!isPlainObject(event)) throw new Error(`${path} must be an object`);

  const type = eventType(event, path);
  const label = event.label === undefined
    ? humanizeType(type)
    : requiredString(event.label, `${path}.label`);
  const target = nullableString(event.target, `${path}.target`);
  const actionPath = nullableString(event.path, `${path}.path`);
  if (event.countsAsStep !== undefined && typeof event.countsAsStep !== 'boolean') {
    throw new Error(`${path}.countsAsStep must be a boolean`);
  }

  const action = {
    timestamp,
    type,
    label,
    target,
    path: actionPath,
    value: actionValueFromEvent(event, path, type),
    countsAsStep: event.countsAsStep !== false
  };

  let input = null;
  if (isInputLike(event, type)) {
    const inputPath = actionPath || target;
    if (!inputPath) {
      throw new Error(`${path}.path is required for input-like events`);
    }
    input = {
      timestamp,
      path: inputPath,
      value: inputValueFromEvent(event, path, type)
    };
  }

  const stateTimelineEntry = hasOwn(event, 'state')
    ? {
      timestamp,
      label,
      state: sanitizeForRun(event.state, `${path}.state`, 'state')
    }
    : null;

  return { action, input, stateTimelineEntry };
}

function stepCount(actions) {
  return actions.filter((action) => action.countsAsStep !== false).length;
}

function validateTaskId(trace, tasks, path) {
  const taskId = requiredString(trace.taskId, `${path}.taskId`);
  assertTaskRegistry(tasks, `${path}.taskId`);
  const task = findTask(tasks, taskId);
  if (!task) {
    throw new Error(`${path}.taskId references unknown task "${taskId}"`);
  }
  return { taskId, task };
}

function normalizeTraceEvaluation(trace, taskId, tasks, finalState, endedAt, path) {
  const hasEvaluation = hasOwn(trace, 'evaluation');
  if (hasEvaluation) {
    if (!isPlainObject(trace.evaluation)) throw new Error(`${path}.evaluation must be an object`);
    const evaluation = sanitizeForRun(trace.evaluation, `${path}.evaluation`, 'evaluation');
    const success = evaluation.success === true;
    return {
      endedAt,
      evaluation,
      success,
      score: typeof evaluation.score === 'number' ? evaluation.score : null,
      failureReason: failureReasonForEvaluation(evaluation)
    };
  }

  if (finalState !== null) {
    let evaluation;
    try {
      evaluation = evaluateTask(taskId, finalState, tasks);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${path}.finalState could not be evaluated: ${message}`);
    }
    return {
      endedAt,
      evaluation,
      success: evaluation.success,
      score: evaluation.score,
      failureReason: failureReasonForEvaluation(evaluation)
    };
  }

  return {
    endedAt: null,
    evaluation: null,
    success: null,
    score: null,
    failureReason: null
  };
}

export function traceToRun(trace, traceIndex = 0, tasks = []) {
  const path = `traces[${traceIndex}]`;
  if (!isPlainObject(trace)) throw new Error(`${path} must be an object`);
  assertJsonSafe(trace, path);

  if (trace.traceVersion !== undefined && trace.traceVersion !== TRACE_VERSION) {
    throw new Error(`${path}.traceVersion must be 1 when provided`);
  }
  if (trace.source !== undefined && typeof trace.source !== 'string') {
    throw new Error(`${path}.source must be a string when provided`);
  }
  if (!Array.isArray(trace.events)) {
    throw new Error(`${path}.events must be an array`);
  }

  const { taskId, task } = validateTaskId(trace, tasks, path);
  const taskTitle = trace.taskTitle === undefined
    ? task?.title || taskId
    : requiredString(trace.taskTitle, `${path}.taskTitle`);

  const eventTimestamps = trace.events.map((event, index) => {
    if (isPlainObject(event) && hasOwn(event, 'timestamp')) {
      return normalizeTimestamp(event.timestamp, `${path}.events[${index}].timestamp`);
    }
    return null;
  });
  const traceStartedAt = normalizeOptionalTimestamp(trace.startedAt, `${path}.startedAt`);
  const startedAt = traceStartedAt || eventTimestamps.find(Boolean) || new Date().toISOString();

  const actions = [];
  const inputs = [];
  const stateTimeline = [];
  trace.events.forEach((event, index) => {
    const timestamp = eventTimestamps[index] || startedAt;
    const normalized = normalizeEvent(event, index, timestamp, path);
    actions.push(normalized.action);
    if (normalized.input) inputs.push(normalized.input);
    if (normalized.stateTimelineEntry) stateTimeline.push(normalized.stateTimelineEntry);
  });

  const lastEventTimestamp = [...eventTimestamps].reverse().find(Boolean) || startedAt;
  const traceEndedAt = normalizeOptionalTimestamp(trace.endedAt, `${path}.endedAt`, { allowNull: true });
  const hasFinalState = hasOwn(trace, 'finalState');
  const finalState = hasFinalState ? sanitizeForRun(trace.finalState, `${path}.finalState`, 'finalState') : null;
  if (hasFinalState && !isPlainObject(finalState)) {
    throw new Error(`${path}.finalState must be an object when provided`);
  }

  const finalizedAt = traceEndedAt || lastEventTimestamp;
  const normalizedEvaluation = normalizeTraceEvaluation(trace, taskId, tasks, finalState, finalizedAt, path);
  if (finalState !== null) {
    stateTimeline.push({
      timestamp: normalizedEvaluation.endedAt || lastEventTimestamp,
      label: 'Final state',
      state: finalState
    });
  }

  const durationEnd = normalizedEvaluation.endedAt || lastEventTimestamp;
  const run = {
    id: normalizeRunId(trace, traceIndex, startedAt, path),
    taskId,
    taskTitle,
    startedAt,
    endedAt: normalizedEvaluation.endedAt,
    durationMs: durationMs(startedAt, durationEnd),
    steps: stepCount(actions),
    actions,
    inputs,
    stateTimeline,
    evaluation: normalizedEvaluation.evaluation,
    success: normalizedEvaluation.success,
    score: normalizedEvaluation.score,
    failureReason: normalizedEvaluation.failureReason
  };

  const errors = validateRun(run);
  if (errors.length > 0) {
    throw new Error(`${path} produced an invalid run: ${errors.join('; ')}`);
  }
  return run;
}

export function tracesToRuns(traces, tasks = []) {
  if (!Array.isArray(traces)) throw new Error('traces must be an array');
  assertTaskRegistry(tasks, 'traces');
  return traces.map((trace, index) => traceToRun(trace, index, tasks));
}

export function importExternalRuns(payload, storageOrOptions, maybeOptions) {
  const { storage, tasks } = normalizeOptions(storageOrOptions, maybeOptions);
  const parsed = parseTraceImportPayload(payload);
  if (parsed.kind === 'runs') return importRuns(parsed.payload, storage);
  assertTaskRegistry(tasks, 'Trace import');
  return importRuns({ runs: tracesToRuns(parsed.traces, tasks) }, storage);
}
