#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

import { loadTasks } from '../src/task-registry.mjs';
import {
  REAL_ROUND_SCHEMA_VERSION,
  formatRealRoundRunLog,
  planRealRound,
  summarizeRealRound
} from '../src/uitars-real-round.mjs';

const errors = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

async function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/uitars-real-round.mjs', ...args], {
      cwd: new URL('..', import.meta.url),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('exit', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

function capture({ score, success, selectedTicketId = '', reviewed = false }) {
  return {
    schemaVersion: 1,
    source: 'ui-tars-real-run-capture',
    capturedAt: '2026-05-23T00:00:00.000Z',
    taskId: 'ticket-review',
    finalState: {
      activeTaskId: 'ticket-review',
      table: { query: selectedTicketId, selectedTicketId },
      tickets: [
        {
          id: 'INC-2048',
          requester: 'Priya Shah',
          reviewed
        }
      ]
    },
    evaluation: {
      success,
      score,
      details: [
        {
          criterion: 'INC-2048 is marked reviewed',
          pass: reviewed,
          expected: true,
          actual: reviewed
        }
      ]
    }
  };
}

const tasks = await loadTasks();
const selectedTasks = tasks.filter((task) => ['onboarding-form', 'ticket-review'].includes(task.id));
const plan = planRealRound({
  tasks: selectedTasks,
  outputDir: 'experiments/example-real-round',
  baseUrl: 'http://127.0.0.1:4173',
  discoverLocalUitars: true,
  isolateTarget: true,
  now: new Date('2026-05-23T00:00:00.000Z')
});

assert(plan.schemaVersion === REAL_ROUND_SCHEMA_VERSION, 'plan should include schema version');
assert(plan.tasks.length === 2, 'plan should include selected tasks');
assert(plan.tunnel.remoteProxyPort === 8001, 'plan should pin the UI-TARS proxy port');
assert(plan.tunnel.localPort === 18001, 'plan should pin the default local tunnel port');
assert(plan.tunnel.sshCommand.includes('127.0.0.1:8001'), 'plan should show the 8001 proxy tunnel command');

const onboarding = plan.tasks.find((task) => task.id === 'onboarding-form');
assert(onboarding.initialPrompt.includes('call_user()'), 'initial prompt should force call_user on wrong pages');
assert(onboarding.initialPrompt.includes('Maya Ortiz'), 'initial prompt should include task instruction');
assert(onboarding.continuePrompt.includes('Continue now'), 'continue prompt should be distinct from initial prompt');
assert(onboarding.commands.preflightFix.includes('npm run uitars:preflight'), 'plan should include a preflight fix command');
assert(onboarding.commands.preflightFix.includes('--fix'), 'preflight command should enable fix mode');
assert(onboarding.commands.prepareAfterCallUser.includes('--isolate-target'), 'prepare command should isolate targets');
assert(onboarding.commands.capture.includes('npm run uitars:capture'), 'plan should include capture command');

const tempDir = await mkdtemp(join(tmpdir(), 'uitars-real-round-'));
try {
  const outputDir = join(tempDir, 'round');
  const firstCapturePath = join(outputDir, 'tasks', 'ticket-review', 'real-run', 'capture.json');
  const secondCapturePath = join(outputDir, 'tasks', 'ticket-review', 'real-run-attempt2', 'capture.json');
  await mkdir(join(outputDir, 'tasks', 'ticket-review', 'real-run'), { recursive: true });
  await mkdir(join(outputDir, 'tasks', 'ticket-review', 'real-run-attempt2'), { recursive: true });
  await writeFile(firstCapturePath, `${JSON.stringify(capture({ score: 0, success: false }), null, 2)}\n`, 'utf8');
  await writeFile(secondCapturePath, `${JSON.stringify(capture({
    score: 1,
    success: true,
    selectedTicketId: 'INC-2048',
    reviewed: true
  }), null, 2)}\n`, 'utf8');

  const summary = await summarizeRealRound({
    outputDir,
    tasks: selectedTasks,
    now: new Date('2026-05-23T01:00:00.000Z')
  });
  assert(summary.tasks.find((task) => task.id === 'ticket-review')?.score === 1, 'summary should choose the latest capture for a task');
  assert(summary.tasks.find((task) => task.id === 'ticket-review')?.captureCount === 2, 'summary should record all capture attempts');
  assert(summary.averageScore === 1, 'summary average should use captured tasks only');

  const log = formatRealRoundRunLog({ plan, summary });
  assert(log.includes('# UI-TARS Real E2E Round'), 'run log should have a title');
  assert(log.includes('18001 -> remote 8001'), 'run log should document the required proxy tunnel');
  assert(log.includes('ticket-review'), 'run log should include task rows');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

const help = await runCli(['--help']);
assert(help.exitCode === 0, 'CLI help should exit 0');
assert(help.stdout.includes('UI-TARS real E2E round'), 'CLI help should describe the command');

if (errors.length > 0) {
  console.error('Real round validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Real round validation passed.');
