import { access, readFile, realpath } from 'node:fs/promises';

import {
  validateRawUitarsTrace,
  validateRawUitarsTraceBundle
} from './uitars-raw-trace.mjs';

export const NATIVE_ACTION_EVIDENCE_GATE_SCHEMA_VERSION = 1;
export const NATIVE_ACTION_EVIDENCE_SUMMARY_SOURCE = 'ui-tars-native-task-action-transcript-smoke';
export const DEFAULT_NATIVE_ACTION_EVIDENCE_EXPERIMENT_DIR = 'experiments/2026-05-29-p2-native-action-evidence';
export const NATIVE_ACTION_TRANSCRIPT_STATUSES = Object.freeze([
  'native_task_actions_captured',
  'visible_transcript_only',
  'invalid_native_transcript',
  'missing_native_transcript'
]);
export const TASK_EXECUTION_ACTION_NAMES = Object.freeze([
  'click',
  'type',
  'fill',
  'select',
  'press',
  'submit',
  'drag',
  'check',
  'uncheck'
]);

const TASK_EXECUTION_ACTION_SET = new Set(TASK_EXECUTION_ACTION_NAMES);
const NATIVE_ACTION_TRANSCRIPT_STATUS_SET = new Set(NATIVE_ACTION_TRANSCRIPT_STATUSES);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function isInsideDirectory(root, path) {
  return path === root || path.startsWith(`${root}/`);
}

async function realpathOrError(path, label, errors) {
  try {
    return await realpath(path);
  } catch (error) {
    errors.push(`${label}: ${error.message}`);
    return '';
  }
}

function taskActionCount(rawTrace) {
  const events = Array.isArray(rawTrace?.events) ? rawTrace.events : [];
  return events.filter((event) => {
    const name = String(event?.action?.name || '').toLowerCase();
    return event?.type === 'action' && TASK_EXECUTION_ACTION_SET.has(name);
  }).length;
}

function timestampMs(value) {
  const parsed = Date.parse(value || '');
  return Number.isNaN(parsed) ? null : parsed;
}

function firstFinalBoundaryTime(events, promptTime) {
  const finalTimes = events
    .filter((event) => event?.type === 'capture' || event?.type === 'judge_result')
    .map((event) => timestampMs(event?.timestamp))
    .filter((time) => time !== null && time >= promptTime);
  return finalTimes.length > 0 ? Math.min(...finalTimes) : null;
}

export function validateNativeActionRunScope(rawTrace, { rawTracePath = 'rawTrace' } = {}) {
  const errors = [];
  const events = Array.isArray(rawTrace?.events) ? rawTrace.events : [];
  const promptEvent = events.find((event) => event?.type === 'prompt' && event?.role === 'operator');
  if (!promptEvent) {
    errors.push(`${rawTracePath}: at least one operator prompt event is required to define the run boundary`);
    return errors;
  }

  const promptTime = timestampMs(promptEvent.timestamp);
  if (promptTime === null) {
    errors.push(`${rawTracePath}: prompt event ${promptEvent.id || 'unknown'} must have a valid timestamp`);
    return errors;
  }

  const finalTime = firstFinalBoundaryTime(events, promptTime);
  let previousTime = null;
  for (const event of events) {
    const currentTime = timestampMs(event?.timestamp);
    if (currentTime === null) continue;
    if (previousTime !== null && currentTime < previousTime) {
      errors.push(`${rawTracePath}: event ${event.id || 'unknown'} timestamp is earlier than a preceding event`);
    }
    previousTime = currentTime;
    if (event?.type === 'action' && currentTime < promptTime) {
      errors.push(`${rawTracePath}: action event ${event.id || 'unknown'} occurs before the operator prompt boundary`);
    }
    if (event?.type === 'action' && finalTime !== null && currentTime > finalTime) {
      errors.push(`${rawTracePath}: action event ${event.id || 'unknown'} occurs after the final capture/judge boundary`);
    }
  }

  return errors;
}

