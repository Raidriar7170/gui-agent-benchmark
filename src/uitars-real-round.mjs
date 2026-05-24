import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DEFAULT_HARNESS_BASE_URL } from './benchmark-harness.mjs';

export const REAL_ROUND_SCHEMA_VERSION = 1;

function compactTimestamp(timestamp) {
  return timestamp.replace(/\D/g, '').slice(0, 14);
}

export function defaultRealRoundOutputDir(now = new Date()) {
  return join('experiments', `${compactTimestamp(now.toISOString())}-uitars-real-e2e`);
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function command(parts) {
  return parts.map(shellQuote).join(' ');
}

function taskBenchmarkUrl(baseUrl, task) {
  return new URL(task.startUrl, baseUrl || DEFAULT_HARNESS_BASE_URL).href;
}

function ensureTaskList(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error('planRealRound requires at least one task.');
  }
  return tasks;
}

export function selectRealRoundTasks(selection, tasks) {
  const raw = selection || 'all';
  if (raw === 'all') return tasks;
  const ids = raw.split(',').map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) throw new Error('--tasks must be "all" or a comma-separated list of task ids.');
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new Error(`Unknown task id${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`);
  }
  return ids.map((id) => byId.get(id));
}

export function initialPromptForTask(task) {
  return [
    'Benchmark task.',
    `If the current page is Google or anything other than the GUI Agent Benchmark ${task.id} task page, immediately use call_user() and do nothing else.`,
    `If the ${task.id} task page is visible, ${task.instruction}`,
    'Click Evaluate and stop after the judge result is visible.'
  ].join(' ');
}

export function continuePromptForTask(task) {
  return [
    'Continue now.',
    `The browser is now on the GUI Agent Benchmark ${task.id} task page.`,
    `Complete the task: ${task.instruction}`,
    'Click Evaluate and stop after the judge result is visible.'
  ].join(' ');
}

function cdpFlags({ discoverLocalUitars }) {
  return discoverLocalUitars ? ['--discover-local-uitars'] : [];
}

function taskPlan({ task, outputDir, baseUrl, discoverLocalUitars, isolateTarget }) {
  const benchmarkUrl = taskBenchmarkUrl(baseUrl, task);
  const realRunDir = join(outputDir, 'tasks', task.id, 'real-run');
  const afterCallUserDir = join(outputDir, 'task-prep', `${task.id}-after-call-user`);
  const beforeCaptureDir = join(outputDir, 'task-prep', `${task.id}-before-capture`);
  const discoverFlags = cdpFlags({ discoverLocalUitars });
  const isolateFlags = isolateTarget ? ['--isolate-target'] : [];

  return {
    id: task.id,
    title: task.title,
    benchmarkUrl,
    initialPrompt: initialPromptForTask(task),
    continuePrompt: continuePromptForTask(task),
    paths: {
      realRunDir,
      preflightFixAfterCallUser: join(realRunDir, 'preflight-fix-after-call-user.json'),
      prepareAfterCallUserOutput: afterCallUserDir,
      prepareBeforeCaptureOutput: beforeCaptureDir,
      capture: join(realRunDir, 'capture.json')
    },
    commands: {
      preflightFix: command([
        'npm', 'run', 'uitars:preflight', '--',
        ...discoverFlags,
        '--url', benchmarkUrl,
        '--fix',
        '--output', join(realRunDir, 'preflight-fix-after-call-user.json')
      ]),
      prepareAfterCallUser: command([
        'npm', 'run', 'uitars:harness', '--',
        '--output', afterCallUserDir,
        '--tasks', task.id,
        '--base-url', baseUrl,
        ...discoverFlags,
        '--prepare-target',
        ...isolateFlags
      ]),
      prepareBeforeCapture: command([
        'npm', 'run', 'uitars:harness', '--',
        '--output', beforeCaptureDir,
        '--tasks', task.id,
        '--base-url', baseUrl,
        ...discoverFlags,
        '--prepare-target',
        ...isolateFlags
      ]),
      capture: command([
        'npm', 'run', 'uitars:capture', '--',
        '--task', task.id,
        '--output', realRunDir,
        '--base-url', baseUrl,
        ...discoverFlags
      ])
    },
    manualSteps: [
      'Start a new UI-TARS Local Browser Operator chat.',
      'Send initialPrompt and wait for call_user() if UI-TARS opens Google or another wrong page.',
      'Run commands.preflightFix, then commands.prepareAfterCallUser.',
      'Send continuePrompt and let UI-TARS operate without manual task help.',
      'After the time budget or visible judge result, run commands.prepareBeforeCapture and commands.capture.'
    ]
  };
}

