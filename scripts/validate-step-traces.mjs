#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  STEP_TRACE_SCHEMA_VERSION,
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

const experimentDir = 'experiments/2026-05-23-uitars-real-e2e';
const tracesDir = join(experimentDir, 'step-traces');
const taxonomyPath = join(experimentDir, 'failure-taxonomy.json');

const traceFiles = (await readdir(tracesDir)).filter((file) => file.endsWith('.json')).sort();
assert(traceFiles.length === 4, 'real round should contain exactly four step trace files');

const traces = [];
for (const file of traceFiles) {
  const path = join(tracesDir, file);
  const trace = await readJson(path);
  const traceErrors = validateStepTrace(trace);
  for (const error of traceErrors) errors.push(`${path}: ${error}`);
  traces.push(trace);

  const summary = summarizeStepTrace(trace);
  assert(summary.stepCount >= 5, `${path} should have at least five timeline steps`);
  assert(summary.failureCodes.includes(trace.final.primaryFailureCode), `${path} summary should include the primary failure code`);
  assert(summary.evidenceKinds.length > 0, `${path} summary should expose evidence kinds`);
}

const taskIds = traces.map((trace) => trace.taskId).sort();
assert(
  taskIds.join(',') === 'catalog-filter,onboarding-form,settings-toggle,ticket-review',
  `unexpected trace task ids: ${taskIds.join(',')}`
);

const taxonomy = await readJson(taxonomyPath);
for (const error of validateTimelineTaxonomyLinks({ taxonomy, traces })) {
  errors.push(`${taxonomyPath}: ${error}`);
}

if (errors.length > 0) {
  console.error('Step trace validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Step trace validation passed: ${traceFiles.length} traces linked to failure taxonomy.`);
