import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { loadTasks, validateTasks } from './task-registry.mjs';
import { tracesToRuns } from './trace-importer.mjs';
import { validateRun } from './runs.mjs';
import {
  normalizeBenchmarkUrl,
  prepareUitarsTarget,
  runUitarsPreflight,
  sanitizeUrl,
  writePreflightReport
} from './uitars-preflight.mjs';
import { evaluateLiveTargetGuard } from './uitars-live-target-guard.mjs';

export const HARNESS_SCHEMA_VERSION = 1;
export const DEFAULT_HARNESS_BASE_URL = 'http://127.0.0.1:4173';

const blockedPreflightStatuses = new Set(['blocked', 'ambiguous', 'error']);
const sensitiveKeyPattern = /(?:websocketdebuggerurl|api_?key|token|password|passwd|cookie|authorization|headers?|localstorage|screenshot|base64)/i;
const userInfoUrlPattern = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+(?::[^\s/@]*)?@/i;

function compactTimestamp(timestamp) {
  return timestamp.replace(/\D/g, '').slice(0, 14);
}

export function defaultBenchmarkHarnessOutputDir(now = new Date()) {
  return join('experiments', `${compactTimestamp(now.toISOString())}-uitars-harness`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeString(value) {
  const text = String(value ?? '');
  if (/^data:image\/[^;]+;base64,/i.test(text) || /^[A-Za-z0-9+/=]{400,}$/.test(text)) {
    return '[redacted]';
  }
  return text
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, '$1')
    .replace(/(?:api_?key|token|password|passwd|cookie|authorization|headers?|localstorage|screenshot|base64)=([^&\s]+)/gi, '[redacted]')
    .replace(/websocketdebuggerurl|api_?key|token|password|passwd|cookie|authorization|headers?|localstorage|screenshot|base64/gi, '[redacted]');
}

function sanitizeForOutput(value, key = '', seen = new Set()) {
  if (typeof value === 'string') {
    if (/url$/i.test(key) || /^url$/i.test(key)) return sanitizeUrl(value);
    return sanitizeString(value);
  }
  if (value === null || ['boolean', 'number'].includes(typeof value)) return value;
  if (value === undefined || typeof value !== 'object') return null;
  if (seen.has(value)) return '[redacted]';

  seen.add(value);
  if (Array.isArray(value)) {
    const sanitized = value.map((item) => sanitizeForOutput(item, key, seen));
    seen.delete(value);
    return sanitized;
  }

  const sanitized = {};
  if (isPlainObject(value)) {
    for (const [childKey, child] of Object.entries(value)) {
      if (sensitiveKeyPattern.test(childKey)) continue;
      sanitized[childKey] = sanitizeForOutput(child, childKey, seen);
    }
  }
  seen.delete(value);
  return sanitized;
}

export function inspectSensitiveOutput(value, path = 'output', errors = []) {
  if (typeof value === 'string') {
    if (
      userInfoUrlPattern.test(value)
      || /^data:image\/[^;]+;base64,/i.test(value)
      || /^[A-Za-z0-9+/=]{400,}$/.test(value)
      || /(?:websocketdebuggerurl|api_?key|token|password|passwd|cookie|authorization|headers?|localstorage|screenshot|base64)\s*[:=]/i.test(value)
    ) {
      errors.push(`${path} contains sensitive-looking content`);
    }
    return errors;
  }
  if (!value || typeof value !== 'object') return errors;
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKeyPattern.test(key)) errors.push(`${path}.${key} uses a prohibited field name`);
    inspectSensitiveOutput(child, `${path}.${key}`, errors);
  }
  return errors;
}

function parseTaskSelection(selection, tasks) {
  const rawSelection = selection || 'all';
  if (rawSelection === 'all') return tasks;

  const ids = rawSelection.split(',').map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) throw new Error('--tasks must be "all" or a comma-separated list of task ids.');

  const byId = new Map(tasks.map((task) => [task.id, task]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new Error(`Unknown task id${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`);
  }
  return ids.map((id) => byId.get(id));
}

