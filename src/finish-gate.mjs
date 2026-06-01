import { spawn } from 'node:child_process';

export const CHECK_FINISH_SCHEMA_VERSION = 1;

export const finishGateChecks = [
  {
    id: 'validate',
    title: 'Synthetic validation suite',
    category: 'local',
    command: ['npm', 'run', 'validate']
  },
  {
    id: 'smoke',
    title: 'Static server smoke check',
    category: 'local',
    command: ['npm', 'run', 'smoke']
  },
  {
    id: 'local',
    title: 'Local tool and UI-TARS config check',
    category: 'local',
    command: ['node', 'scripts/check-local.mjs']
  },
  {
    id: 'tunnel',
    title: 'Model tunnel health check',
    category: 'integration',
    command: ['node', 'scripts/check-tunnel.mjs']
  },
  {
    id: 'remote',
    title: 'Remote UI-TARS read-only health check',
    category: 'integration',
    command: ['node', 'scripts/check-remote.mjs']
  }
];

const outputTailChars = 4000;

function toIso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function commandText(command) {
  return command.join(' ');
}

function tail(value) {
  const text = String(value ?? '');
  return text.length <= outputTailChars ? text : text.slice(-outputTailChars);
}

export function redactSensitiveOutput(value) {
  return tail(value)
    .replace(/\b(authorization)\b\s*[:=]\s*[^\r\n]+/gi, '$1: [redacted]')
    .replace(/\b(api_?key|token|password|passwd|cookie)\b\s*[:=]\s*[^\s&]+/gi, '$1=[redacted]')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, '$1');
}

function runCommand(check, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const [command, ...args] = check.command;
    const child = spawn(command, args, {
      cwd,
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
      resolve({
        exitCode: exitCode ?? 1,
        stdout,
        stderr
      });
    });
  });
}

async function runCheck(check, { cwd, runner }) {
  const started = Date.now();
  try {
    const result = await runner(check, { cwd });
    const exitCode = Number.isInteger(result?.exitCode) ? result.exitCode : 1;
    return {
      id: check.id,
      title: check.title,
      category: check.category,
      required: true,
      command: commandText(check.command),
      status: exitCode === 0 ? 'passed' : 'failed',
      exitCode,
      durationMs: Date.now() - started,
      stdoutTail: redactSensitiveOutput(result?.stdout || ''),
      stderrTail: redactSensitiveOutput(result?.stderr || '')
    };
  } catch (error) {
    return {
      id: check.id,
      title: check.title,
      category: check.category,
      required: true,
      command: commandText(check.command),
      status: 'failed',
      exitCode: null,
      durationMs: Date.now() - started,
      stdoutTail: '',
      stderrTail: redactSensitiveOutput(error instanceof Error ? error.message : String(error))
    };
  }
}

function skippedCheck(check) {
  return {
    id: check.id,
    title: check.title,
    category: check.category,
    required: true,
    command: commandText(check.command),
    status: 'skipped',
    exitCode: null,
    durationMs: 0,
    stdoutTail: '',
    stderrTail: ''
  };
}

function readinessFor(checks, category) {
  const relevant = checks.filter((check) => check.category === category && check.status !== 'skipped');
  return relevant.length > 0 && relevant.every((check) => check.status === 'passed');
}

export async function runFinishGate(options = {}) {
  const localOnly = Boolean(options.localOnly);
  const runner = options.runner || runCommand;
  const checks = [];

  for (const check of finishGateChecks) {
    if (localOnly && check.category === 'integration') {
      checks.push(skippedCheck(check));
    } else {
      checks.push(await runCheck(check, { cwd: options.cwd, runner }));
    }
  }

  const localReady = readinessFor(checks, 'local');
  const integrationReady = localOnly ? null : readinessFor(checks, 'integration');

  return {
    schemaVersion: CHECK_FINISH_SCHEMA_VERSION,
    source: 'gui-agent-benchmark-finish-gate',
    createdAt: toIso(options.now || new Date()),
    mode: {
      localOnly
    },
    localReady,
    integrationReady,
    ready: localOnly ? localReady : localReady && integrationReady,
    checks
  };
}

export function toPublicFinishGateReport(report) {
  const checks = Array.isArray(report?.checks)
    ? report.checks.map((check) => ({
      id: check.id,
      title: check.title,
      category: check.category,
      required: check.required,
      command: check.command,
      status: check.status,
      exitCode: check.exitCode,
      durationMs: check.durationMs
    }))
    : [];

  return {
    schemaVersion: report.schemaVersion,
    source: report.source,
    createdAt: report.createdAt,
    mode: report.mode,
    localReady: report.localReady,
    integrationReady: report.integrationReady,
    ready: report.ready,
    outputPolicy: {
      publicSummary: true,
      omittedFields: ['checks[].stdoutTail', 'checks[].stderrTail'],
      note: 'stdout/stderr tails are omitted from public artifacts; rerun the finish gate locally for private logs.'
    },
    checks
  };
}

export function formatFinishGateSummary(report) {
  function failureDetails(check) {
    return [check.stderrTail, check.stdoutTail]
      .filter(Boolean)
      .flatMap((value) => value.split(/\r?\n/))
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 4);
  }

  const lines = [
    `Finish gate: ${report.ready ? 'ready' : 'not ready'}`,
    `Local ready: ${report.localReady ? 'yes' : 'no'}`,
    `Integration ready: ${report.integrationReady === null ? 'not checked' : report.integrationReady ? 'yes' : 'no'}`,
    '',
    'Checks:'
  ];

  for (const check of report.checks) {
    lines.push(`- ${check.id}: ${check.status} (${check.command})`);
    if (check.status === 'failed') {
      for (const detail of failureDetails(check)) {
        lines.push(`  ${detail}`);
      }
    }
  }

  return lines.join('\n');
}
