#!/usr/bin/env node
import { spawn } from 'node:child_process';
import {
  CHECK_FINISH_SCHEMA_VERSION,
  finishGateChecks,
  formatFinishGateSummary,
  runFinishGate
} from '../src/finish-gate.mjs';

const errors = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function makeRunner(outcomes) {
  const calls = [];
  const runner = async (check) => {
    calls.push(check.id);
    const outcome = outcomes[check.id];
    if (outcome instanceof Error) throw outcome;
    return {
      exitCode: outcome?.exitCode ?? 0,
      stdout: outcome?.stdout ?? `${check.id} ok`,
      stderr: outcome?.stderr ?? ''
    };
  };
  runner.calls = calls;
  return runner;
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/check-finish.mjs', ...args], {
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
    child.on('exit', (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

const allPassRunner = makeRunner({});
const allPass = await runFinishGate({
  now: new Date('2026-05-23T00:00:00.000Z'),
  runner: allPassRunner
});

assert(allPass.schemaVersion === CHECK_FINISH_SCHEMA_VERSION, 'report should include the finish gate schema version');
assert(allPass.source === 'gui-agent-benchmark-finish-gate', 'report should identify its source');
assert(allPass.ready === true, 'all passing checks should make the project ready');
assert(allPass.localReady === true, 'all passing local checks should make localReady true');
assert(allPass.integrationReady === true, 'all passing integration checks should make integrationReady true');
assert(allPass.checks.length === finishGateChecks.length, 'all checks should be present in the report');
assert(allPass.checks.every((check) => check.status === 'passed'), 'all passing checks should be marked passed');
assert(allPassRunner.calls.join(',') === finishGateChecks.map((check) => check.id).join(','), 'checks should run in declared order');

const failedIntegration = await runFinishGate({
  now: new Date('2026-05-23T00:00:00.000Z'),
  runner: makeRunner({
    tunnel: {
      exitCode: 1,
      stdout: '',
      stderr: 'Tunnel health check failed.\n- connect ECONNREFUSED 127.0.0.1:18001'
    },
    remote: {
      exitCode: 255,
      stdout: 'Running read-only remote health check on raidriar@127.0.0.1:22',
      stderr: 'Remote health check failed with exit code 255.\nssh: connect to host 127.0.0.1 port 22: Connection refused'
    }
  })
});

assert(failedIntegration.localReady === true, 'integration failures should not make localReady false');
assert(failedIntegration.integrationReady === false, 'failed integration check should make integrationReady false');
assert(failedIntegration.ready === false, 'failed required integration check should make overall ready false');
assert(failedIntegration.checks.find((check) => check.id === 'tunnel')?.status === 'failed', 'failed tunnel check should be marked failed');

const localOnlyRunner = makeRunner({});
const localOnly = await runFinishGate({
  localOnly: true,
  now: new Date('2026-05-23T00:00:00.000Z'),
  runner: localOnlyRunner
});

assert(localOnly.localReady === true, 'local-only mode should still prove localReady');
assert(localOnly.integrationReady === null, 'local-only mode should leave integrationReady unverified');
assert(localOnly.ready === true, 'local-only mode should use local readiness as the overall result');
assert(localOnly.checks.filter((check) => check.status === 'skipped').every((check) => check.category === 'integration'), 'local-only mode should skip only integration checks');
assert(!localOnlyRunner.calls.includes('tunnel') && !localOnlyRunner.calls.includes('remote'), 'local-only mode should not execute integration commands');

const thrown = await runFinishGate({
  now: new Date('2026-05-23T00:00:00.000Z'),
  runner: makeRunner({
    smoke: new Error('spawn failed')
  })
});

assert(thrown.localReady === false, 'thrown local command should make localReady false');
assert(thrown.checks.find((check) => check.id === 'smoke')?.status === 'failed', 'thrown command should be marked failed');
assert(thrown.checks.find((check) => check.id === 'smoke')?.stderrTail === 'spawn failed', 'thrown command should preserve the failure message');

const redacted = await runFinishGate({
  now: new Date('2026-05-23T00:00:00.000Z'),
  runner: makeRunner({
    validate: {
      stdout: 'api_key=abc123 token: secret password=hunter2 cookie=session',
      stderr: 'authorization: bearer secret'
    }
  })
});

const validateCheck = redacted.checks.find((check) => check.id === 'validate');
assert(validateCheck?.stdoutTail.includes('[redacted]'), 'stdout tail should redact sensitive-looking values');
assert(!validateCheck?.stdoutTail.includes('abc123'), 'stdout tail should not retain api key values');
assert(validateCheck?.stderrTail.includes('[redacted]'), 'stderr tail should redact sensitive-looking values');

const summary = formatFinishGateSummary(failedIntegration);
assert(summary.includes('Local ready: yes'), 'summary should include local readiness');
assert(summary.includes('Integration ready: no'), 'summary should include integration readiness');
assert(summary.includes('tunnel: failed'), 'summary should include failed checks');
assert(summary.includes('connect ECONNREFUSED 127.0.0.1:18001'), 'summary should include tunnel failure details');
assert(summary.includes('ssh: connect to host 127.0.0.1 port 22: Connection refused'), 'summary should include remote failure details');

const badArg = await runCli(['--wat']);
assert(badArg.exitCode === 1, 'CLI should exit 1 for unknown arguments');
assert(badArg.stderr.includes('Unknown argument: --wat'), 'CLI should print a concise argument error');
assert(!badArg.stderr.includes('at parseArgs'), 'CLI should not print a stack trace for argument errors');

if (errors.length > 0) {
  console.error('Finish gate validation failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Finish gate validation passed: ${finishGateChecks.length} checks, local-only and integration modes covered.`);