function taskBenchmarkUrl(baseUrl, task, { allowRemoteBenchmark = false } = {}) {
  const url = new URL(task.startUrl, baseUrl || DEFAULT_HARNESS_BASE_URL);
  return normalizeBenchmarkUrl(url.href, { allowRemoteBenchmark }).href;
}

function promptForTask(task, benchmarkUrl) {
  return [
    `Task: ${task.title}`,
    '',
    task.instruction,
    '',
    `Start URL: ${benchmarkUrl}`,
    `Max steps: ${task.maxSteps}`,
    '',
    'Success criteria:',
    ...task.successCriteria.map((criterion) => `- ${criterion}`)
  ].join('\n');
}

function targetPrepareBlocksTask(targetPrepareReport) {
  return targetPrepareReport && blockedPreflightStatuses.has(targetPrepareReport.status);
}

function liveGuardBlocksTask(liveGuardReport) {
  return liveGuardReport && liveGuardReport.verdict !== 'safe_to_prompt';
}

function taskStatusFromReports(dryRunReport, fixReport = null, targetPrepareReport = null, liveGuardReport = null) {
  if (liveGuardBlocksTask(liveGuardReport)) return 'blocked';
  if (targetPrepareBlocksTask(targetPrepareReport)) return 'blocked';
  const finalReport = fixReport || dryRunReport;
  if (blockedPreflightStatuses.has(finalReport.status)) return 'blocked';
  if (finalReport.status === 'fixed' || finalReport.status === 'ready') return 'ready';
  if (finalReport.status === 'needs_fix') return 'needs_fix';
  return finalReport.status;
}

function traceForTask({ task, benchmarkUrl, targetPrepareReport, liveGuardReport, dryRunReport, fixReport, startedAt }) {
  const finalReport = fixReport || dryRunReport;
  const status = taskStatusFromReports(dryRunReport, fixReport, targetPrepareReport, liveGuardReport);
  const events = [];
  if (targetPrepareReport) {
    events.push({
      timestamp: targetPrepareReport.timestamp || startedAt,
      type: 'target_prepare',
      label: `Target prepare ${targetPrepareReport.status}`,
      target: task.id,
      countsAsStep: false,
      value: {
        prepareStatus: targetPrepareReport.status,
        reason: targetPrepareReport.reason || '',
        benchmarkUrl
      }
    });
  }
  if (liveGuardReport) {
    events.push({
      timestamp: liveGuardReport.timestamp || startedAt,
      type: 'live_target_guard',
      label: `Live target guard ${liveGuardReport.verdict}`,
      target: task.id,
      countsAsStep: false,
      value: {
        guardVerdict: liveGuardReport.verdict,
        reason: liveGuardReport.reason || '',
        benchmarkUrl
      }
    });
  }
  events.push({
    timestamp: finalReport.timestamp || startedAt,
    type: 'preflight',
    label: `Preflight ${finalReport.status}`,
    target: task.id,
    countsAsStep: false,
    value: {
      taskStatus: status,
      dryRunStatus: dryRunReport.status,
      fixStatus: fixReport?.status || null,
      reason: finalReport.reason || '',
      benchmarkUrl
    }
  });
  return sanitizeForOutput({
    traceVersion: 1,
    source: 'ui-tars-benchmark-harness',
    traceId: `harness-${compactTimestamp(startedAt)}-${task.id}`,
    taskId: task.id,
    taskTitle: task.title,
    startedAt,
    events
  });
}

