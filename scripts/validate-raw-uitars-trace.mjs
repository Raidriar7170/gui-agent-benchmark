#!/usr/bin/env node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

import {
  RAW_UITARS_TRACE_SCHEMA_VERSION,
  convertRawUitarsTraceToStepTrace,
  ingestRawUitarsTraceFile,
  summarizeRawUitarsTrace,
  validateRawUitarsTrace
} from '../src/uitars-raw-trace.mjs';
import { validateStepTrace } from '../src/step-trace.mjs';

const errors = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function rawTraceFixture() {
  return {
    schemaVersion: RAW_UITARS_TRACE_SCHEMA_VERSION,
    source: 'ui-tars-raw-transcript',
    taskId: 'settings-toggle',
    taskTitle: 'Update workspace settings',
    artifactBase: 'experiments/synthetic-raw',
    createdAt: '2026-05-23T00:00:00.000Z',
    events: [
      {
        id: 'raw-1',
        type: 'prompt',
        role: 'operator',
        timestamp: '2026-05-23T00:00:01.000Z',
        text: 'Complete the settings task.'
      },
      {
        id: 'raw-2',
        type: 'observation',
        role: 'assistant',
        timestamp: '2026-05-23T00:00:02.000Z',
        text: 'I can see the settings page with several toggles and a timezone dropdown.'
      },
      {
        id: 'raw-3',
        type: 'thought',
        role: 'assistant',
        timestamp: '2026-05-23T00:00:03.000Z',
        text: 'I should enable digest, disable analytics, then set the timezone.'
      },
      {
        id: 'raw-4',
        type: 'action',
        role: 'assistant',
        timestamp: '2026-05-23T00:00:04.000Z',
        action: {
          name: 'click',
          args: {
            target: 'Weekly email digest'
          }
        },
        text: 'Clicked weekly email digest.'
      },
      {
        id: 'raw-5',
        type: 'tool_result',
        role: 'tool',
        timestamp: '2026-05-23T00:00:05.000Z',
        text: 'Click completed.'
      },
      {
        id: 'raw-6',
        type: 'judge_result',
        role: 'benchmark',
        timestamp: '2026-05-23T00:00:06.000Z',
        evaluation: {
          success: false,
          score: 0.75,
          details: [
            {
              criterion: 'timezone is America/New_York',
              pass: false,
              expected: 'America/New_York',
              actual: 'UTC'
            }
          ]
        }
      }
    ],
    final: {
      success: false,
      score: 0.75,
      primaryFailureCode: 'ACT-DROPDOWN-VALUE-MISS',
      failedCriteria: [
        'timezone is America/New_York'
      ]
    }
  };
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/ingest-uitars-raw-trace.mjs', ...args], {
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

const fixture = rawTraceFixture();
assert(validateRawUitarsTrace(fixture).length === 0, 'valid raw UI-TARS fixture should pass validation');

const stepTrace = convertRawUitarsTraceToStepTrace(fixture);
assert(validateStepTrace(stepTrace).length === 0, 'converted raw UI-TARS trace should satisfy step trace schema');
assert(stepTrace.steps.length === fixture.events.length + 1, 'conversion should append a failure attribution step');
assert(stepTrace.steps[1].rawEventId === 'raw-2', 'converted steps should retain raw event ids');
assert(stepTrace.steps[1].evidence.kind === 'transcript_observation', 'observations should keep transcript evidence kind');
assert(stepTrace.steps.at(-1).failureCode === 'ACT-DROPDOWN-VALUE-MISS', 'failure attribution should use final primary failure code');

const summary = summarizeRawUitarsTrace(fixture);
assert(summary.eventCount === 6, 'summary should count raw events');
assert(summary.eventTypes.action === 1, 'summary should count action events');
assert(summary.hasJudgeResult === true, 'summary should detect judge result events');

const invalidEventType = structuredClone(fixture);
invalidEventType.events[0].type = 'html_dump';
assert(
  validateRawUitarsTrace(invalidEventType).some((error) => error.includes('events[0].type')),
  'validator should reject unsupported raw event types'
);

const invalidScreenshot = structuredClone(fixture);
invalidScreenshot.events[1].screenshotBase64 = 'data:image/png;base64,' + 'a'.repeat(600);
assert(
  validateRawUitarsTrace(invalidScreenshot).some((error) => error.includes('base64')),
  'validator should reject inline base64 screenshots'
);

const tempDir = await mkdtemp(join(tmpdir(), 'uitars-raw-trace-'));
try {
  const inputPath = join(tempDir, 'raw.json');
  const outputPath = join(tempDir, 'step.json');
  await import('node:fs/promises').then(({ writeFile }) => writeFile(inputPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8'));
  const ingested = await ingestRawUitarsTraceFile({
    inputPath,
    outputPath
  });
  assert(ingested.outputPath === outputPath, 'ingestRawUitarsTraceFile should report the output path');
  const written = JSON.parse(await readFile(outputPath, 'utf8'));
  assert(written.taskId === fixture.taskId, 'ingest should write a step trace for the same task');

  const cli = await runCli(['--input', inputPath, '--output', join(tempDir, 'cli-step.json')]);
  assert(cli.exitCode === 0, 'raw ingest CLI should exit 0 for a valid trace');
  assert(cli.stdout.includes('Wrote step trace'), 'raw ingest CLI should report success');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

if (errors.length > 0) {
  console.error('Raw UI-TARS trace validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Raw UI-TARS trace validation passed.');