export function planRealRound(options = {}) {
  const now = options.now || new Date();
  const createdAt = now.toISOString();
  const baseUrl = options.baseUrl || DEFAULT_HARNESS_BASE_URL;
  const outputDir = options.outputDir || defaultRealRoundOutputDir(now);
  const tasks = ensureTaskList(options.tasks);
  const discoverLocalUitars = Boolean(options.discoverLocalUitars);
  const isolateTarget = options.isolateTarget !== false;

  return {
    schemaVersion: REAL_ROUND_SCHEMA_VERSION,
    source: 'ui-tars-real-e2e-round-plan',
    createdAt,
    outputDir,
    baseUrl,
    options: {
      discoverLocalUitars,
      isolateTarget
    },
    tunnel: {
      localPort: 18001,
      remoteProxyPort: 8001,
      remoteDirectVllmPort: 8000,
      modelsUrl: 'http://127.0.0.1:18001/v1/models',
      sshCommand: 'ssh -L 18001:127.0.0.1:8001 <remote-host>'
    },
    preflightCommand: command([
      'npm', 'run', 'uitars:harness', '--',
      '--output', outputDir,
      '--tasks', tasks.map((task) => task.id).join(','),
      '--base-url', baseUrl,
      ...(discoverLocalUitars ? ['--discover-local-uitars'] : []),
      '--prepare-target',
      ...(isolateTarget ? ['--isolate-target'] : [])
    ]),
    tasks: tasks.map((task) => taskPlan({
      task,
      outputDir,
      baseUrl,
      discoverLocalUitars,
      isolateTarget
    }))
  };
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function captureRank(name) {
  if (name === 'real-run') return 1;
  const match = name.match(/^real-run-attempt(\d+)$/);
  return match ? 1 + Number(match[1]) : 0;
}

async function findTaskCaptures(outputDir, taskId) {
  const taskDir = join(outputDir, 'tasks', taskId);
  if (!await pathExists(taskDir)) return [];
  const entries = await readdir(taskDir, { withFileTypes: true });
  const captures = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('real-run')) continue;
    const capturePath = join(taskDir, entry.name, 'capture.json');
    if (await pathExists(capturePath)) {
      captures.push({
        name: entry.name,
        path: capturePath,
        rank: captureRank(entry.name)
      });
    }
  }
  captures.sort((left, right) => left.rank - right.rank || left.name.localeCompare(right.name));
  return captures;
}

function failedCriteria(evaluation) {
  return (evaluation?.details || [])
    .filter((detail) => !detail.pass)
    .map((detail) => detail.criterion);
}

