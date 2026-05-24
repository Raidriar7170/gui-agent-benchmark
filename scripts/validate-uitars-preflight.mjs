#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PREFLIGHT_SCHEMA_VERSION,
  isBenchmarkTarget,
  validatePreflightReport
} from '../src/uitars-preflight.mjs';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

async function loadReport(path) {
  if (!path) {
    return {
      schemaVersion: PREFLIGHT_SCHEMA_VERSION,
      source: 'sample',
      timestamp: '2026-05-21T00:00:00.000Z',
      status: 'needs_fix',
      reason: 'Synthetic dry-run report for schema validation.',
      mode: { fix: false },
      benchmark: {
        url: 'http://127.0.0.1:4173/?task=onboarding-form',
        origin: 'http://127.0.0.1:4173',
        path: '/'
      },
      cdp: {
        endpoint: 'http://127.0.0.1:9222/',
        version: {
          browser: 'Chrome/125.0.0.0',
          protocolVersion: '1.3'
        }
      },
      actions: [
        {
          action: 'dry_run_match',
          status: 'planned',
          target: {
            id: 'target-1',
            type: 'page',
            title: 'Google',
            url: 'https://www.google.com/'
          },
          navigateTo: 'http://127.0.0.1:4173/?task=onboarding-form'
        }
      ],
      targetsBefore: [
        {
          id: 'target-1',
          type: 'page',
          title: 'Google',
          url: 'https://www.google.com/'
        }
      ],
      targetsAfter: [],
      warnings: []
    };
  }
  return JSON.parse(await readFile(path, 'utf8'));
}

function collectObjectKeys(value, keys = []) {
  if (!value || typeof value !== 'object') return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.push(key);
    collectObjectKeys(child, keys);
  }
  return keys;
}

function runCredentialLeakFixture() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      'scripts/uitars-preflight-runner.mjs',
      '--cdp-url',
      'http://user:pass@127.0.0.1:9'
    ], {
      cwd: rootDir,
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
    child.on('close', (code) => {
      const output = `${stdout}\n${stderr}`;
      if (code === 0) {
        reject(new Error('credential leak fixture unexpectedly succeeded'));
        return;
      }
      if (/user|pass|user:pass@/i.test(output)) {
        reject(new Error('credential leak fixture output included CDP credentials'));
        return;
      }
      resolve();
    });
  });
}

const reportPath = process.argv[2];
const errors = [];
const report = await loadReport(reportPath);
errors.push(...validatePreflightReport(report));

const targetJson = JSON.stringify({
  targetsBefore: report.targetsBefore,
  targetsAfter: report.targetsAfter
});
const forbiddenTargetPatterns = [
  /webSocketDebuggerUrl/i,
  /base64/i,
  /api_?key/i,
  /token/i,
  /password/i,
  /cookie/i,
  /localStorage/i,
  /screenshot/i
];
for (const pattern of forbiddenTargetPatterns) {
  assert(!pattern.test(targetJson), `targets include prohibited content matching ${pattern}`, errors);
}

const topLevelKeys = collectObjectKeys(report);
assert(!topLevelKeys.includes('webSocketDebuggerUrl'), 'report must not expose webSocketDebuggerUrl fields', errors);

if (!reportPath) {
  assert(
    !isBenchmarkTarget({
      id: 'chrome-error',
      type: 'page',
      title: '127.0.0.1',
      url: 'http://127.0.0.1:4173/?task=onboarding-form'
    }, 'http://127.0.0.1:4173/?task=onboarding-form'),
    'Chrome error pages at the requested URL must not count as ready benchmark targets',
    errors
  );

  const leakedReport = structuredClone(report);
  leakedReport.cdp.webSocketDebuggerUrl = 'ws://127.0.0.1:9222/devtools/page/1';
  assert(
    validatePreflightReport(leakedReport).some((error) => error.includes('webSocketDebuggerUrl')),
    'validator must reject nested webSocketDebuggerUrl fields',
    errors
  );

  const userInfoReport = structuredClone(report);
  userInfoReport.actions[0].navigateTo = 'http://user:pass@127.0.0.1:4173/';
  assert(
    validatePreflightReport(userInfoReport).some((error) => error.includes('sensitive-looking content')),
    'validator must reject userinfo-bearing URLs anywhere in the report',
    errors
  );

  try {
    await runCredentialLeakFixture();
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
}

if (errors.length > 0) {
  console.error('UI-TARS preflight validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`UI-TARS preflight validation passed${reportPath ? ` for ${reportPath}` : ' for synthetic report'}.`);
