import { snapshotState } from './state.mjs';

export const RUNS_STORAGE_KEY = 'gui-agent-benchmark:runs:v1';
export const RUNS_SCHEMA_VERSION = 1;
export const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

let fallbackStorage = null;

export function createMemoryStorage(initialValue = null) {
  const values = new Map();
  if (initialValue !== null) {
    values.set(RUNS_STORAGE_KEY, typeof initialValue === 'string' ? initialValue : JSON.stringify(initialValue));
  }

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

function storageOrDefault(storage) {
  if (storage) return storage;
  if (globalThis.localStorage) return globalThis.localStorage;
  fallbackStorage ||= createMemoryStorage();
  return fallbackStorage;
}

function toIso(timestamp = new Date()) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function isTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isJsonValue(value, seen = new Set()) {
  if (value === null) return true;
  if (['string', 'boolean'].includes(typeof value)) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;

  seen.add(value);
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item, seen));
  }

  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return false;
  }

  return Object.entries(value).every(([key, item]) => (
    typeof key === 'string' && item !== undefined && isJsonValue(item, seen)
  ));
}

function durationMs(startedAt, endedAt) {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, end - start);
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function safeValue(value) {
  if (value === undefined) return null;
  return snapshotState(value);
}

function makeRunId(timestamp) {
  const stamp = toIso(timestamp).replace(/\D/g, '');
  const suffix = Math.random().toString(36).slice(2, 8);
  const id = `run-${stamp}-${suffix}`;
  if (!RUN_ID_PATTERN.test(id)) {
    throw new Error('Generated run id failed safety validation.');
  }
  return id;
}

function stepCount(actions) {
  return actions.filter((action) => action.countsAsStep !== false).length;
}

function makeAction(action, timestamp) {
  return {
    timestamp: toIso(timestamp),
    type: action.type || 'action',
    label: action.label || action.type || 'action',
    target: action.target ?? null,
    path: action.path ?? null,
    value: safeValue(action.value),
    countsAsStep: action.countsAsStep !== false
  };
}

function timelineEntry(label, state, timestamp) {
  return {
    timestamp: toIso(timestamp),
    label,
    state: snapshotState(state)
  };
}

function readRawRuns(storage) {
  const raw = storage.getItem(RUNS_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.runs)) return parsed.runs;
    return [];
  } catch {
    return [];
  }
}

function readStoredRuns(storage) {
  return readRawRuns(storage).filter((run) => validateRun(run).length === 0);
}

function sortRuns(runs) {
  return [...runs].sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime());
}

function persistRuns(runs, storage) {
  storage.setItem(RUNS_STORAGE_KEY, JSON.stringify(runs));
}

function upsertRun(run, storage) {
  const runs = readStoredRuns(storage);
  const index = runs.findIndex((item) => item.id === run.id);
  if (index === -1) {
    runs.push(run);
  } else {
    runs[index] = run;
  }
  persistRuns(runs, storage);
  return snapshotState(run);
}

function normalizeImportPayload(payload) {
  const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.runs)) return parsed.runs;
  throw new Error('Run import must be an array or an object with a runs array.');
}

export function failureReasonForEvaluation(evaluation) {
  if (!evaluation || evaluation.success === null || evaluation.success === undefined) return null;
  if (evaluation.success === true) return null;

  const failed = Array.isArray(evaluation.details)
    ? evaluation.details.find((detail) => detail && detail.pass === false)
    : null;
  return failed?.criterion ? String(failed.criterion) : 'evaluation did not pass';
}

export function createRun({ taskId, taskTitle, state, timestamp = new Date() }) {
  const startedAt = toIso(timestamp);
  const run = {
    id: makeRunId(timestamp),
    taskId,
    taskTitle,
    startedAt,
    endedAt: null,
    durationMs: 0,
    steps: 0,
    actions: [],
    inputs: [],
    stateTimeline: [],
    evaluation: null,
    success: null,
    score: null,
    failureReason: null
  };

  return recordRunAction(run, {
    type: 'run_started',
    label: 'Reset/start run',
    target: taskId
  }, state, { timestamp, persist: false });
}

export function startRun(runOptions, storage) {
  const targetStorage = storageOrDefault(storage);
  const run = createRun(runOptions);
  return upsertRun(run, targetStorage);
}

export function recordRunAction(run, action, state = null, options = {}) {
  if (!run) return null;

  const targetStorage = storageOrDefault(options.storage);
  const timestamp = options.timestamp || new Date();
  const next = snapshotState(run);
  const entry = makeAction(action, timestamp);
  next.actions.push(entry);
  next.steps = stepCount(next.actions);
  next.durationMs = durationMs(next.startedAt, next.endedAt || entry.timestamp);

  if (state !== null && state !== undefined) {
    next.stateTimeline.push(timelineEntry(entry.label, state, timestamp));
  }

  if (options.persist === false) return next;
  return upsertRun(next, targetStorage);
}