function addSummaryConsistencyErrors({ summaryTask, rawTrace, rawTracePath, errors }) {
  if (rawTrace.taskId !== summaryTask.taskId) {
    errors.push(`${rawTracePath}: rawTrace.taskId must match summary taskId ${summaryTask.taskId}`);
  }
  if (summaryTask.transcriptStatus !== 'native_task_actions_captured') {
    errors.push(`${summaryTask.taskId}: transcriptStatus must be native_task_actions_captured for P2 evidence gate`);
  }
  if (summaryTask.rawTracePath !== rawTracePath) {
    errors.push(`${summaryTask.taskId}: rawTracePath must match the preserved raw trace path`);
  }
  if (typeof summaryTask.taskActionCount !== 'number' || summaryTask.taskActionCount < 1) {
    errors.push(`${summaryTask.taskId}: taskActionCount must be at least 1 for P2 evidence gate`);
  }
}

function countTranscriptStatuses(tasks) {
  const counts = Object.fromEntries(NATIVE_ACTION_TRANSCRIPT_STATUSES.map((status) => [status, 0]));
  for (const task of tasks || []) {
    if (isPlainObject(task) && NATIVE_ACTION_TRANSCRIPT_STATUS_SET.has(task.transcriptStatus)) {
      counts[task.transcriptStatus] += 1;
    }
  }
  return counts;
}

function validateSummaryMetadata(summary, errors) {
  if (!isPlainObject(summary)) return;
  if (summary.schemaVersion !== NATIVE_ACTION_EVIDENCE_GATE_SCHEMA_VERSION) {
    errors.push(`summary.schemaVersion must be ${NATIVE_ACTION_EVIDENCE_GATE_SCHEMA_VERSION}`);
  }
  if (summary.source !== NATIVE_ACTION_EVIDENCE_SUMMARY_SOURCE) {
    errors.push(`summary.source must be ${NATIVE_ACTION_EVIDENCE_SUMMARY_SOURCE}`);
  }
  if (!isPlainObject(summary.metrics)) {
    errors.push('summary.metrics must be an object');
    return;
  }

  const counts = countTranscriptStatuses(summary.tasks);
  for (const [status, count] of Object.entries(counts)) {
    if (summary.metrics[status] !== count) {
      errors.push(`summary.metrics.${status} must equal task status count ${count}`);
    }
  }
}

function normalizeExpectedTaskIds(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((taskId) => String(taskId || '').trim())
    .filter(Boolean))];
}

function addExpectedTaskErrors({ summary, expectedTaskIds, minNativeTaskActionsPerTask, errors }) {
  if (expectedTaskIds.length === 0 || !Array.isArray(summary?.tasks)) return;
  const tasksById = new Map();
  for (const task of summary.tasks) {
    if (isPlainObject(task) && typeof task.taskId === 'string') tasksById.set(task.taskId, task);
  }

  for (const taskId of expectedTaskIds) {
    const task = tasksById.get(taskId);
    if (!task) {
      errors.push(`${taskId}: missing expected task in P2 native action evidence summary`);
      continue;
    }
    if (task.transcriptStatus !== 'native_task_actions_captured') {
      errors.push(`${taskId}: transcriptStatus must be native_task_actions_captured for expected P2 native action evidence task`);
    }
    const count = Number.isFinite(task.taskActionCount) ? task.taskActionCount : 0;
    if (count < minNativeTaskActionsPerTask) {
      errors.push(`${taskId}: taskActionCount ${count} is below required per-task minimum ${minNativeTaskActionsPerTask}`);
    }
  }
}

