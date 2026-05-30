#!/usr/bin/env node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  DEFAULT_NATIVE_ACTION_EVIDENCE_EXPERIMENT_DIR,
  validateNativeActionEvidenceGate
} from '../src/native-action-evidence-gate.mjs';
import { RAW_UITARS_TRACE_SCHEMA_VERSION } from '../src/uitars-raw-trace.mjs';

const errors = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function parseTaskIds(value) {
  return value
    .split(',')
    .map((taskId) => taskId.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const options = {
    experimentDir: DEFAULT_NATIVE_ACTION_EVIDENCE_EXPERIMENT_DIR,
    minNativeTaskActions: 1,
    minNativeTaskActionsPerTask: 0,
    expectedTaskIds: [],
    allowMissing: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--allow-missing') {
      options.allowMissing = true;
    } else if (arg === '--require-sample') {
      options.allowMissing = false;
    } else if (arg === '--experiment-dir') {
      options.experimentDir = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--experiment-dir=')) {
      options.experimentDir = arg.slice('--experiment-dir='.length);
    } else if (arg === '--min-native-task-actions') {
      options.minNativeTaskActions = Number(readValue(argv, index, arg));
      index += 1;
    } else if (arg.startsWith('--min-native-task-actions=')) {
      options.minNativeTaskActions = Number(arg.slice('--min-native-task-actions='.length));
    } else if (arg === '--expected-task-ids') {
      options.expectedTaskIds.push(...parseTaskIds(readValue(argv, index, arg)));
      index += 1;
    } else if (arg.startsWith('--expected-task-ids=')) {
      options.expectedTaskIds.push(...parseTaskIds(arg.slice('--expected-task-ids='.length)));
    } else if (arg === '--min-native-task-actions-per-task') {
      options.minNativeTaskActionsPerTask = Number(readValue(argv, index, arg));
      index += 1;
    } else if (arg.startsWith('--min-native-task-actions-per-task=')) {
      options.minNativeTaskActionsPerTask = Number(arg.slice('--min-native-task-actions-per-task='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.minNativeTaskActions) || options.minNativeTaskActions < 1) {
    throw new Error('--min-native-task-actions must be a positive integer.');
  }
  if (!Number.isInteger(options.minNativeTaskActionsPerTask) || options.minNativeTaskActionsPerTask < 0) {
    throw new Error('--min-native-task-actions-per-task must be a non-negative integer.');
  }
  options.expectedTaskIds = [...new Set(options.expectedTaskIds)];

  return options;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function rawTraceFixture({ artifactBase }) {
  return {
    schemaVersion: RAW_UITARS_TRACE_SCHEMA_VERSION,
    source: 'ui-tars-raw-transcript',
    taskId: 'settings-toggle',
    taskTitle: 'Update workspace settings',
    artifactBase,
    createdAt: '2026-05-29T00:00:00.000Z',
    events: [
      {
        id: 'raw-1',
        type: 'prompt',
        role: 'operator',
        timestamp: '2026-05-29T00:00:01.000Z',
        text: 'Complete the settings task.'
      },
      {
        id: 'raw-2',
        type: 'action',
        role: 'assistant',
        timestamp: '2026-05-29T00:00:02.000Z',
        artifactRefs: ['tasks/settings-toggle/raw/action-raw-2.json'],
        screenshotRef: 'tasks/settings-toggle/screenshots/action-raw-2.png',
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

async function writeSyntheticExperiment({ experimentDir, includeReferencedFiles }) {
  return writeSyntheticExperimentWithPaths({
    experimentDir,
    rawTracePath: join(experimentDir, 'tasks/settings-toggle/raw-trace.json'),
    artifactBase: experimentDir,
    includeReferencedFiles
  });
}

async function writeSyntheticExperimentWithPaths({
  experimentDir,
  rawTracePath,
  artifactBase,
  includeReferencedFiles
}) {
  await writeJson(rawTracePath, rawTraceFixture({ artifactBase }));
  if (includeReferencedFiles) {
    await writeJson(join(artifactBase, 'tasks/settings-toggle/raw/action-raw-2.json'), {
      action: 'click',
      target: 'Weekly email digest'
    });
    await mkdir(join(artifactBase, 'tasks/settings-toggle/screenshots'), { recursive: true });
    await writeFile(join(artifactBase, 'tasks/settings-toggle/screenshots/action-raw-2.png'), 'png-bytes', 'utf8');
  }
  await writeJson(join(experimentDir, 'summary.json'), {
    schemaVersion: 1,
    source: 'ui-tars-native-task-action-transcript-smoke',
    createdAt: '2026-05-29T00:00:00.000Z',
    metrics: {
      native_task_actions_captured: 1,
      visible_transcript_only: 0,
      invalid_native_transcript: 0,
      missing_native_transcript: 0
    },
    tasks: [
      {
        taskId: 'settings-toggle',
        transcriptStatus: 'native_task_actions_captured',
        rawTracePath,
        taskActionCount: 1,
        taskActionNames: ['click']
      }
    ]
  });
}

const tempDir = await mkdtemp(join(tmpdir(), 'native-action-evidence-gate-'));
try {
  const validExperimentDir = join(tempDir, 'valid');
  await writeSyntheticExperiment({ experimentDir: validExperimentDir, includeReferencedFiles: true });
  const validGate = await validateNativeActionEvidenceGate({
    experimentDir: validExperimentDir,
    minNativeTaskActions: 1
  });
  assert(validGate.ok === true, `valid native action evidence gate should pass: ${validGate.errors.join('; ')}`);
  assert(validGate.capturedNativeTaskActions === 1, 'gate should count captured native task actions');

  const missingExpectedGate = await validateNativeActionEvidenceGate({
    experimentDir: validExperimentDir,
    expectedTaskIds: ['settings-toggle', 'onboarding-form'],
    minNativeTaskActions: 1,
    minNativeTaskActionsPerTask: 1
  });
  assert(missingExpectedGate.ok === false, 'strict gate should fail when an expected task is absent from summary.tasks');
  assert(
    missingExpectedGate.errors.some((error) => error === 'onboarding-form: missing expected task in P2 native action evidence summary'),
    'strict gate should report the missing expected task id'
  );

  const perTaskMinimumGate = await validateNativeActionEvidenceGate({
    experimentDir: validExperimentDir,
    expectedTaskIds: ['settings-toggle'],
    minNativeTaskActions: 1,
    minNativeTaskActionsPerTask: 2
  });
  assert(perTaskMinimumGate.ok === false, 'strict gate should fail when an expected task is below the per-task action minimum');
  assert(
    perTaskMinimumGate.errors.some((error) => error.includes('settings-toggle') && error.includes('below required per-task minimum 2')),
    'strict gate should report the expected task below the per-task minimum'
  );

  const invalidExperimentDir = join(tempDir, 'missing-ref');
  await writeSyntheticExperiment({ experimentDir: invalidExperimentDir, includeReferencedFiles: false });
  const invalidGate = await validateNativeActionEvidenceGate({
    experimentDir: invalidExperimentDir,
    minNativeTaskActions: 1
  });
  assert(invalidGate.ok === false, 'gate should fail when raw trace artifact references are missing');
  assert(
    invalidGate.errors.some((error) => error.includes('action-raw-2.json') && error.includes('does not exist')),
    'gate should report missing referenced raw artifact files'
  );

  const externalExperimentDir = join(tempDir, 'external-summary');
  const externalBundleDir = join(tempDir, 'external-bundle');
  await writeSyntheticExperimentWithPaths({
    experimentDir: externalExperimentDir,
    rawTracePath: join(externalBundleDir, 'tasks/settings-toggle/raw-trace.json'),
    artifactBase: externalBundleDir,
    includeReferencedFiles: true
  });
  const externalGate = await validateNativeActionEvidenceGate({
    experimentDir: externalExperimentDir,
    minNativeTaskActions: 1
  });
  assert(externalGate.ok === false, 'gate should reject raw traces outside the P2 experiment directory');
  assert(
    externalGate.errors.some((error) => error.includes('rawTracePath') && error.includes('inside experiment directory')),
    'gate should report rawTracePath outside the experiment directory'
  );

  const externalArtifactBaseExperimentDir = join(tempDir, 'external-artifact-base-summary');
  const externalArtifactBaseBundleDir = join(tempDir, 'external-artifact-base-bundle');
  await writeSyntheticExperimentWithPaths({
    experimentDir: externalArtifactBaseExperimentDir,
    rawTracePath: join(externalArtifactBaseExperimentDir, 'tasks/settings-toggle/raw-trace.json'),
    artifactBase: externalArtifactBaseBundleDir,
    includeReferencedFiles: true
  });
  const externalArtifactBaseGate = await validateNativeActionEvidenceGate({
    experimentDir: externalArtifactBaseExperimentDir,
    minNativeTaskActions: 1
  });
  assert(externalArtifactBaseGate.ok === false, 'gate should reject artifactBase outside the P2 experiment directory');
  assert(
    externalArtifactBaseGate.errors.some((error) => error.includes('artifactBase') && error.includes('inside experiment directory')),
    'gate should report artifactBase outside the experiment directory'
  );

  const badSummaryExperimentDir = join(tempDir, 'bad-summary');
  await writeSyntheticExperiment({ experimentDir: badSummaryExperimentDir, includeReferencedFiles: true });
  await writeJson(join(badSummaryExperimentDir, 'summary.json'), {
    schemaVersion: 2,
    source: 'wrong-source',
    metrics: {
      native_task_actions_captured: 0,
      visible_transcript_only: 0,
      invalid_native_transcript: 0,
      missing_native_transcript: 0
    },
    tasks: [
      {
        taskId: 'settings-toggle',
        transcriptStatus: 'native_task_actions_captured',
        rawTracePath: join(badSummaryExperimentDir, 'tasks/settings-toggle/raw-trace.json'),
        taskActionCount: 1,
        taskActionNames: ['click']
      }
    ]
  });
  const badSummaryGate = await validateNativeActionEvidenceGate({
    experimentDir: badSummaryExperimentDir,
    minNativeTaskActions: 1
  });
  assert(badSummaryGate.ok === false, 'gate should reject invalid summary metadata');
  assert(
    badSummaryGate.errors.some((error) => error.includes('summary.schemaVersion')),
    'gate should report invalid summary schemaVersion'
  );
  assert(
    badSummaryGate.errors.some((error) => error.includes('summary.source')),
    'gate should report invalid summary source'
  );
  assert(
    badSummaryGate.errors.some((error) => error.includes('metrics.native_task_actions_captured')),
    'gate should report summary metrics that do not match task statuses'
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

const options = parseArgs(process.argv.slice(2));
const result = await validateNativeActionEvidenceGate(options);
if (!result.ok && !(options.allowMissing && result.status === 'missing_experiment')) {
  errors.push(...result.errors);
}

if (errors.length > 0) {
  console.error('Native action evidence gate validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const outcome = result.status === 'missing_experiment' ? 'skipped' : 'passed';
console.log(`Native action evidence gate validation ${outcome}: ${result.status}.`);