export function recordRunInput(run, input, state = null, options = {}) {
  if (!run) return null;

  const targetStorage = storageOrDefault(options.storage);
  const timestamp = options.timestamp || new Date();
  const next = snapshotState(run);
  const inputEntry = {
    timestamp: toIso(timestamp),
    path: input.path,
    value: safeValue(input.value)
  };
  next.inputs.push(inputEntry);
  next.actions.push(makeAction({
    type: 'input_changed',
    label: input.label || `Changed ${input.path}`,
    target: input.target || input.path,
    path: input.path,
    value: input.value
  }, timestamp));
  next.steps = stepCount(next.actions);
  next.durationMs = durationMs(next.startedAt, next.endedAt || inputEntry.timestamp);

  if (state !== null && state !== undefined) {
    next.stateTimeline.push(timelineEntry(inputEntry.path, state, timestamp));
  }

  return upsertRun(next, targetStorage);
}

export function finalizeRun(run, evaluation, state = null, options = {}) {
  if (!run) return null;

  const targetStorage = storageOrDefault(options.storage);
  const timestamp = options.timestamp || new Date();
  const endedAt = toIso(timestamp);
  const next = snapshotState(run);
  const evaluationSnapshot = snapshotState(evaluation);
  const success = evaluationSnapshot?.success === true;
  const failureReason = failureReasonForEvaluation(evaluationSnapshot);

  next.actions.push(makeAction({
    type: 'evaluate_finalize',
    label: 'Evaluate/finalize',
    target: next.taskId,
    value: {
      success,
      score: evaluationSnapshot?.score ?? null,
      failureReason
    }
  }, timestamp));
  if (state !== null && state !== undefined) {
    next.stateTimeline.push(timelineEntry('Evaluate/finalize', state, timestamp));
  }

  next.evaluation = evaluationSnapshot;
  next.success = success;
  next.score = typeof evaluationSnapshot?.score === 'number' ? evaluationSnapshot.score : null;
  next.failureReason = failureReason;
  next.endedAt = endedAt;
  next.durationMs = durationMs(next.startedAt, next.endedAt);
  next.steps = stepCount(next.actions);

  return upsertRun(next, targetStorage);
}

export function listRuns(storage) {
  return sortRuns(readStoredRuns(storageOrDefault(storage))).map((run) => snapshotState(run));
}

export function getRun(id, storage) {
  return listRuns(storage).find((run) => run.id === id) || null;
}

export function clearRuns(storage) {
  storageOrDefault(storage).removeItem(RUNS_STORAGE_KEY);
}

export function exportRuns(storage) {
  return JSON.stringify({
    schemaVersion: RUNS_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    runs: listRuns(storage)
  }, null, 2);
}

export function importRuns(payload, storage) {
  const targetStorage = storageOrDefault(storage);
  const incoming = normalizeImportPayload(payload);
  const errors = incoming.flatMap((run, index) => validateRun(run).map((error) => `runs[${index}]: ${error}`));
  if (errors.length > 0) {
    throw new Error(`Invalid run import: ${errors.join('; ')}`);
  }

  const merged = new Map(readStoredRuns(targetStorage).map((run) => [run.id, run]));
  for (const run of incoming) {
    merged.set(run.id, snapshotState(run));
  }
  persistRuns([...merged.values()], targetStorage);

  const runs = listRuns(targetStorage);
  return {
    imported: incoming.length,
    total: runs.length,
    runs
  };
}