export async function validateNativeActionEvidenceGate(options = {}) {
  const experimentDir = options.experimentDir || DEFAULT_NATIVE_ACTION_EVIDENCE_EXPERIMENT_DIR;
  const minNativeTaskActions = Number.isFinite(options.minNativeTaskActions)
    ? options.minNativeTaskActions
    : 1;
  const expectedTaskIds = normalizeExpectedTaskIds(options.expectedTaskIds);
  const minNativeTaskActionsPerTask = Number.isFinite(options.minNativeTaskActionsPerTask)
    ? options.minNativeTaskActionsPerTask
    : 0;
  const summaryPath = `${experimentDir}/summary.json`;
  const errors = [];

  if (!await pathExists(experimentDir)) {
    return {
      ok: false,
      status: 'missing_experiment',
      experimentDir,
      summaryPath,
      capturedNativeTaskActions: 0,
      errors: [`${experimentDir} does not exist; run a fresh P2 native action evidence sample before requiring this gate.`]
    };
  }

  let summary;
  try {
    summary = await readJson(summaryPath);
  } catch (error) {
    return {
      ok: false,
      status: 'invalid_summary',
      experimentDir,
      summaryPath,
      capturedNativeTaskActions: 0,
      errors: [`${summaryPath}: ${error.message}`]
    };
  }

  if (!isPlainObject(summary)) errors.push(`${summaryPath}: summary must be an object`);
  if (!Array.isArray(summary?.tasks) || summary.tasks.length === 0) {
    errors.push(`${summaryPath}: summary.tasks must be a non-empty array`);
  }
  validateSummaryMetadata(summary, errors);
  addExpectedTaskErrors({
    summary,
    expectedTaskIds,
    minNativeTaskActionsPerTask,
    errors
  });

  let capturedNativeTaskActions = 0;
  const realExperimentDir = await realpathOrError(experimentDir, 'experimentDir', errors);
  for (const summaryTask of summary?.tasks || []) {
    if (!isPlainObject(summaryTask)) {
      errors.push(`${summaryPath}: each task summary must be an object`);
      continue;
    }
    if (summaryTask.transcriptStatus !== 'native_task_actions_captured') continue;
    const rawTracePath = summaryTask.rawTracePath;
    if (typeof rawTracePath !== 'string' || rawTracePath.trim() === '') {
      errors.push(`${summaryTask.taskId || 'unknown task'}: rawTracePath must be present`);
      continue;
    }

    const realRawTracePath = await realpathOrError(rawTracePath, `${summaryTask.taskId || 'unknown task'} rawTracePath`, errors);
    if (realRawTracePath && realExperimentDir && !isInsideDirectory(realExperimentDir, realRawTracePath)) {
      errors.push(`${summaryTask.taskId}: rawTracePath must resolve inside experiment directory`);
      continue;
    }

    let rawTrace;
    try {
      rawTrace = await readJson(rawTracePath);
    } catch (error) {
      errors.push(`${rawTracePath}: ${error.message}`);
      continue;
    }

    const schemaErrors = validateRawUitarsTrace(rawTrace);
    errors.push(...schemaErrors.map((error) => `${rawTracePath}: ${error}`));
    errors.push(...validateNativeActionRunScope(rawTrace, { rawTracePath }));
    addSummaryConsistencyErrors({ summaryTask, rawTrace, rawTracePath, errors });
    const count = taskActionCount(rawTrace);
    if (count < 1) errors.push(`${rawTracePath}: must include at least one native task-execution action`);
    if (summaryTask.taskActionCount !== count) {
      errors.push(`${summaryTask.taskId}: taskActionCount must equal raw trace task action count ${count}`);
    }
    capturedNativeTaskActions += count;

    const realArtifactBase = await realpathOrError(rawTrace.artifactBase, `${summaryTask.taskId} artifactBase`, errors);
    if (realArtifactBase && realExperimentDir && !isInsideDirectory(realExperimentDir, realArtifactBase)) {
      errors.push(`${summaryTask.taskId}: artifactBase must resolve inside experiment directory`);
      continue;
    }

    const bundleErrors = await validateRawUitarsTraceBundle(rawTrace, {
      bundleRoot: rawTrace.artifactBase
    });
    errors.push(...bundleErrors.map((error) => `${rawTracePath}: ${error}`));
  }

  if (capturedNativeTaskActions < minNativeTaskActions) {
    errors.push(`captured native task actions ${capturedNativeTaskActions} is below required minimum ${minNativeTaskActions}`);
  }

  return {
    ok: errors.length === 0,
    status: errors.length === 0 ? 'passed' : 'failed',
    experimentDir,
    summaryPath,
    capturedNativeTaskActions,
    errors
  };
}
