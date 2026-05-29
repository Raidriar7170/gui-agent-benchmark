import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { validateRawUitarsTrace } from './uitars-raw-trace.mjs';

export const NATIVE_TASK_ACTION_TRANSCRIPT_SCHEMA_VERSION = 1;
export const NATIVE_TASK_ACTION_TRANSCRIPT_SOURCE = 'ui-tars-native-task-action-transcript-smoke';
export const DEFAULT_EXPERIMENT_DIR = 'experiments/2026-05-29-p1-native-action-transcript-smoke';
export const EXPECTED_TASK_IDS = Object.freeze(['onboarding-form', 'settings-toggle', 'pagination-review']);
export const TASK_EXECUTION_ACTION_NAMES = Object.freeze(['click', 'type', 'fill', 'select', 'press', 'submit', 'drag', 'check', 'uncheck']);

const TASK_EXECUTION_ACTION_SET = new Set(TASK_EXECUTION_ACTION_NAMES);
const NATIVE_RAW_TRACE_FILENAMES = Object.freeze([
  'raw-trace.json',
  'native-raw-trace.json',
  'native-transcript.json',
  'ui-tars-raw-transcript.json'
]);

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
  return path;
}

function relativeTaskPath(preflightTask, key) {
  const value = preflightTask?.files?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function findPreflightTask(preflightMetadata, taskId) {
  return Array.isArray(preflightMetadata?.tasks)
    ? preflightMetadata.tasks.find((task) => task?.id === taskId)
    : undefined;
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

async function findRawTraceCandidate({ experimentDir, taskId }) {
  const taskDir = join(experimentDir, 'tasks', taskId);
  const candidateDirs = [taskDir, join(taskDir, 'real-run')];
  for (const candidateDir of candidateDirs) {
    for (const filename of NATIVE_RAW_TRACE_FILENAMES) {
      const candidate = join(candidateDir, filename);
      if (await pathExists(candidate)) return candidate;
    }
  }
  return null;
}

function taskActionCount(rawTrace) {
  return actionEvents(rawTrace).filter((event) => {
    const name = String(event?.action?.name || '').toLowerCase();
    return TASK_EXECUTION_ACTION_SET.has(name);
  }).length;
}

function transcriptStatusFor({ taskId, rawTrace, rawTraceErrors, taskActionNames: names }) {
  if (rawTrace && rawTraceErrors.length === 0 && names.length > 0) return 'native_task_actions_captured';
  if (rawTrace && rawTraceErrors.length === 0) return 'visible_transcript_only';
  if (rawTrace && rawTraceErrors.length > 0) return 'invalid_native_transcript';
  return 'missing_native_transcript';
}

function evidenceFor({ taskId, preflightTask, rawTracePath, rawTraceErrors, status, actionCount }) {
  const evidence = [
    `preflight status=${preflightTask?.status || 'unknown'}`,
    `targetPrepareStatus=${preflightTask?.targetPrepareStatus || 'unknown'}`,
    `dryRunStatus=${preflightTask?.dryRunStatus || 'unknown'}`
  ];

  if (rawTracePath && rawTraceErrors.length === 0) {
    evidence.push(`native raw trace candidate passed schema validation: ${rawTracePath}`);
    evidence.push(`task-execution action events=${actionCount}`);
  } else if (rawTracePath) {
    evidence.push(`raw trace candidate rejected by schema validation: ${rawTraceErrors.join('; ')}`);
  } else {
    evidence.push(`no native raw trace file found under the P1.5 task artifact directory for ${taskId}`);
  }

  return evidence;
}

function limitationsFor(status) {
  const limitations = [
    'Native task actions are not reconstructed from capture, run-export, trace, screenshots, or final state.',
    'Preflight artifacts only prove target readiness; they do not prove model task-action execution.'
  ];
  if (status === 'missing_native_transcript') {
    limitations.push('Missing native transcript means no native task-action coverage was available for this smoke.');
  }
  if (status === 'invalid_native_transcript') {
    limitations.push('Invalid native transcript candidates are not counted as native task-action coverage.');
  }
  if (status === 'visible_transcript_only') {
    limitations.push('Visible transcript or non-task actions do not satisfy native task-action coverage.');
  }
  return limitations;
}

async function analyzeTask({ experimentDir, preflightMetadata, taskId, createdAt }) {
  const preflightTask = findPreflightTask(preflightMetadata, taskId);
  const analysisPath = join(experimentDir, 'tasks', taskId, 'native-transcript-analysis.json');
  const rawTraceCandidate = await findRawTraceCandidate({ experimentDir, taskId });
  let rawTrace;
  let rawTraceErrors = [];
  let names = [];

  if (rawTraceCandidate) {
    rawTrace = await readJson(rawTraceCandidate);
    rawTraceErrors = validateRawUitarsTrace(rawTrace);
    if (rawTraceErrors.length === 0) names = taskActionNames(rawTrace);
  }

  const status = transcriptStatusFor({
    taskId,
    rawTrace,
    rawTraceErrors,
    taskActionNames: names
  });
  const actionCount = rawTrace && rawTraceErrors.length === 0 ? taskActionCount(rawTrace) : 0;
  const realRawTracePath = status === 'native_task_actions_captured' ? rawTraceCandidate : null;

  const taskSummary = {
    taskId,
    taskTitle: preflightTask?.title || '',
    preflightStatus: preflightTask?.status || 'unknown',
    transcriptStatus: status,
    rawTracePath: realRawTracePath,
    taskActionCount: actionCount,
    taskActionNames: names,
    evidence: evidenceFor({
      taskId,
      preflightTask,
      rawTracePath: rawTraceCandidate,
      rawTraceErrors,
      status,
      actionCount
    }),
    limitations: limitationsFor(status),
    analysisPath
  };

  const analysis = {
    schemaVersion: NATIVE_TASK_ACTION_TRANSCRIPT_SCHEMA_VERSION,
    source: NATIVE_TASK_ACTION_TRANSCRIPT_SOURCE,
    createdAt,
    taskId,
    preflight: {
      status: preflightTask?.status || 'unknown',
      targetPrepareStatus: preflightTask?.targetPrepareStatus || 'unknown',
      dryRunStatus: preflightTask?.dryRunStatus || 'unknown',
      promptPath: relativeTaskPath(preflightTask, 'prompt'),
      targetPreparePath: relativeTaskPath(preflightTask, 'targetPrepare'),
      preflightDryRunPath: relativeTaskPath(preflightTask, 'preflightDryRun')
    },
    transcriptStatus: status,
    rawTraceCandidatePath: rawTraceCandidate,
    rawTracePath: realRawTracePath,
    rawTraceValidationErrors: rawTraceErrors,
    nativeTaskActionNames: names,
    nativeTaskActionCount: actionCount,
    evidence: taskSummary.evidence,
    limitations: taskSummary.limitations
  };

  await writeJson(analysisPath, analysis);

  return taskSummary;
}

function countMetrics(tasks) {
  const metrics = {
    native_task_actions_captured: 0,
    visible_transcript_only: 0,
    invalid_native_transcript: 0,
    missing_native_transcript: 0
  };
  for (const task of tasks) {
    metrics[task.transcriptStatus] += 1;
  }
  return metrics;
}

export async function analyzeNativeTaskActionTranscriptSmoke({
  experimentDir = DEFAULT_EXPERIMENT_DIR,
  createdAt: providedCreatedAt
} = {}) {
  const preflightContextPath = join(experimentDir, 'preflight-context', 'metadata.json');
  const preflightMetadata = await readJson(preflightContextPath);
  const createdAt = providedCreatedAt || preflightMetadata.createdAt || new Date().toISOString();
  const tasks = [];

  for (const taskId of EXPECTED_TASK_IDS) {
    tasks.push(await analyzeTask({
      experimentDir,
      preflightMetadata,
      taskId,
      createdAt
    }));
  }

  return {
    schemaVersion: NATIVE_TASK_ACTION_TRANSCRIPT_SCHEMA_VERSION,
    source: NATIVE_TASK_ACTION_TRANSCRIPT_SOURCE,
    createdAt,
    scope: {
      taskIds: [...EXPECTED_TASK_IDS],
      taskCount: EXPECTED_TASK_IDS.length,
      measurement: 'Measures native task-action transcript preservation for three prepared UI-TARS tasks; this is not automated model scoring.'
    },
    preflightContextPath,
    metrics: countMetrics(tasks),
    tasks
  };
}

export function renderNativeTaskActionTranscriptReport(summary) {
  const rows = summary.tasks.map((task) => (
    `| ${task.taskId} | ${task.preflightStatus} | ${task.transcriptStatus} | ${task.taskActionCount} | ${task.rawTracePath || 'none'} |`
  )).join('\n');

  return `# P1.5 Native Task-Action Transcript Smoke

Generated: ${summary.createdAt}

## Scope

${summary.scope.measurement}

Preflight context: ${summary.preflightContextPath}

## Metrics

- native_task_actions_captured: ${summary.metrics.native_task_actions_captured}
- visible_transcript_only: ${summary.metrics.visible_transcript_only}
- invalid_native_transcript: ${summary.metrics.invalid_native_transcript}
- missing_native_transcript: ${summary.metrics.missing_native_transcript}

## Tasks

| Task | Preflight | Transcript status | Task actions | Native raw trace |
| --- | --- | --- | ---: | --- |
${rows}

## Policy

Native task-action coverage requires a preserved native raw UI-TARS transcript that passes schema validation and contains at least one task-execution action: ${TASK_EXECUTION_ACTION_NAMES.join(', ')}.

Capture, run-export, trace, screenshots, and final-state artifacts are not used to reconstruct native action events.
`;
}

export function renderNativeTaskActionTranscriptRunLog(summary) {
  return `# P1.5 Native Task-Action Transcript Smoke Run Log

- ${summary.createdAt}: Used existing preflight context with three ready tasks.
- ${summary.createdAt}: Checked only P1.5 task artifact directories for preserved native raw transcripts.
- ${summary.createdAt}: Classified tasks without preserved native raw transcripts as missing_native_transcript.
- ${summary.createdAt}: Generated per-task native transcript analyses, summary, and report.

No task-action events were reconstructed from capture, run-export, trace, screenshots, or final-state artifacts.
`;
}

export async function writeNativeTaskActionTranscriptSmoke({ summary, experimentDir = DEFAULT_EXPERIMENT_DIR }) {
  const summaryPath = join(experimentDir, 'summary.json');
  const reportPath = join(experimentDir, 'report.md');
  const runLogPath = join(experimentDir, 'run-log.md');

  await writeJson(summaryPath, summary);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, renderNativeTaskActionTranscriptReport(summary), 'utf8');
  await mkdir(dirname(runLogPath), { recursive: true });
  await writeFile(runLogPath, renderNativeTaskActionTranscriptRunLog(summary), 'utf8');

  return { summaryPath, reportPath, runLogPath };
}
