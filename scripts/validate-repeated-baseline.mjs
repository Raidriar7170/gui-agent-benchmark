#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

import {
  REPEATED_BASELINE_SCHEMA_VERSION,
  buildRepeatedBaselineSummary,
  writeRepeatedBaselineSummary
} from '../src/repeated-baseline.mjs';

const errors = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function roundSummary(roundId, scores) {
  return {
    schemaVersion: 1,
    source: 'ui-tars-real-e2e-round-summary',
    createdAt: `2026-05-23T0${roundId}:00:00.000Z`,
    outputDir: `experiments/repeated/round-${roundId}`,
    totalTasks: 4,
    capturedTasks: 4,
    successTasks: scores.filter((entry) => entry.success).length,
    averageScore: Number((scores.reduce((sum, entry) => sum + entry.score, 0) / scores.length).toFixed(2)),
    tasks: scores.map((entry) => ({
      id: entry.id,
      title: entry.title,
      status: 'captured',
      success: entry.success,
      score: entry.score,
      captureCount: 1,
      capturePath: `experiments/repeated/round-${roundId}/tasks/${entry.id}/capture.json`,
      selectedCaptureDir: 'real-run',
      failedCriteria: entry.success ? [] : ['criterion']
    }))
  };
}

async function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/uitars-repeated-baseline.mjs', ...args], {
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

const rounds = [
  roundSummary(1, [
    { id: 'onboarding-form', title: 'Submit onboarding request', score: 0.17, success: false },
    { id: 'catalog-filter', title: 'Find approved desk gear', score: 0, success: false },
    { id: 'settings-toggle', title: 'Update workspace settings', score: 0.75, success: false },
    { id: 'ticket-review', title: 'Review priority support ticket', score: 0, success: false }
  ]),
  roundSummary(2, [
    { id: 'onboarding-form', title: 'Submit onboarding request', score: 0.5, success: false },
    { id: 'catalog-filter', title: 'Find approved desk gear', score: 1, success: true },
    { id: 'settings-toggle', title: 'Update workspace settings', score: 1, success: true },
    { id: 'ticket-review', title: 'Review priority support ticket', score: 0, success: false }
  ]),
  roundSummary(3, [
    { id: 'onboarding-form', title: 'Submit onboarding request', score: 1, success: true },
    { id: 'catalog-filter', title: 'Find approved desk gear', score: 0, success: false },
    { id: 'settings-toggle', title: 'Update workspace settings', score: 0.75, success: false },
    { id: 'ticket-review', title: 'Review priority support ticket', score: 0.33, success: false }
  ])
];

const summary = buildRepeatedBaselineSummary({
  outputDir: 'experiments/repeated',
  rounds,
  createdAt: '2026-05-23T10:00:00.000Z'
});

assert(summary.schemaVersion === REPEATED_BASELINE_SCHEMA_VERSION, 'summary should include repeated baseline schema version');
assert(summary.roundCount === 3, 'summary should include three rounds');
assert(summary.totalTaskAttempts === 12, 'summary should count all task attempts');
assert(summary.overall.averageScore === 0.4583, `unexpected overall average ${summary.overall.averageScore}`);
assert(summary.overall.successRate === 0.25, `unexpected success rate ${summary.overall.successRate}`);

const onboarding = summary.tasks.find((task) => task.id === 'onboarding-form');
assert(onboarding.meanScore === 0.5567, `unexpected onboarding mean ${onboarding?.meanScore}`);
assert(onboarding.passRate === 0.3333, `unexpected onboarding pass rate ${onboarding?.passRate}`);
assert(onboarding.scoreVariance > 0, 'onboarding should have non-zero variance');

const tempDir = await mkdtemp(join(tmpdir(), 'repeated-baseline-'));
try {
  const roundPaths = [];
  for (let index = 0; index < rounds.length; index += 1) {
    const path = join(tempDir, `round-${index + 1}.json`);
    await writeFile(path, `${JSON.stringify(rounds[index], null, 2)}\n`, 'utf8');
    roundPaths.push(path);
  }

  const outputPath = join(tempDir, 'summary.json');
  await writeRepeatedBaselineSummary({
    outputPath,
    outputDir: tempDir,
    roundSummaryPaths: roundPaths,
    createdAt: '2026-05-23T10:00:00.000Z'
  });
  const written = JSON.parse(await readFile(outputPath, 'utf8'));
  assert(written.roundCount === 3, 'writeRepeatedBaselineSummary should write three-round summary');

  const cli = await runCli(['--output', outputPath, '--rounds', roundPaths.join(',')]);
  assert(cli.exitCode === 0, 'repeated baseline CLI should exit 0');
  assert(cli.stdout.includes('Wrote repeated baseline summary'), 'CLI should report summary output');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

let rejected = false;
try {
  buildRepeatedBaselineSummary({
    outputDir: 'experiments/repeated',
    rounds: rounds.slice(0, 2)
  });
} catch (error) {
  rejected = true;
  assert(error.message.includes('at least 3 rounds'), 'summary should require at least three rounds');
}
assert(rejected, 'buildRepeatedBaselineSummary should reject fewer than three rounds');

if (errors.length > 0) {
  console.error('Repeated baseline validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Repeated baseline validation passed.');
