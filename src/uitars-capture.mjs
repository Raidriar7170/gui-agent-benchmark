import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { RUNS_SCHEMA_VERSION, validateRun } from './runs.mjs';
import { tracesToRuns } from './trace-importer.mjs';
import {
  captureBenchmarkBenchState,
  sanitizeUrl
} from './uitars-preflight.mjs';

export const CAPTURE_SCHEMA_VERSION = 1;
export const CAPTURE_SOURCE = 'ui-tars-real-run-capture';
export const DEFAULT_CAPTURE_BASE_URL = 'http://127.0.0.1:4173';

const sensitiveKeyPattern = /(?:websocketdebuggerurl|base64|api_?key|token|password|passwd|cookie|headers?|authorization|localstorage|indexeddb|screenshot)/i;
const sensitiveStringPattern = /(?:websocketdebuggerurl|api_?key|token|password|passwd|cookie|headers?|authorization|localstorage|indexeddb)\s*[:=]/i;
const userInfoUrlPattern = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+(?::[^\s/@]*)?@/i;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function assertNoSensitiveContent(value, path = 'artifact') {
  if (typeof value === 'string') {
    const compact = value.replace(/\s/g, '');
    if (
      sensitiveStringPattern.test(value)
      || /websocketdebuggerurl/i.test(value)
      || userInfoUrlPattern.test(value)
      || /^data:image\/[^;]+;base64,/i.test(compact)
      || /^[A-Za-z0-9+/=]{400,}$/.test(compact)
    ) {
      throw new Error(`${path} contains sensitive-looking content.`);
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKeyPattern.test(key)) throw new Error(`${path}.${key} uses a prohibited field name.`);
    assertNoSensitiveContent(child, `${path}.${key}`);
  }
}

function assertJsonSafe(value, path, seen = new Set()) {
  if (value === null) return;
  if (['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} must be JSON-safe.`);
    return;
  }
  if (typeof value !== 'object') throw new Error(`${path} must be JSON-safe.`);
  if (seen.has(value)) throw new Error(`${path} must be JSON-safe.`);
  if (!Array.isArray(value) && !isPlainObject(value)) throw new Error(`${path} must be JSON-safe.`);

  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonSafe(item, `${path}[${index}]`, seen));
  } else {
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) throw new Error(`${path}.${key} must be JSON-safe.`);
      assertJsonSafe(child, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function toIso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function findTask(tasks, taskId) {
  return tasks.find((task) => task.id === taskId) || null;
}

function benchmarkUrlForTask(baseUrl, task) {
  return new URL(task.startUrl || `/?task=${encodeURIComponent(task.id)}`, baseUrl).href;
}

async function loadTasks(taskPath) {
  const path = taskPath || new URL('../public/tasks.json', import.meta.url);
  const tasks = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(tasks)) throw new Error('Task registry must be an array.');
  return tasks;
}

function makeTrace({ task, startedAt, endedAt, benchmarkUrl, capture }) {
  return {
    traceVersion: 1,
    source: CAPTURE_SOURCE,
    taskId: task.id,
    taskTitle: task.title,
    startedAt,
    endedAt,
    events: [
      {
        timestamp: endedAt,
        type: 'real_run_capture',
        label: 'Real run capture',
        countsAsStep: false,
        value: {
          benchmarkUrl: sanitizeUrl(benchmarkUrl),
          captureStatus: capture.captureStatus
        }
      }
    ],
    finalState: capture.finalState,
    evaluation: capture.evaluation
  };
}

function makeCapture({ task, startedAt, endedAt, benchmarkUrl, capture }) {
  return {
    schemaVersion: CAPTURE_SCHEMA_VERSION,
    source: CAPTURE_SOURCE,
    captureStatus: capture.captureStatus,
    taskId: task.id,
    taskTitle: task.title,
    benchmarkUrl: sanitizeUrl(benchmarkUrl),
    startedAt,
    endedAt,
    target: capture.target,
    finalState: capture.finalState,
    evaluation: capture.evaluation
  };
}

function makeRunExport(runs, exportedAt) {
  return {
    schemaVersion: RUNS_SCHEMA_VERSION,
    exportedAt,
    runs
  };
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function runUitarsCapture(options = {}) {
  if (!options.taskId || typeof options.taskId !== 'string') {
    throw new Error('A task id is required.');
  }

  const tasks = await loadTasks(options.taskPath);
  const task = findTask(tasks, options.taskId);
  if (!task) throw new Error(`Unknown task id: ${options.taskId}`);

  const baseUrl = options.baseUrl || DEFAULT_CAPTURE_BASE_URL;
  const benchmarkUrl = benchmarkUrlForTask(baseUrl, task);
  const startedAt = toIso(options.startedAt || new Date());
  const captureResult = await captureBenchmarkBenchState({
    cdpUrl: options.cdpUrl,
    benchmarkUrl,
    taskId: task.id,
    allowRemoteCdp: options.allowRemoteCdp,
    allowRemoteBenchmark: options.allowRemoteBenchmark,
    discoverLocalUitars: options.discoverLocalUitars,
    timeoutMs: options.timeoutMs
  });
  const endedAt = toIso(options.endedAt || new Date());

  const capture = makeCapture({
    task,
    startedAt,
    endedAt,
    benchmarkUrl,
    capture: captureResult
  });
  const trace = makeTrace({
    task,
    startedAt,
    endedAt,
    benchmarkUrl,
    capture: captureResult
  });
  const runs = tracesToRuns([trace], tasks);
  const runErrors = runs.flatMap((run, index) => validateRun(run).map((error) => `runs[${index}]: ${error}`));
  if (runErrors.length > 0) throw new Error(`Captured run export is invalid: ${runErrors.join('; ')}`);
  const runExport = makeRunExport(runs, endedAt);

  for (const [name, artifact] of Object.entries({ capture, trace, runExport })) {
    assertJsonSafe(artifact, name);
    assertNoSensitiveContent(artifact, name);
  }

  if (options.outputDir) {
    await mkdir(options.outputDir, { recursive: true });
    await Promise.all([
      writeJson(join(options.outputDir, 'capture.json'), capture),
      writeJson(join(options.outputDir, 'trace.json'), trace),
      writeJson(join(options.outputDir, 'run-export.json'), runExport)
    ]);
  }

  return {
    outputDir: options.outputDir || '',
    capture,
    trace,
    runExport
  };
}