export function validateRun(run) {
  const errors = [];
  const required = [
    'id',
    'taskId',
    'taskTitle',
    'startedAt',
    'endedAt',
    'durationMs',
    'steps',
    'actions',
    'inputs',
    'stateTimeline',
    'evaluation',
    'success',
    'score',
    'failureReason'
  ];

  if (!run || typeof run !== 'object' || Array.isArray(run)) {
    return ['run must be an object'];
  }

  for (const field of required) {
    if (!(field in run)) errors.push(`missing required field ${field}`);
  }

  for (const field of ['id', 'taskId', 'taskTitle', 'startedAt']) {
    if (typeof run[field] !== 'string' || run[field].trim() === '') {
      errors.push(`${field} must be a non-empty string`);
    }
  }

  if (typeof run.id === 'string' && !RUN_ID_PATTERN.test(run.id)) {
    errors.push('id must use only letters, numbers, underscores, or hyphens and be at most 128 characters');
  }
  if (!isTimestamp(run.startedAt)) {
    errors.push('startedAt must be an ISO-compatible timestamp');
  }
  if (run.endedAt !== null && !isTimestamp(run.endedAt)) {
    errors.push('endedAt must be null or an ISO-compatible timestamp');
  }
  if (typeof run.durationMs !== 'number' || !Number.isFinite(run.durationMs) || run.durationMs < 0) {
    errors.push('durationMs must be a non-negative number');
  }
  if (!Number.isInteger(run.steps) || run.steps < 0) {
    errors.push('steps must be a non-negative integer');
  }

  for (const field of ['actions', 'inputs', 'stateTimeline']) {
    if (!Array.isArray(run[field])) errors.push(`${field} must be an array`);
  }

  if (Array.isArray(run.actions)) {
    run.actions.forEach((action, index) => {
      if (!isPlainObject(action)) {
        errors.push(`actions[${index}] must be an object`);
        return;
      }
      if (!isTimestamp(action.timestamp)) errors.push(`actions[${index}].timestamp must be an ISO-compatible timestamp`);
      if (typeof action.type !== 'string' || action.type.trim() === '') errors.push(`actions[${index}].type must be a non-empty string`);
      if (typeof action.label !== 'string' || action.label.trim() === '') errors.push(`actions[${index}].label must be a non-empty string`);
      if (action.target !== null && action.target !== undefined && typeof action.target !== 'string') errors.push(`actions[${index}].target must be null or a string`);
      if (action.path !== null && action.path !== undefined && typeof action.path !== 'string') errors.push(`actions[${index}].path must be null or a string`);
      if (typeof action.countsAsStep !== 'boolean') errors.push(`actions[${index}].countsAsStep must be a boolean`);
      if (!('value' in action) || !isJsonValue(action.value)) errors.push(`actions[${index}].value must be JSON-safe`);
    });

    const canCountSteps = run.actions.every((action) => isPlainObject(action) && typeof action.countsAsStep === 'boolean');
    const expectedSteps = canCountSteps ? stepCount(run.actions) : null;
    if (expectedSteps !== null && Number.isInteger(run.steps) && run.steps !== expectedSteps) {
      errors.push('steps must match the number of step-counted actions');
    }
  }

  if (Array.isArray(run.inputs)) {
    run.inputs.forEach((input, index) => {
      if (!isPlainObject(input)) {
        errors.push(`inputs[${index}] must be an object`);
        return;
      }
      if (!isTimestamp(input.timestamp)) errors.push(`inputs[${index}].timestamp must be an ISO-compatible timestamp`);
      if (typeof input.path !== 'string' || input.path.trim() === '') errors.push(`inputs[${index}].path must be a non-empty string`);
      if (!('value' in input) || !isJsonValue(input.value)) errors.push(`inputs[${index}].value must be JSON-safe`);
    });
  }

  if (Array.isArray(run.stateTimeline)) {
    run.stateTimeline.forEach((entry, index) => {
      if (!isPlainObject(entry)) {
        errors.push(`stateTimeline[${index}] must be an object`);
        return;
      }
      if (!isTimestamp(entry.timestamp)) errors.push(`stateTimeline[${index}].timestamp must be an ISO-compatible timestamp`);
      if (typeof entry.label !== 'string' || entry.label.trim() === '') errors.push(`stateTimeline[${index}].label must be a non-empty string`);
      if (!('state' in entry) || !isJsonValue(entry.state)) errors.push(`stateTimeline[${index}].state must be JSON-safe`);
    });
  }

  const hasEvaluation = isPlainObject(run.evaluation);
  if (run.evaluation !== null && !hasEvaluation) {
    errors.push('evaluation must be null or an object');
  }
  if (![true, false, null].includes(run.success)) {
    errors.push('success must be true, false, or null');
  }
  if (run.success !== null && run.evaluation === null) {
    errors.push('evaluation is required after a run is finalized');
  }
  if (hasEvaluation && ![true, false].includes(run.evaluation.success)) {
    errors.push('evaluation.success must be true or false');
  }
  if (hasEvaluation && 'success' in run.evaluation && run.success !== run.evaluation.success) {
    errors.push('success must match evaluation.success');
  }
  if (hasEvaluation) {
    if (typeof run.evaluation.score !== 'number' || !Number.isFinite(run.evaluation.score) || run.evaluation.score < 0 || run.evaluation.score > 1) {
      errors.push('evaluation.score must be a number between 0 and 1');
    }
    if (!Array.isArray(run.evaluation.details)) {
      errors.push('evaluation.details must be an array');
    } else {
      run.evaluation.details.forEach((detail, index) => {
        if (!isPlainObject(detail)) {
          errors.push(`evaluation.details[${index}] must be an object`);
          return;
        }
        if (typeof detail.criterion !== 'string' || detail.criterion.trim() === '') errors.push(`evaluation.details[${index}].criterion must be a non-empty string`);
        if (typeof detail.pass !== 'boolean') errors.push(`evaluation.details[${index}].pass must be a boolean`);
        if (!('expected' in detail) || !isJsonValue(detail.expected)) errors.push(`evaluation.details[${index}].expected must be JSON-safe`);
        if (!('actual' in detail) || !isJsonValue(detail.actual)) errors.push(`evaluation.details[${index}].actual must be JSON-safe`);
      });
    }
    if ('state' in run.evaluation && !isJsonValue(run.evaluation.state)) {
      errors.push('evaluation.state must be JSON-safe');
    }
  }
  if (run.score !== null && (typeof run.score !== 'number' || !Number.isFinite(run.score) || run.score < 0 || run.score > 1)) {
    errors.push('score must be null or a number');
  }
  if (hasEvaluation && typeof run.evaluation.score === 'number' && run.score !== run.evaluation.score) {
    errors.push('score must match evaluation.score');
  }
  if (run.endedAt === null && (run.success !== null || run.score !== null || run.evaluation !== null)) {
    errors.push('active runs must not include evaluation fields');
  }
  if (run.endedAt !== null && run.success === null) {
    errors.push('finalized runs must include success');
  }

  const expectedFailureReason = failureReasonForEvaluation(run.evaluation);
  if (run.success === true && run.failureReason !== null) {
    errors.push('failureReason must be null when success is true');
  } else if (run.success === false && run.failureReason !== expectedFailureReason) {
    errors.push('failureReason must match the first failed criterion');
  } else if (run.success === null && run.failureReason !== null) {
    errors.push('failureReason must be null before evaluation');
  }

  return errors;
}

