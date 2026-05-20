#!/usr/bin/env node
import {
  clearRuns,
  createMemoryStorage,
  exportRuns,
  finalizeRun,
  importRuns,
  listRuns,
  recordRunInput,
  startRun,
  summarizeRuns,
  validateRun
} from '../src/runs.mjs';
import { createInitialState } from '../src/state.mjs';

const errors = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function assertThrows(fn, expectedErrorText, message) {
  try {
    fn();
    errors.push(message);
  } catch (error) {
    const actual = error instanceof Error ? error.message : String(error);
    if (!actual.includes(expectedErrorText)) {
      errors.push(`${message}: expected error to include "${expectedErrorText}", got "${actual}"`);
    }
  }
}

const storage = createMemoryStorage();

const passState = createInitialState('onboarding-form');
passState.form.fullName = 'Maya Ortiz';
passState.form.submitted = true;

let passRun = startRun({
  taskId: 'onboarding-form',
  taskTitle: 'Submit onboarding request',
  state: passState,
  timestamp: '2026-05-20T00:00:00.000Z'
}, storage);
passRun = recordRunInput(passRun, {
  path: 'form.fullName',
  value: 'Maya Ortiz'
}, passState, {
  storage,
  timestamp: '2026-05-20T00:00:01.000Z'
});
passRun = finalizeRun(passRun, {
  success: true,
  score: 1,
  details: [
    { criterion: 'form is submitted', pass: true, expected: true, actual: true }
  ],
  state: passState
}, passState, {
  storage,
  timestamp: '2026-05-20T00:00:02.000Z'
});

const failState = createInitialState('settings-toggle');
failState.settings.weeklyDigest = true;

let failRun = startRun({
  taskId: 'settings-toggle',
  taskTitle: 'Update workspace settings',
  state: failState,
  timestamp: '2026-05-20T00:01:00.000Z'
}, storage);
failRun = recordRunInput(failRun, {
  path: 'settings.weeklyDigest',
  value: true
}, failState, {
  storage,
  timestamp: '2026-05-20T00:01:01.000Z'
});
failRun = finalizeRun(failRun, {
  success: false,
  score: 0.5,
  details: [
    { criterion: 'weekly email digest is enabled', pass: true, expected: true, actual: true },
    { criterion: 'product analytics sharing is disabled', pass: false, expected: false, actual: true },
    { criterion: 'timezone is America/New_York', pass: false, expected: 'America/New_York', actual: 'UTC' }
  ],
  state: failState
}, failState, {
  storage,
  timestamp: '2026-05-20T00:01:04.000Z'
});

const runs = listRuns(storage);
assert(runs.length === 2, 'expected two synthetic runs');
assert(runs.every((run) => validateRun(run).length === 0), 'synthetic runs must satisfy the run schema');
assert(failRun.failureReason === 'product analytics sharing is disabled', 'failureReason must use the first failed criterion');

const summary = summarizeRuns(runs);
assert(summary.totalRuns === 2, 'summary totalRuns should include both runs');
assert(summary.finalizedRuns === 2, 'summary finalizedRuns should include both finalized runs');
assert(summary.successRate === 0.5, 'summary successRate should be 0.5');
assert(summary.avgSteps === 3, 'summary avgSteps should include start/input/finalize actions');
assert(summary.failureReasons.length === 1, 'summary should include one failure reason bucket');
assert(summary.failureReasons[0]?.reason === 'product analytics sharing is disabled', 'failure reason bucket should match deterministic reason');
assert(summary.perTask.length === 2, 'summary should include per-task stats');

const exported = exportRuns(storage);
clearRuns(storage);
assert(listRuns(storage).length === 0, 'clearRuns should remove persisted runs');
const imported = importRuns(exported, storage);
assert(imported.imported === 2, 'importRuns should report two imported runs');
assert(listRuns(storage).length === 2, 'importRuns should restore both runs');

