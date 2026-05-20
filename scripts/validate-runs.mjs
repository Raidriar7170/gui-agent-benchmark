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
import { importExternalRuns, traceToRun } from '../src/trace-importer.mjs';
import { createInitialState } from '../src/state.mjs';
import { loadTasks } from '../src/task-registry.mjs';

const errors = [];
const tasks = await loadTasks();

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

function makePassingState(taskId) {
  const state = createInitialState(taskId);

  if (taskId === 'onboarding-form') {
    state.form.fullName = 'Maya Ortiz';
    state.form.email = 'maya.ortiz@example.com';
    state.form.role = 'Designer';
    state.form.startDate = '2026-06-15';
    state.form.notes = 'Needs Figma access';
    state.form.submitted = true;
  } else if (taskId === 'catalog-filter') {
    state.catalog.search = 'laptop stand';
    state.catalog.category = 'office';
    state.catalog.minRating = 4.5;
    state.catalog.inStockOnly = true;
    state.catalog.selectedSku = 'ERGO-27';
  } else if (taskId === 'settings-toggle') {
    state.settings.weeklyDigest = true;
    state.settings.autosave = true;
    state.settings.dataSharing = false;
    state.settings.timezone = 'America/New_York';
  } else if (taskId === 'ticket-review') {
    state.table.query = 'Priya Shah';
    state.table.selectedTicketId = 'INC-2048';
    state.tickets.find((ticket) => ticket.id === 'INC-2048').reviewed = true;
  }

  return state;
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

const compatibilityStorage = createMemoryStorage();
const compatibilityImport = importExternalRuns(exported, compatibilityStorage);
assert(compatibilityImport.imported === 2, 'trace importer entrypoint should preserve existing run export imports');
assert(listRuns(compatibilityStorage).length === 2, 'trace importer entrypoint should restore existing run exports');

const traceStorage = createMemoryStorage();
const successTrace = {
  traceVersion: 1,
  source: 'external-agent',
  taskId: 'onboarding-form',
  taskTitle: 'Submit onboarding request',
  startedAt: '2026-05-20T00:10:00.000Z',
  endedAt: '2026-05-20T00:10:05.000Z',
  events: [
    {
      timestamp: '2026-05-20T00:10:01.000Z',
      type: 'input',
      label: 'Set full name',
      path: 'form.fullName',
      value: 'Maya Ortiz',
      metadata: { selector: '[data-state-path="form.fullName"]' },
      screenshot: `data:image/png;base64,${'A'.repeat(600)}`
    },
    {
      timestamp: '2026-05-20T00:10:04.000Z',
      type: 'submit',
      label: 'Submit onboarding request',
      target: '#onboarding-form',
      value: true
    }
  ],
  finalState: makePassingState('onboarding-form')
};
const successTraceImport = importExternalRuns({ traces: [successTrace] }, { storage: traceStorage, tasks });
const importedSuccessTrace = listRuns(traceStorage)[0];
assert(successTraceImport.imported === 1, 'trace importer should import one successful trace');
assert(importedSuccessTrace.success === true && importedSuccessTrace.score === 1, 'successful trace should be judged from finalState');
assert(importedSuccessTrace.inputs.length === 1, 'input-like trace events should be copied to inputs[]');
assert(importedSuccessTrace.actions[0].value.screenshot?.omitted === 'base64 image data', 'trace importer should summarize base64 screenshot data');

const rawImageTraceStorage = createMemoryStorage();
const rawImageBase64 = 'A'.repeat(600);
importExternalRuns({
  source: 'external-agent',
  taskId: 'catalog-filter',
  startedAt: '2026-05-20T00:15:00.000Z',
  events: [
    {
      timestamp: '2026-05-20T00:15:01.000Z',
      type: 'screenshot',
      label: 'Capture screen',
      value: rawImageBase64,
      text: rawImageBase64,
      inputValue: rawImageBase64
    }
  ]
}, { storage: rawImageTraceStorage, tasks });
const importedRawImageTrace = listRuns(rawImageTraceStorage)[0];
assert(importedRawImageTrace.actions[0].value.value?.omitted === 'base64 image data', 'screenshot event.value should summarize raw base64 image data');
assert(importedRawImageTrace.actions[0].value.text?.omitted === 'base64 image data', 'screenshot event.text should summarize raw base64 image data');
assert(importedRawImageTrace.actions[0].value.inputValue?.omitted === 'base64 image data', 'screenshot event.inputValue should summarize raw base64 image data');

const failingTraceState = createInitialState('settings-toggle');
failingTraceState.settings.weeklyDigest = true;
const failingTraceStorage = createMemoryStorage();
const failingTraceImport = importExternalRuns({
  source: 'external-agent',
  taskId: 'settings-toggle',
  startedAt: '2026-05-20T00:20:00.000Z',
  events: [
    {
      timestamp: '2026-05-20T00:20:02.000Z',
      type: 'input_changed',
      path: 'settings.weeklyDigest',
      value: true
    }
  ],
  finalState: failingTraceState
}, { storage: failingTraceStorage, tasks });
const importedFailingTrace = listRuns(failingTraceStorage)[0];
assert(failingTraceImport.imported === 1, 'trace importer should import one failing trace');
assert(importedFailingTrace.success === false, 'failing trace should be judged from finalState');
assert(importedFailingTrace.failureReason === 'product analytics sharing is disabled', 'failing trace should use deterministic failureReason');

const unjudgedTraceStorage = createMemoryStorage();
importExternalRuns({
  source: 'ui-tars',
  taskId: 'catalog-filter',
  startedAt: '2026-05-20T00:30:00.000Z',
  events: [
    {
      timestamp: '2026-05-20T00:30:02.000Z',
      type: 'click',
      label: 'Open category filter',
      target: 'catalog.category',
      countsAsStep: false,
      metadata: { sourceEventId: 'evt-1' }
    }
  ]
}, { storage: unjudgedTraceStorage, tasks });
const importedUnjudgedTrace = listRuns(unjudgedTraceStorage)[0];
assert(importedUnjudgedTrace.endedAt === null, 'trace without finalState/evaluation should remain active');
assert(importedUnjudgedTrace.evaluation === null, 'unjudged trace should not include evaluation');
assert(importedUnjudgedTrace.success === null, 'unjudged trace success should be null');
assert(importedUnjudgedTrace.score === null, 'unjudged trace score should be null');
assert(importedUnjudgedTrace.failureReason === null, 'unjudged trace failureReason should be null');

const jsonlTraceStorage = createMemoryStorage();
const jsonlTrace = {
  traceVersion: 1,
  source: 'external-agent',
  taskId: 'ticket-review',
  events: [
    {
      timestamp: '2026-05-20T00:40:01.000Z',
      type: 'input',
      path: 'table.query',
      value: 'Priya Shah'
    }
  ],
  finalState: makePassingState('ticket-review')
};
const jsonlTraceImport = importExternalRuns(`${JSON.stringify(jsonlTrace)}\n`, { storage: jsonlTraceStorage, tasks });
const importedJsonlTrace = listRuns(jsonlTraceStorage)[0];
assert(jsonlTraceImport.imported === 1, 'JSONL trace import should report one imported trace');
assert(importedJsonlTrace.success === true, 'JSONL trace should be normalized and judged');
assert(importedJsonlTrace.inputs[0]?.path === 'table.query', 'JSONL trace should preserve input path');

assertThrows(
  () => importExternalRuns({ source: 'external-agent', taskId: 'unknown-task', events: [] }, { storage: createMemoryStorage() }),
  'Trace import requires a non-empty task registry',
  'trace imports should reject when no task registry is provided'
);
assertThrows(
  () => traceToRun({ source: 'external-agent', taskId: 'unknown-task', events: [] }),
  'requires a non-empty task registry',
  'traceToRun should reject when no task registry is provided'
);
assertThrows(
  () => importExternalRuns({ source: 'external-agent', taskId: 'unknown-task', events: [] }, { storage: createMemoryStorage(), tasks }),
  'unknown task "unknown-task"',
  'trace importer should reject unknown task ids'
);
assertThrows(
  () => importExternalRuns([
    JSON.stringify({ taskId: 'onboarding-form', timestamp: '2026-05-20T00:45:00.000Z', type: 'click' }),
    JSON.stringify({ taskId: 'onboarding-form', timestamp: '2026-05-20T00:45:01.000Z', type: 'screenshot', value: rawImageBase64 })
  ].join('\n'), { storage: createMemoryStorage(), tasks }),
  'Event-stream JSONL is not supported yet',
  'trace importer should explicitly reject event-stream JSONL'
);
assertThrows(
  () => importExternalRuns({ source: 'external-agent', taskId: 'onboarding-form' }, { storage: createMemoryStorage(), tasks }),
  'events must be an array',
  'trace importer should reject missing events'
);
assertThrows(
  () => importExternalRuns({ source: 'external-agent', taskId: 'onboarding-form', events: [null] }, { storage: createMemoryStorage(), tasks }),
  'events[0] must be an object',
  'trace importer should reject malformed events'
);
assertThrows(
  () => importExternalRuns({
    source: 'external-agent',
    taskId: 'onboarding-form',
    events: [{ timestamp: 'not-a-date', type: 'click' }]
  }, { storage: createMemoryStorage(), tasks }),
  'events[0].timestamp must be an ISO-compatible timestamp',
  'trace importer should reject bad event timestamps'
);
assertThrows(
  () => importExternalRuns({
    source: 'external-agent',
    taskId: 'onboarding-form',
    events: [{ timestamp: '2026-05-20T00:50:00.000Z', type: 'click', metadata: { unsafe: () => true } }]
  }, { storage: createMemoryStorage(), tasks }),
  'metadata.unsafe must be JSON-safe',
  'trace importer should reject non JSON-safe metadata'
);

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