export function summarizeRuns(runs) {
  const allRuns = Array.isArray(runs) ? runs : [];
  const finalizedRuns = allRuns.filter((run) => run.success !== null);
  const successfulRuns = finalizedRuns.filter((run) => run.success === true);
  const failedRuns = finalizedRuns.filter((run) => run.success === false);
  const avgSteps = allRuns.length === 0 ? 0 : round(allRuns.reduce((sum, run) => sum + run.steps, 0) / allRuns.length, 1);
  const durationRuns = allRuns.filter((run) => typeof run.durationMs === 'number');
  const avgDurationMs = durationRuns.length === 0
    ? 0
    : Math.round(durationRuns.reduce((sum, run) => sum + run.durationMs, 0) / durationRuns.length);
  const successRate = finalizedRuns.length === 0 ? 0 : round(successfulRuns.length / finalizedRuns.length, 2);

  const failureReasonMap = new Map();
  for (const run of failedRuns) {
    const reason = run.failureReason || 'evaluation did not pass';
    failureReasonMap.set(reason, (failureReasonMap.get(reason) || 0) + 1);
  }

  const taskMap = new Map();
  for (const run of allRuns) {
    const key = run.taskId;
    const stats = taskMap.get(key) || {
      taskId: run.taskId,
      taskTitle: run.taskTitle,
      totalRuns: 0,
      finalizedRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      avgSteps: 0,
      avgDurationMs: 0
    };
    stats.totalRuns += 1;
    if (run.success !== null) stats.finalizedRuns += 1;
    if (run.success === true) stats.successfulRuns += 1;
    if (run.success === false) stats.failedRuns += 1;
    stats.avgSteps += run.steps;
    stats.avgDurationMs += run.durationMs;
    taskMap.set(key, stats);
  }

  const perTask = [...taskMap.values()]
    .map((stats) => ({
      ...stats,
      successRate: stats.finalizedRuns === 0 ? 0 : round(stats.successfulRuns / stats.finalizedRuns, 2),
      avgSteps: round(stats.avgSteps / stats.totalRuns, 1),
      avgDurationMs: Math.round(stats.avgDurationMs / stats.totalRuns)
    }))
    .sort((left, right) => left.taskTitle.localeCompare(right.taskTitle));

  return {
    totalRuns: allRuns.length,
    finalizedRuns: finalizedRuns.length,
    successfulRuns: successfulRuns.length,
    failedRuns: failedRuns.length,
    activeRuns: allRuns.length - finalizedRuns.length,
    successRate,
    avgSteps,
    avgDurationMs,
    failureReasons: [...failureReasonMap.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason)),
    perTask
  };
}