const badStorage = createMemoryStorage();
const invalidExport = JSON.parse(exported);
invalidExport.runs.find((run) => run.success === false).failureReason = 'wrong reason';
assertThrows(
  () => importRuns(invalidExport, badStorage),
  'failureReason must match the first failed criterion',
  'importRuns should reject non-deterministic failureReason values'
);
assertThrows(
  () => importRuns({ runs: [{ id: 'missing-schema-fields' }] }, badStorage),
  'missing required field taskId',
  'importRuns should reject missing run schema fields'
);

const exportedObject = JSON.parse(exported);
const validStoredRun = exportedObject.runs[0];

const unsafeIdExport = JSON.parse(exported);
unsafeIdExport.runs[0].id = 'run"><img src=x onerror=alert(1)>';
assert(
  validateRun(unsafeIdExport.runs[0]).some((error) => error.includes('id must use only')),
  'validateRun should reject unsafe run ids'
);
assertThrows(
  () => importRuns(unsafeIdExport, badStorage),
  'id must use only letters, numbers, underscores, or hyphens',
  'importRuns should reject unsafe run ids'
);

const malformedActionsExport = JSON.parse(exported);
malformedActionsExport.runs[0].actions = [null];
assertThrows(
  () => importRuns(malformedActionsExport, badStorage),
  'actions[0] must be an object',
  'importRuns should reject malformed action entries'
);

const malformedInputsExport = JSON.parse(exported);
malformedInputsExport.runs[0].inputs = [{ timestamp: '2026-05-20T00:00:01.000Z', path: 'form.fullName' }];
assertThrows(
  () => importRuns(malformedInputsExport, badStorage),
  'inputs[0].value must be JSON-safe',
  'importRuns should reject malformed input entries'
);

const nullTimelineExport = JSON.parse(exported);
nullTimelineExport.runs[0].stateTimeline = [null];
assert(
  validateRun(nullTimelineExport.runs[0]).some((error) => error.includes('stateTimeline[0] must be an object')),
  'validateRun should reject null state timeline entries'
);
assertThrows(
  () => importRuns(nullTimelineExport, badStorage),
  'stateTimeline[0] must be an object',
  'importRuns should reject null state timeline entries'
);

const malformedTimelineExport = JSON.parse(exported);
malformedTimelineExport.runs[0].stateTimeline = [{ timestamp: 'not-a-date', label: 'bad snapshot', state: {} }];
assertThrows(
  () => importRuns(malformedTimelineExport, badStorage),
  'stateTimeline[0].timestamp must be an ISO-compatible timestamp',
  'importRuns should reject malformed state timeline entries'
);

const malformedEvaluationExport = JSON.parse(exported);
malformedEvaluationExport.runs[0].evaluation.details = [null];
assertThrows(
  () => importRuns(malformedEvaluationExport, badStorage),
  'evaluation.details[0] must be an object',
  'importRuns should reject malformed evaluation details'
);

const primitiveEvaluationExport = JSON.parse(exported);
primitiveEvaluationExport.runs[0].evaluation = 'not-an-object';
assert(
  validateRun(primitiveEvaluationExport.runs[0]).some((error) => error.includes('evaluation must be null or an object')),
  'validateRun should reject primitive evaluation values'
);
assertThrows(
  () => importRuns(primitiveEvaluationExport, badStorage),
  'evaluation must be null or an object',
  'importRuns should reject primitive evaluation values'
);

const corruptStorage = createMemoryStorage({
  runs: [
    validStoredRun,
    null,
    { ...validStoredRun, id: 'unsafe id', actions: [null] },
    { ...validStoredRun, id: 'primitive-evaluation', evaluation: 'not-an-object' }
  ]
});
const filteredStoredRuns = listRuns(corruptStorage);
assert(filteredStoredRuns.length === 1, 'listRuns should filter invalid localStorage runs');
assert(filteredStoredRuns[0]?.id === validStoredRun.id, 'listRuns should preserve valid runs from corrupted localStorage');
assert(summarizeRuns(filteredStoredRuns).totalRuns === 1, 'summarizeRuns should handle filtered localStorage runs');

if (errors.length > 0) {
  console.error('Run validation failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Run validation passed: ${runs.length} synthetic runs, ${summary.failureReasons.length} failure reason bucket.`);
