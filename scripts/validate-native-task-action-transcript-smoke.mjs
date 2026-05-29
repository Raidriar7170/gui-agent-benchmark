#!/usr/bin/env node
import { access, readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { validateRawUitarsTrace } from '../src/uitars-raw-trace.mjs';

const EXPERIMENT_DIR = 'experiments/2026-05-29-p1-native-action-transcript-smoke';
const SUMMARY_PATH = `${EXPERIMENT_DIR}/summary.json`;
const REPORT_PATH = `${EXPERIMENT_DIR}/report.md`;
const RUN_LOG_PATH = `${EXPERIMENT_DIR}/run-log.md`;
const PREFLIGHT_METADATA_PATH = `${EXPERIMENT_DIR}/preflight-context/metadata.json`;
const EXPECTED_TASK_IDS = ['onboarding-form', 'settings-toggle', 'pagination-review'];
const TASK_EXECUTION_ACTIONS = new Set(['click', 'type', 'fill', 'select', 'press', 'submit', 'drag', 'check', 'uncheck']);

const errors = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
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
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    errors.push(`${path}: ${error.message}`);
    return undefined;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function walkStrings(value, visit, path = '') {
  if (typeof value === 'string') {
    visit(value, path, 'value');
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) walkStrings(item, visit, `${path}[${index}]`);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    visit(key, childPath, 'key');
    if (
      /^(api_?key|token|password|authorization|cookie)$/i.test(key)
      && (typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean')
    ) {
      visit(`${key}: ${child}`, childPath, 'key-value');
    }
    walkStrings(child, visit, childPath);
  }
}

const sensitivePatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
  /["']?(?:api_?key|token|password|authorization|cookie)["']?\s*[:=]\s*["']?[^"',}\s]+/i,
  /\bwebSocketDebuggerUrl\b/i,
  /\bws:\/\/[^\s"'<>]+\/devtools\//i,
  /\/Users\/[^/\s]+\/\.ssh\b/i,
  /(^|[\s"'`])~\/\.ssh\b/i,
  /(^|[\s"'`])\/root(?:\/|[\s"'`]|$)/i,
  /\bssh\s+-L\b/i,
  /\bssh\s+[^\s]+@[^\s]+/i
];

function validateSensitiveText(label, value) {
  walkStrings(value, (text, path) => {
    for (const pattern of sensitivePatterns) {
      if (pattern.test(text)) errors.push(`${label}${path ? ` ${path}` : ''}: sensitive marker matched ${pattern}`);
    }
    for (const match of text.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
      const ip = match[0];
      const octets = ip.split('.').map((part) => Number(part));
      if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) continue;
      if (ip === '127.0.0.1' || ip.startsWith('127.')) continue;
      errors.push(`${label}${path ? ` ${path}` : ''}: sensitive marker matched IP address ${ip}`);
    }
  });
}

async function walkFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(path));
    if (entry.isFile()) files.push(path);
  }
  return files;
}

function isTextArtifact(path) {
  return new Set(['.json', '.md', '.txt', '.mjs', '.js']).has(extname(path));
}

function taskExecutionActionNames(rawTrace) {
  const events = Array.isArray(rawTrace?.events) ? rawTrace.events : [];
  return [...new Set(events
    .filter((event) => event?.type === 'action')
    .map((event) => String(event?.action?.name || '').toLowerCase())
    .filter((name) => TASK_EXECUTION_ACTIONS.has(name)))];
}

function expectedAnalysisPath(taskId) {
  return `${EXPERIMENT_DIR}/tasks/${taskId}/native-transcript-analysis.json`;
}

function validateStatusMetrics(summary) {
  const counts = {
    native_task_actions_captured: 0,
    visible_transcript_only: 0,
    invalid_native_transcript: 0,
    missing_native_transcript: 0
  };

  for (const task of summary.tasks || []) {
    if (Object.hasOwn(counts, task.transcriptStatus)) counts[task.transcriptStatus] += 1;
  }

  for (const [status, count] of Object.entries(counts)) {
    assert(summary.metrics?.[status] === count, `metrics.${status} must equal task status count ${count}`);
  }
}

const summary = await readJson(SUMMARY_PATH);

assert(await pathExists(REPORT_PATH), `${REPORT_PATH} must exist`);
assert(await pathExists(RUN_LOG_PATH), `${RUN_LOG_PATH} must exist`);
assert(await pathExists(PREFLIGHT_METADATA_PATH), `${PREFLIGHT_METADATA_PATH} must exist`);

if (summary) {
  assert(summary.schemaVersion === 1, 'summary.schemaVersion must be 1');
  assert(summary.source === 'ui-tars-native-task-action-transcript-smoke', 'summary.source must be ui-tars-native-task-action-transcript-smoke');
  assert(nonEmptyString(summary.createdAt), 'summary.createdAt must be present');
  assert(summary.preflightContextPath === PREFLIGHT_METADATA_PATH, 'summary.preflightContextPath must point to preflight metadata');
  assert(summary.scope?.taskCount === 3, 'summary.scope.taskCount must be 3');
  assert(JSON.stringify(summary.scope?.taskIds) === JSON.stringify(EXPECTED_TASK_IDS), 'summary.scope.taskIds must match expected P1.5 tasks in order');
  assert(
    typeof summary.scope?.measurement === 'string'
      && summary.scope.measurement.includes('native task-action transcript preservation')
      && summary.scope.measurement.includes('not automated model scoring'),
    'summary.scope.measurement must describe preservation and not automated model scoring'
  );
  assert(Array.isArray(summary.tasks), 'summary.tasks must be an array');
  assert(summary.tasks?.length === 3, 'summary.tasks must contain exactly three tasks');
  validateStatusMetrics(summary);

  for (const taskId of EXPECTED_TASK_IDS) {
    const task = summary.tasks?.find((item) => item?.taskId === taskId);
    assert(isPlainObject(task), `summary.tasks must include ${taskId}`);
    if (!isPlainObject(task)) continue;

    assert(task.preflightStatus === 'ready', `${taskId}.preflightStatus must be ready`);
    assert(['native_task_actions_captured', 'visible_transcript_only', 'invalid_native_transcript', 'missing_native_transcript'].includes(task.transcriptStatus), `${taskId}.transcriptStatus must be a known status`);
    assert(task.analysisPath === expectedAnalysisPath(taskId), `${taskId}.analysisPath must use the expected task analysis path`);
    assert(typeof task.taskActionCount === 'number' && task.taskActionCount >= 0, `${taskId}.taskActionCount must be a non-negative number`);
    assert(Array.isArray(task.taskActionNames), `${taskId}.taskActionNames must be an array`);
    assert(Array.isArray(task.evidence) && task.evidence.length >= 1, `${taskId}.evidence must be non-empty`);
    assert(Array.isArray(task.limitations) && task.limitations.some((item) => /not reconstructed/i.test(item)), `${taskId}.limitations must state actions are not reconstructed`);
    assert(await pathExists(task.analysisPath), `${task.analysisPath} must exist`);
    const analysis = await readJson(task.analysisPath);
    if (analysis) {
      assert(analysis.taskId === task.taskId, `${taskId}.analysis.taskId must match summary taskId`);
      assert(analysis.transcriptStatus === task.transcriptStatus, `${taskId}.analysis.transcriptStatus must match summary`);
      assert(analysis.rawTracePath === task.rawTracePath, `${taskId}.analysis.rawTracePath must match summary`);
      assert(analysis.nativeTaskActionCount === task.taskActionCount, `${taskId}.analysis.nativeTaskActionCount must match summary`);
      assert(JSON.stringify(analysis.nativeTaskActionNames) === JSON.stringify(task.taskActionNames), `${taskId}.analysis.nativeTaskActionNames must match summary`);
      validateSensitiveText(task.analysisPath, analysis);
    }

    if (task.transcriptStatus === 'native_task_actions_captured') {
      assert(nonEmptyString(task.rawTracePath), `${taskId}.rawTracePath must be present when native actions are captured`);
      const rawTrace = task.rawTracePath ? await readJson(task.rawTracePath) : undefined;
      if (rawTrace) {
        const rawErrors = validateRawUitarsTrace(rawTrace);
        assert(rawErrors.length === 0, `${taskId}.rawTracePath must pass validateRawUitarsTrace: ${rawErrors.join('; ')}`);
        const actionNames = taskExecutionActionNames(rawTrace);
        assert(actionNames.length >= 1, `${taskId}.rawTracePath must include at least one task-execution action`);
        assert(task.taskActionCount >= 1, `${taskId}.taskActionCount must be at least one when native actions are captured`);
      }
    } else {
      assert(task.rawTracePath === null, `${taskId}.rawTracePath must be null without captured native task actions`);
      assert(task.taskActionCount === 0, `${taskId}.taskActionCount must be 0 without captured native task actions`);
      assert(task.taskActionNames.length === 0, `${taskId}.taskActionNames must be empty without captured native task actions`);
    }

  }

  assert(summary.metrics?.native_task_actions_captured === 0, 'current smoke must report 0 native task action captures');
  assert(summary.metrics?.visible_transcript_only === 0, 'current smoke must report 0 visible-transcript-only captures');
  assert(summary.metrics?.invalid_native_transcript === 0, 'current smoke must report 0 invalid native transcripts');
  assert(summary.metrics?.missing_native_transcript === 3, 'current smoke must report 3 missing native transcripts');

  validateSensitiveText(SUMMARY_PATH, summary);
}

if (await pathExists(EXPERIMENT_DIR)) {
  for (const textPath of (await walkFiles(EXPERIMENT_DIR)).filter(isTextArtifact)) {
    validateSensitiveText(textPath, await readFile(textPath, 'utf8'));
  }
}

if (errors.length > 0) {
  console.error('Native task-action transcript smoke validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Native task-action transcript smoke validation passed.');
