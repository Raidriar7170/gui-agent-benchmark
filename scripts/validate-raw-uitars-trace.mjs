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
        artifactRefs: [
          'tasks/settings-toggle/raw/action-raw-4.json'
        ],
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
        artifactRefs: [
          'tasks/settings-toggle/raw/tool-result-raw-5.json'
        ],
        screenshotRef: 'tasks/settings-toggle/screenshots/tool-result-raw-5.png',
        text: 'Click completed.'
      },
      {
        id: 'raw-6',
        type: 'capture',
        role: 'capture',
        timestamp: '2026-05-23T00:00:06.000Z',
        artifactRefs: [
          'tasks/settings-toggle/raw/capture-raw-6.json'
        ],
        screenshotRef: 'tasks/settings-toggle/screenshots/capture-raw-6.png',
        text: 'Captured final browser state after tool result.'
      },
      {
        id: 'raw-7',
        type: 'judge_result',
        role: 'benchmark',
        timestamp: '2026-05-23T00:00:07.000Z',
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
const actionStep = stepTrace.steps.find((step) => step.rawEventId === 'raw-4');
assert(
  actionStep?.evidence.references.includes('tasks/settings-toggle/raw/action-raw-4.json'),
  'converted action steps should retain external artifact references'
);
const toolResultStep = stepTrace.steps.find((step) => step.rawEventId === 'raw-5');
assert(
  toolResultStep?.evidence.references.includes('tasks/settings-toggle/raw/tool-result-raw-5.json') &&
    toolResultStep?.evidence.references.includes('tasks/settings-toggle/screenshots/tool-result-raw-5.png'),
  'converted tool_result steps should retain external artifact and screenshot references'
);
const captureStep = stepTrace.steps.find((step) => step.rawEventId === 'raw-6');
assert(
  captureStep?.evidence.references.includes('tasks/settings-toggle/raw/capture-raw-6.json') &&
    captureStep?.evidence.references.includes('tasks/settings-toggle/screenshots/capture-raw-6.png'),
  'converted capture steps should retain external artifact and screenshot references'
);

const summary = summarizeRawUitarsTrace(fixture);
assert(summary.eventCount === 7, 'summary should count raw events');
assert(summary.eventTypes.action === 1, 'summary should count action events');
assert(summary.eventTypes.capture === 1, 'summary should count capture events');
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

for (const eventType of ['action', 'tool_result', 'capture']) {
  const missingRefs = structuredClone(fixture);
  const eventIndex = missingRefs.events.findIndex((event) => event.type === eventType);
  delete missingRefs.events[eventIndex].artifactRefs;
  delete missingRefs.events[eventIndex].screenshotRef;
  assert(
    validateRawUitarsTrace(missingRefs).some(
      (error) => error.includes(`events[${eventIndex}]`) && error.includes('artifactRefs or screenshotRef')
    ),
    `validator should reject ${eventType} events without external artifact references`
  );
}

const emptyArtifactRefs = structuredClone(fixture);
emptyArtifactRefs.events[3].artifactRefs = [];
assert(
  validateRawUitarsTrace(emptyArtifactRefs).some(
    (error) => error.includes('events[3].artifactRefs') && error.includes('non-empty string array')
  ),
  'validator should reject empty artifactRefs arrays'
);

const invalidArtifactRefs = structuredClone(fixture);
invalidArtifactRefs.events[3].artifactRefs = ['tasks/settings-toggle/raw/action-raw-4.json', ''];
assert(
  validateRawUitarsTrace(invalidArtifactRefs).some(
    (error) => error.includes('events[3].artifactRefs') && error.includes('non-empty string array')
  ),
  'validator should reject artifactRefs with empty items'
);

const invalidScreenshotRef = structuredClone(fixture);
invalidScreenshotRef.events[4].screenshotRef = ' ';
assert(
  validateRawUitarsTrace(invalidScreenshotRef).some(
    (error) => error.includes('events[4].screenshotRef') && error.includes('non-empty string')
  ),
  'validator should reject empty screenshotRef values'
);

const invalidReferenceCases = [
  ['path traversal', '../secret.json'],
  ['absolute path', '/Users/me/private.png'],
  ['URL credentials', 'https://u:p@example.com/x.png'],
  ['control characters', 'tasks/settings-toggle/screenshots/action\nraw-4.png'],
  ['data image payload', 'data:image/png;base64,aW1hZ2U='],
  ['base64-looking payload', 'a'.repeat(520)]
];

for (const [caseName, ref] of invalidReferenceCases) {
  const invalidArtifactRef = structuredClone(fixture);
  invalidArtifactRef.events[3].artifactRefs = [ref];
  assert(
    validateRawUitarsTrace(invalidArtifactRef).some(
      (error) => error.includes('events[3].artifactRefs') && error.includes('valid external artifact reference')
    ),
    `validator should reject artifactRefs with ${caseName}`
  );

  const invalidScreenshotReference = structuredClone(fixture);
  invalidScreenshotReference.events[4].screenshotRef = ref;
  assert(
    validateRawUitarsTrace(invalidScreenshotReference).some(
      (error) => error.includes('events[4].screenshotRef') && error.includes('valid external artifact reference')
    ),
    `validator should reject screenshotRef with ${caseName}`
  );
}

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
