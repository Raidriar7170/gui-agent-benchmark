import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  DEFAULT_NATIVE_ACTION_EVIDENCE_EXPERIMENT_DIR,
  NATIVE_ACTION_EVIDENCE_GATE_SCHEMA_VERSION,
  NATIVE_ACTION_EVIDENCE_SUMMARY_SOURCE,
  NATIVE_ACTION_TRANSCRIPT_STATUSES,
  TASK_EXECUTION_ACTION_NAMES,
  validateNativeActionRunScope
} from './native-action-evidence-gate.mjs';
import {
  validateRawUitarsTrace,
  validateRawUitarsTraceBundle
} from './uitars-raw-trace.mjs';

export const P2_NATIVE_ACTION_EVIDENCE_TASK_IDS = Object.freeze([
  'settings-toggle',
  'onboarding-form',
  'ticket-review'
]);

const TASK_EXECUTION_ACTION_SET = new Set(TASK_EXECUTION_ACTION_NAMES);

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

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function actionEvents(rawTrace) {
  return Array.isArray(rawTrace?.events)
    ? rawTrace.events.filter((event) => event?.type === 'action')
    : [];
}

function taskActionNames(rawTrace) {
  return [...new Set(actionEvents(rawTrace)
    .map((event) => String(event?.action?.name || '').toLowerCase())
    .filter((name) => TASK_EXECUTION_ACTION_SET.has(name)))];
}

function taskActionCount(rawTrace) {
  return actionEvents(rawTrace).filter((event) => {
    const name = String(event?.action?.name || '').toLowerCase();
    return TASK_EXECUTION_ACTION_SET.has(name);
  }).length;
}

function actionTimestampRange(rawTrace) {
  const times = actionEvents(rawTrace)
    .map((event) => Date.parse(event?.timestamp || ''))
    .filter((value) => !Number.isNaN(value))
    .sort((left, right) => left - right);
  if (times.length === 0) return null;
  return {
    first: new Date(times[0]).toISOString(),
    last: new Date(times[times.length - 1]).toISOString()
  };
}

function failedCriteriaFromEvaluation(evaluation) {
  if (Array.isArray(evaluation?.failedCriteria)) return evaluation.failedCriteria;
  if (Array.isArray(evaluation?.details)) {
    return evaluation.details
      .filter((detail) => detail?.pass === false)
      .map((detail) => detail.criterion || detail.name || 'failed criterion');
  }
  return [];
}

function normalizeEvaluation(value) {
  const evaluation = value?.evaluation || value;
  if (!isPlainObject(evaluation)) return null;
  return {
    success: evaluation.success,
    score: evaluation.score,
    primaryFailureCode: evaluation.primaryFailureCode,
    failedCriteria: failedCriteriaFromEvaluation(evaluation)
  };
}

function compareFinalEvaluation({ taskId, rawTrace, capture, errors }) {
  const captureEvaluation = normalizeEvaluation(capture);
  if (!captureEvaluation) return;
  const final = rawTrace.final || {};
  if (final.success !== captureEvaluation.success) {
    errors.push(`${taskId}: rawTrace.final.success must match capture.evaluation.success`);
  }
  if (final.score !== captureEvaluation.score) {
    errors.push(`${taskId}: rawTrace.final.score must match capture.evaluation.score`);
  }
  if (
    typeof captureEvaluation.primaryFailureCode === 'string' &&
    final.primaryFailureCode !== captureEvaluation.primaryFailureCode
  ) {
    errors.push(`${taskId}: rawTrace.final.primaryFailureCode must match capture.evaluation.primaryFailureCode`);
  }
  const rawFailed = JSON.stringify(final.failedCriteria || []);
  const captureFailed = JSON.stringify(captureEvaluation.failedCriteria || []);
  if (rawFailed !== captureFailed) {
    errors.push(`${taskId}: rawTrace.final.failedCriteria must match capture.evaluation failed criteria`);
  }
}

function countMetrics(tasks) {
  const metrics = Object.fromEntries(NATIVE_ACTION_TRANSCRIPT_STATUSES.map((status) => [status, 0]));
  for (const task of tasks) metrics[task.transcriptStatus] += 1;
  return metrics;
}

