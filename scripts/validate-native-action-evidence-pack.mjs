#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  analyzeNativeActionEvidencePack,
  writeNativeActionEvidencePack
} from '../src/native-action-evidence-pack.mjs';
import { validateNativeActionEvidenceGate } from '../src/native-action-evidence-gate.mjs';
import { RAW_UITARS_TRACE_SCHEMA_VERSION } from '../src/uitars-raw-trace.mjs';

const errors = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function rawTraceFixture({ experimentDir }) {
  return {
    schemaVersion: RAW_UITARS_TRACE_SCHEMA_VERSION,
    source: 'ui-tars-raw-transcript',
    taskId: 'settings-toggle',
    taskTitle: 'Update workspace settings',
    artifactBase: experimentDir,
    createdAt: '2026-05-29T00:00:00.000Z',
    events: [
      {
        id: 'raw-1',
        type: 'prompt',
        role: 'operator',
        timestamp: '2026-05-29T00:00:01.000Z',
        text: 'Complete settings-toggle.'
      },
      {
        id: 'raw-2',
        type: 'action',
        role: 'assistant',
        timestamp: '2026-05-29T00:00:02.000Z',
        artifactRefs: ['tasks/settings-toggle/raw/raw-2.json'],
        action: {
          name: 'click',
          args: {
            target: 'Weekly email digest'
          }
        }
      }
    ],
    final: {
      success: false,
      score: 0.75,
      primaryFailureCode: 'ACT-DROPDOWN-VALUE-MISS',
      failedCriteria: ['timezone is America/New_York']
    }
  };
}

const tempDir = await mkdtemp(join(tmpdir(), 'native-action-evidence-pack-'));
try {
  const experimentDir = join(tempDir, 'experiment');
  await writeJson(join(experimentDir, 'tasks/settings-toggle/raw-trace.json'), rawTraceFixture({ experimentDir }));
  await writeJson(join(experimentDir, 'tasks/settings-toggle/raw/raw-2.json'), { action: 'click' });
  await writeJson(join(experimentDir, 'tasks/settings-toggle/capture/capture.json'), {
    evaluation: {
      success: false,
      score: 0.75,
      primaryFailureCode: 'ACT-DROPDOWN-VALUE-MISS',
      details: [
        { criterion: 'weekly email digest is enabled', pass: true },
        { criterion: 'timezone is America/New_York', pass: false }
      ]
    }
  });

  const summary = await analyzeNativeActionEvidencePack({
    experimentDir,
    expectedTaskIds: ['settings-toggle', 'onboarding-form', 'ticket-review'],
    createdAt: '2026-05-29T00:00:00.000Z'
  });

  assert(summary.metrics.native_task_actions_captured === 1, 'pack analyzer should count the captured task');
  assert(summary.metrics.missing_native_transcript === 2, 'pack analyzer should record missing expected tasks instead of fabricating traces');
  assert(summary.tasks.find((task) => task.taskId === 'settings-toggle')?.taskActionCount === 1, 'captured task should include action count');
  assert(
    summary.tasks.find((task) => task.taskId === 'onboarding-form')?.transcriptStatus === 'missing_native_transcript',
    'missing expected task should be represented as missing_native_transcript'
  );

  const written = await writeNativeActionEvidencePack({ summary, experimentDir });
  const persistedSummary = JSON.parse(await readFile(written.summaryPath, 'utf8'));
  assert(persistedSummary.tasks.length === 3, 'written summary should preserve all expected tasks');
  assert((await readFile(written.reportPath, 'utf8')).includes('P2 Native Action Evidence Pack'), 'report should be written');
  assert((await readFile(written.runLogPath, 'utf8')).includes('missing_native_transcript'), 'run log should document missing transcripts');

  const aggregateGate = await validateNativeActionEvidenceGate({
    experimentDir,
    minNativeTaskActions: 1
  });
  assert(aggregateGate.ok === true, `aggregate gate should allow captured plus missing tasks: ${aggregateGate.errors.join('; ')}`);

  const strictGate = await validateNativeActionEvidenceGate({
    experimentDir,
    expectedTaskIds: ['settings-toggle', 'onboarding-form', 'ticket-review'],
    minNativeTaskActions: 1,
    minNativeTaskActionsPerTask: 1
  });
  assert(strictGate.ok === false, 'strict P2 gate should fail while expected tasks are missing native transcripts');
  assert(
    strictGate.errors.some((error) => error.includes('onboarding-form') && error.includes('transcriptStatus must be native_task_actions_captured')),
    'strict P2 gate should report missing expected task status'
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

if (errors.length > 0) {
  console.error('Native action evidence pack validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Native action evidence pack validation passed.');