export async function summarizeRealRound(options = {}) {
  const now = options.now || new Date();
  const outputDir = options.outputDir;
  const tasks = ensureTaskList(options.tasks);
  if (!outputDir) throw new Error('summarizeRealRound requires outputDir.');

  const taskSummaries = [];
  for (const task of tasks) {
    const captures = await findTaskCaptures(outputDir, task.id);
    if (captures.length === 0) {
      taskSummaries.push({
        id: task.id,
        title: task.title,
        status: 'missing_capture',
        success: null,
        score: null,
        captureCount: 0,
        capturePath: '',
        failedCriteria: []
      });
      continue;
    }

    const selected = captures[captures.length - 1];
    const capture = JSON.parse(await readFile(selected.path, 'utf8'));
    const score = Number(capture?.evaluation?.score ?? 0);
    taskSummaries.push({
      id: task.id,
      title: task.title,
      status: 'captured',
      success: Boolean(capture?.evaluation?.success),
      score,
      captureCount: captures.length,
      capturePath: selected.path,
      selectedCaptureDir: selected.name,
      failedCriteria: failedCriteria(capture?.evaluation)
    });
  }

  const captured = taskSummaries.filter((task) => task.status === 'captured');
  const averageScore = captured.length === 0
    ? null
    : Number((captured.reduce((sum, task) => sum + task.score, 0) / captured.length).toFixed(4));

  return {
    schemaVersion: REAL_ROUND_SCHEMA_VERSION,
    source: 'ui-tars-real-e2e-round-summary',
    createdAt: now.toISOString(),
    outputDir,
    totalTasks: taskSummaries.length,
    capturedTasks: captured.length,
    successTasks: captured.filter((task) => task.success).length,
    averageScore,
    tasks: taskSummaries
  };
}

function scoreText(task) {
  return task.score === null ? 'n/a' : String(task.score);
}

export function formatRealRoundRunLog({ plan, summary }) {
  const lines = [
    '# UI-TARS Real E2E Round',
    '',
    `Generated: ${summary?.createdAt || plan.createdAt}`,
    `Output: \`${plan.outputDir}\``,
    '',
    '## Required Tunnel',
    '',
    '- Local model endpoint must be `http://127.0.0.1:18001`.',
    '- Tunnel binding must be `18001 -> remote 8001`; remote `8000` is direct vLLM and fails UI-TARS high `max_tokens` requests.',
    `- Example: \`${plan.tunnel.sshCommand}\``,
    '',
    '## Start Checks',
    '',
    '```sh',
    'npm run check:tunnel',
    'npm run check:remote',
    plan.preflightCommand,
    '```',
    '',
    '## Per-Task Loop',
    '',
    'For each task, send `initialPrompt`, wait for `call_user()` when UI-TARS lands on a search page, run `preflightFix` and `prepareAfterCallUser`, send `continuePrompt`, then run `prepareBeforeCapture` and `capture`.',
    ''
  ];

  if (summary) {
    lines.push('## Results', '');
    lines.push('| Task | Capture | Success | Score | Failed criteria |');
    lines.push('| --- | --- | --- | ---: | --- |');
    for (const task of summary.tasks) {
      const failed = task.failedCriteria.length > 0 ? task.failedCriteria.join('; ') : '';
      lines.push(`| ${task.id} | ${task.selectedCaptureDir || 'missing'} | ${task.success === null ? 'n/a' : task.success ? 'yes' : 'no'} | ${scoreText(task)} | ${failed} |`);
    }
    lines.push('', `Average score: ${summary.averageScore === null ? 'n/a' : summary.averageScore}`);
  }

  lines.push('', '## Task Commands', '');
  for (const task of plan.tasks) {
    lines.push(`### ${task.id}`, '');
    lines.push('Initial prompt:');
    lines.push('');
    lines.push('```text');
    lines.push(task.initialPrompt);
    lines.push('```');
    lines.push('');
    lines.push('Continue prompt:');
    lines.push('');
    lines.push('```text');
    lines.push(task.continuePrompt);
    lines.push('```');
    lines.push('');
    lines.push('```sh');
    lines.push(task.commands.preflightFix);
    lines.push(task.commands.prepareAfterCallUser);
    lines.push(task.commands.prepareBeforeCapture);
    lines.push(task.commands.capture);
    lines.push('```');
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

export async function writeRealRoundArtifacts({ outputDir, plan, summary }) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'round-plan.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  if (summary) {
    await writeFile(join(outputDir, 'real-run-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  }
  await writeFile(join(outputDir, 'run-log.md'), formatRealRoundRunLog({ plan, summary }), 'utf8');
}
