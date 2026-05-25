#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  STEP_TRACE_SCHEMA_VERSION,
  validateReconstructedStepTraceEvidence,
  summarizeStepTrace,
  validateStepTrace,
  validateTimelineTaxonomyLinks
} from '../src/step-trace.mjs';

const errors = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

const validTrace = {
  schemaVersion: STEP_TRACE_SCHEMA_VERSION,
  source: 'ui-tars-step-trace',
  taskId: 'synthetic-task',
  taskTitle: 'Synthetic task',
  artifactBase: 'experiments/synthetic',
  evidenceLimitations: [
    'Synthetic fixture.'
  ],
  steps: [
    {
      id: 's1',
      index: 1,
      phase: 'prompt',
      actor: 'operator',
      type: 'instruction',
      summary: 'Sent task prompt.',
      evidence: {
        kind: 'operator_note',
        references: []
      }
    },
    {
      id: 's2',
      index: 2,
      phase: 'failure',
      actor: 'analysis',
      type: 'failure_attribution',
      summary: 'Primary failure identified.',
      failureCode: 'ACT-TEXT-ENTRY-STALL',
      evidence: {
        kind: 'derived',
        references: ['s1']
      }
    }
  ],
  final: {
    success: false,
    score: 0,
    primaryFailureCode: 'ACT-TEXT-ENTRY-STALL',
    failedCriteria: ['criterion']
  }
};

assert(validateStepTrace(validTrace).length === 0, 'valid synthetic trace should pass schema validation');
const invalidTrace = structuredClone(validTrace);
invalidTrace.steps[1].index = 9;
assert(
  validateStepTrace(invalidTrace).some((error) => error.includes('steps[1].index')),
  'validator should reject non-contiguous step indexes'
);

const validReconstructedTrace = structuredClone(validTrace);
validReconstructedTrace.evidenceLimitations = [
  'Raw UI-TARS action transcript was not captured; this trace is derived from final capture and preflight artifacts.'
];
assert(
  validateReconstructedStepTraceEvidence(validReconstructedTrace).length === 0,
  'reconstructed trace policy should accept explicit raw transcript limitations'
);

const invalidReconstructedTrace = structuredClone(validReconstructedTrace);
invalidReconstructedTrace.evidenceLimitations = ['Synthetic fixture.'];
invalidReconstructedTrace.steps[0].evidence.kind = 'transcript_observation';
const reconstructedErrors = validateReconstructedStepTraceEvidence(invalidReconstructedTrace);
assert(
  reconstructedErrors.some((error) => error.includes('raw UI-TARS action transcript')),
  'reconstructed trace policy should require raw transcript limitation text'
);
assert(
  reconstructedErrors.some((error) => error.includes('transcript_observation')),
  'reconstructed trace policy should reject transcript_observation evidence'
);

async function validateExperiment({
  experimentDir,
  expectedTaskIds,
  expectedTraceCount,
  enforceReconstructedEvidencePolicy = false
}) {
  const tracesDir = join(experimentDir, 'step-traces');
  const taxonomyPath = join(experimentDir, 'failure-taxonomy.json');

  let traceFiles = [];
  try {
    traceFiles = (await readdir(tracesDir)).filter((file) => file.endsWith('.json')).sort();
  } catch (error) {
    errors.push(`${tracesDir}: ${error.message}`);
    return 0;
  }
  assert(traceFiles.length === expectedTraceCount, `${experimentDir} should contain exactly ${expectedTraceCount} step trace files`);

  const traces = [];
  for (const file of traceFiles) {
    const path = join(tracesDir, file);
    const trace = await readJson(path);
    const traceErrors = validateStepTrace(trace);
    for (const error of traceErrors) errors.push(`${path}: ${error}`);
    if (enforceReconstructedEvidencePolicy) {
      for (const error of validateReconstructedStepTraceEvidence(trace)) {
        errors.push(`${path}: ${error}`);
      }
    }
    traces.push(trace);

    const summary = summarizeStepTrace(trace);
    assert(summary.stepCount >= 5, `${path} should have at least five timeline steps`);
    assert(summary.failureCodes.includes(trace.final.primaryFailureCode), `${path} summary should include the primary failure code`);
    assert(summary.evidenceKinds.length > 0, `${path} summary should expose evidence kinds`);
  }

  const taskIds = traces.map((trace) => trace.taskId).sort();
  assert(
    taskIds.join(',') === expectedTaskIds.sort().join(','),
    `${experimentDir} unexpected trace task ids: ${taskIds.join(',')}`
  );

  let taxonomy;
  try {
    taxonomy = await readJson(taxonomyPath);
  } catch (error) {
    errors.push(`${taxonomyPath}: ${error.message}`);
    return traces.length;
  }
  for (const error of validateTimelineTaxonomyLinks({ taxonomy, traces, experimentDir })) {
    errors.push(`${taxonomyPath}: ${error}`);
  }
  return traces.length;
}

const validatedTraceCount = await validateExperiment({
  experimentDir: 'experiments/2026-05-23-uitars-real-e2e',
  expectedTaskIds: ['catalog-filter', 'onboarding-form', 'settings-toggle', 'ticket-review'],
  expectedTraceCount: 4
});

const expandedTraceCount = await validateExperiment({
  experimentDir: 'experiments/2026-05-24-uitars-expanded-real-round',
  expectedTaskIds: [
    'onboarding-form',
    'catalog-filter',
    'settings-toggle',
    'ticket-review',
    'modal-confirmation',
    'pagination-review',
    'sortable-inventory',
    'multi-select-approvals',
    'validation-error-recovery',
    'file-upload-request'
  ],
  expectedTraceCount: 10,
  enforceReconstructedEvidencePolicy: true
});

if (errors.length > 0) {
  console.error('Step trace validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Step trace validation passed: ${validatedTraceCount + expandedTraceCount} traces linked to failure taxonomy.`);