async function writeJson(path, value) {
  const sanitized = sanitizeForOutput(value);
  const sensitiveErrors = inspectSensitiveOutput(sanitized, path);
  if (sensitiveErrors.length > 0) {
    throw new Error(`Refusing to write sensitive benchmark harness JSON: ${sensitiveErrors.join('; ')}`);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(sanitized, null, 2)}\n`, 'utf8');
  return sanitized;
}

async function writeText(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, 'utf8');
}

function runExportFromTrace(trace, tasks) {
  const runs = tracesToRuns([trace], tasks);
  const runErrors = runs.flatMap((run, index) => validateRun(run).map((error) => `runs[${index}]: ${error}`));
  if (runErrors.length > 0) {
    throw new Error(`Harness produced invalid run export: ${runErrors.join('; ')}`);
  }
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    runs
  };
}

export async function runBenchmarkHarness(options = {}) {
  const createdAt = (options.now || new Date()).toISOString();
  const outputDir = options.outputDir || defaultBenchmarkHarnessOutputDir(new Date(createdAt));
  const tasks = await loadTasks(options.tasksPath);
  const taskErrors = validateTasks(tasks);
  if (taskErrors.length > 0) {
    throw new Error(`Task registry validation failed: ${taskErrors.join('; ')}`);
  }

  const selectedTasks = parseTaskSelection(options.tasks || 'all', tasks);
  const benchmarkUrls = new Map(selectedTasks.map((task) => [
    task.id,
    taskBenchmarkUrl(options.baseUrl || DEFAULT_HARNESS_BASE_URL, task, {
      allowRemoteBenchmark: options.allowRemoteBenchmark
    })
  ]));

  await mkdir(outputDir, { recursive: true });

  const metadata = {
    schemaVersion: HARNESS_SCHEMA_VERSION,
    createdAt,
    source: 'ui-tars-benchmark-harness',
    outputDir,
    options: {
      tasks: options.tasks || 'all',
      baseUrl: sanitizeUrl(options.baseUrl || DEFAULT_HARNESS_BASE_URL),
      cdpEndpoint: options.cdpUrl ? sanitizeUrl(options.cdpUrl) : '',
      discoverLocalUitars: Boolean(options.discoverLocalUitars),
      prepareTarget: Boolean(options.prepareTarget),
      isolateTarget: Boolean(options.isolateTarget),
      preflightFix: Boolean(options.preflightFix),
      confirmExplicitCdpFix: Boolean(options.confirmExplicitCdpFix),
      allowRemoteCdp: Boolean(options.allowRemoteCdp),
      allowRemoteBenchmark: Boolean(options.allowRemoteBenchmark),
      requireLiveGuard: Boolean(options.requireLiveGuard)
    },
    tasks: []
  };

  for (const task of selectedTasks) {
    const benchmarkUrl = benchmarkUrls.get(task.id);
    const taskDir = join(outputDir, 'tasks', task.id);
    await mkdir(taskDir, { recursive: true });
    await writeText(join(taskDir, 'prompt.txt'), `${promptForTask(task, benchmarkUrl)}\n`);

    const preflightOptions = {
      benchmarkUrl,
      cdpUrl: options.cdpUrl,
      discoverLocalUitars: options.discoverLocalUitars,
      allowRemoteCdp: options.allowRemoteCdp,
      allowRemoteBenchmark: options.allowRemoteBenchmark,
      source: options.discoverLocalUitars && !options.cdpUrl ? 'discovered-local-uitars' : 'explicit',
      timeoutMs: options.timeoutMs
    };

    let targetPrepareReport = null;
    if (options.prepareTarget) {
      targetPrepareReport = await prepareUitarsTarget({
        ...preflightOptions,
        confirmExplicitCdpFix: options.confirmExplicitCdpFix,
        isolateTarget: options.isolateTarget
      });
      await writePreflightReport(sanitizeForOutput(targetPrepareReport), join(taskDir, 'target-prepare.json'));
    }

    let liveGuardReport = null;
    if (options.requireLiveGuard) {
      liveGuardReport = await evaluateLiveTargetGuard({
        cdpUrl: options.cdpUrl,
        discoverLocalUitars: options.discoverLocalUitars,
        benchmarkUrl,
        taskId: task.id,
        allowRemoteCdp: options.allowRemoteCdp,
        allowRemoteBenchmark: options.allowRemoteBenchmark,
        timeoutMs: options.timeoutMs,
        requireRendererState: false
      });
      await writeJson(join(taskDir, 'target-live-guard.json'), liveGuardReport);

      if (liveGuardBlocksTask(liveGuardReport)) {
        metadata.tasks.push({
          id: task.id,
          title: task.title,
          status: 'blocked',
          benchmarkUrl: sanitizeUrl(benchmarkUrl),
          targetPrepareStatus: targetPrepareReport?.status || null,
          liveGuardVerdict: liveGuardReport.verdict,
          dryRunStatus: null,
          fixStatus: null,
          reason: sanitizeString(liveGuardReport.reason || ''),
          files: {
            prompt: `tasks/${task.id}/prompt.txt`,
            targetPrepare: targetPrepareReport ? `tasks/${task.id}/target-prepare.json` : null,
            targetLiveGuard: `tasks/${task.id}/target-live-guard.json`,
            preflightDryRun: null,
            preflightFix: null,
            trace: null,
            runExport: null
          }
        });
        continue;
      }
    }

    const dryRunReport = await runUitarsPreflight({ ...preflightOptions, fix: false });
    await writePreflightReport(sanitizeForOutput(dryRunReport), join(taskDir, 'preflight-dry-run.json'));

    let fixReport = null;
    if (options.preflightFix) {
      fixReport = await runUitarsPreflight({
        ...preflightOptions,
        fix: true,
        confirmExplicitCdpFix: options.confirmExplicitCdpFix
      });
      await writePreflightReport(sanitizeForOutput(fixReport), join(taskDir, 'preflight-fix.json'));
    }

    const trace = traceForTask({
      task,
      benchmarkUrl: sanitizeUrl(benchmarkUrl),
      targetPrepareReport,
      liveGuardReport,
      dryRunReport,
      fixReport,
      startedAt: createdAt
    });
    const runExport = runExportFromTrace(trace, tasks);

    await writeJson(join(taskDir, 'trace.json'), trace);
    await writeJson(join(taskDir, 'run-export.json'), runExport);

    const taskStatus = taskStatusFromReports(dryRunReport, fixReport, targetPrepareReport, liveGuardReport);
    const statusReasonReport = liveGuardBlocksTask(liveGuardReport)
      ? liveGuardReport
      : targetPrepareBlocksTask(targetPrepareReport) ? targetPrepareReport : (fixReport || dryRunReport);
    metadata.tasks.push({
      id: task.id,
      title: task.title,
      status: taskStatus,
      benchmarkUrl: sanitizeUrl(benchmarkUrl),
      targetPrepareStatus: targetPrepareReport?.status || null,
      liveGuardVerdict: liveGuardReport?.verdict || null,
      dryRunStatus: dryRunReport.status,
      fixStatus: fixReport?.status || null,
      reason: sanitizeString(statusReasonReport.reason || ''),
      files: {
        prompt: `tasks/${task.id}/prompt.txt`,
        targetPrepare: targetPrepareReport ? `tasks/${task.id}/target-prepare.json` : null,
        targetLiveGuard: liveGuardReport ? `tasks/${task.id}/target-live-guard.json` : null,
        preflightDryRun: `tasks/${task.id}/preflight-dry-run.json`,
        preflightFix: fixReport ? `tasks/${task.id}/preflight-fix.json` : null,
        trace: `tasks/${task.id}/trace.json`,
        runExport: `tasks/${task.id}/run-export.json`
      }
    });
  }

  await writeJson(join(outputDir, 'metadata.json'), metadata);

  return sanitizeForOutput({
    outputDir,
    createdAt,
    totalTasks: metadata.tasks.length,
    blockedTasks: metadata.tasks.filter((task) => task.status === 'blocked').length,
    tasks: metadata.tasks
  });
}