async function analyzeTask({ experimentDir, taskId }) {
  const rawTracePath = join(experimentDir, 'tasks', taskId, 'raw-trace.json');
  const capturePath = join(experimentDir, 'tasks', taskId, 'capture', 'capture.json');
  if (!await pathExists(rawTracePath)) {
    return {
      taskId,
      taskTitle: '',
      transcriptStatus: 'missing_native_transcript',
      rawTracePath: null,
      capturePath: await pathExists(capturePath) ? capturePath : null,
      taskActionCount: 0,
      taskActionNames: [],
      evidence: [`no raw native UI-TARS transcript found at ${rawTracePath}`],
      limitations: ['No native UI-TARS action-event transcript was preserved for this task; no actions were reconstructed.']
    };
  }

  let rawTrace;
  const errors = [];
  try {
    rawTrace = await readJson(rawTracePath);
  } catch (error) {
    errors.push(`${rawTracePath}: ${error.message}`);
  }
  if (rawTrace) {
    errors.push(...validateRawUitarsTrace(rawTrace).map((error) => `${rawTracePath}: ${error}`));
    if (errors.length === 0) {
      errors.push(...(await validateRawUitarsTraceBundle(rawTrace, {
        bundleRoot: rawTrace.artifactBase
      })).map((error) => `${rawTracePath}: ${error}`));
    }
    if (rawTrace?.taskId !== taskId) errors.push(`${rawTracePath}: taskId must match ${taskId}`);
    errors.push(...validateNativeActionRunScope(rawTrace, { rawTracePath }));
  }

  if (rawTrace && await pathExists(capturePath)) {
    const capture = await readJson(capturePath);
    compareFinalEvaluation({ taskId, rawTrace, capture, errors });
  }

  const names = rawTrace && errors.length === 0 ? taskActionNames(rawTrace) : [];
  const count = rawTrace && errors.length === 0 ? taskActionCount(rawTrace) : 0;
  const timestampRange = rawTrace && errors.length === 0 ? actionTimestampRange(rawTrace) : null;
  const status = errors.length > 0
    ? 'invalid_native_transcript'
    : count > 0
      ? 'native_task_actions_captured'
      : 'visible_transcript_only';

  return {
    taskId,
    taskTitle: rawTrace?.taskTitle || '',
    transcriptStatus: status,
    rawTracePath: status === 'native_task_actions_captured' ? rawTracePath : null,
    capturePath: await pathExists(capturePath) ? capturePath : null,
    taskActionCount: count,
    taskActionNames: names,
    taskActionTimestampRange: timestampRange,
    rawTraceValidationErrors: errors,
    evidence: errors.length > 0
      ? [`raw native UI-TARS transcript rejected: ${errors.join('; ')}`]
      : [`raw native UI-TARS transcript validated: ${rawTracePath}`, `task-execution action events=${count}`],
    limitations: [
      'Native UI-TARS action events are accepted only from preserved UI-TARS raw transcript artifacts between the run prompt boundary and any final capture/judge boundary.',
      'Capture, run-export, step traces, screenshots, and final state are not used to reconstruct actions.'
    ]
  };
}

export async function analyzeNativeActionEvidencePack({
  experimentDir = DEFAULT_NATIVE_ACTION_EVIDENCE_EXPERIMENT_DIR,
  expectedTaskIds = P2_NATIVE_ACTION_EVIDENCE_TASK_IDS,
  createdAt = new Date().toISOString()
} = {}) {
  const taskIds = [...new Set(expectedTaskIds)];
  const tasks = [];
  for (const taskId of taskIds) {
    tasks.push(await analyzeTask({ experimentDir, taskId }));
  }
  return {
    schemaVersion: NATIVE_ACTION_EVIDENCE_GATE_SCHEMA_VERSION,
    source: NATIVE_ACTION_EVIDENCE_SUMMARY_SOURCE,
    createdAt,
    scope: {
      taskCount: taskIds.length,
      taskIds,
      measurement: 'P2 native action evidence closure for run-scoped preserved UI-TARS action-event transcripts; not automated model scoring or task success proof.'
    },
    metrics: countMetrics(tasks),
    tasks
  };
}

export function renderNativeActionEvidencePackReport(summary) {
  function rangeLabel(task) {
    return task.taskActionTimestampRange
      ? `${task.taskActionTimestampRange.first} to ${task.taskActionTimestampRange.last}`
      : 'none';
  }
  const rows = summary.tasks.map((task) => (
    `| ${task.taskId} | ${task.transcriptStatus} | ${task.taskActionCount} | ${task.taskActionNames.join(', ') || 'none'} | ${rangeLabel(task)} | ${task.rawTracePath || 'none'} |`
  )).join('\n');
  return `# P2 Native Action Evidence Pack

Generated: ${summary.createdAt}

## Scope

${summary.scope.measurement}

Expected tasks: ${summary.scope.taskIds.join(', ')}

## Metrics

- native_task_actions_captured: ${summary.metrics.native_task_actions_captured}
- visible_transcript_only: ${summary.metrics.visible_transcript_only}
- invalid_native_transcript: ${summary.metrics.invalid_native_transcript}
- missing_native_transcript: ${summary.metrics.missing_native_transcript}

## Tasks

| Task | Transcript status | Native action events | Action names | Action timestamp range | Raw trace |
| --- | --- | ---: | --- | --- | --- |
${rows}

## Evidence Policy

Only preserved raw UI-TARS transcript bundles can satisfy native action evidence. Missing tasks remain missing; they are not filled from step traces, captures, screenshots, run exports, or final state.
`;
}

export function renderNativeActionEvidencePackRunLog(summary) {
  const lines = summary.tasks.map((task) => (
    `- ${summary.createdAt}: ${task.taskId} -> ${task.transcriptStatus}, native action events=${task.taskActionCount}.`
  )).join('\n');
  return `# P2 Native Action Evidence Pack Run Log

${lines}

- ${summary.createdAt}: Wrote summary.json, report.md, and run-log.md.
- ${summary.createdAt}: No native action events were reconstructed from derived artifacts.
`;
}

export async function writeNativeActionEvidencePack({
  summary,
  experimentDir = DEFAULT_NATIVE_ACTION_EVIDENCE_EXPERIMENT_DIR
}) {
  const summaryPath = join(experimentDir, 'summary.json');
  const reportPath = join(experimentDir, 'report.md');
  const runLogPath = join(experimentDir, 'run-log.md');
  await writeJson(summaryPath, summary);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, renderNativeActionEvidencePackReport(summary), 'utf8');
  await mkdir(dirname(runLogPath), { recursive: true });
  await writeFile(runLogPath, renderNativeActionEvidencePackRunLog(summary), 'utf8');
  return { summaryPath, reportPath, runLogPath };
}
