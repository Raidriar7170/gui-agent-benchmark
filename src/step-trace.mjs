export const STEP_TRACE_SCHEMA_VERSION = 1;

const allowedPhases = new Set([
  'environment',
  'prompt',
  'preflight',
  'observation',
  'action',
  'capture',
  'evaluation',
  'failure'
]);

const allowedActors = new Set([
  'operator',
  'ui-tars',
  'benchmark',
  'preflight',
  'capture',
  'analysis',
  'environment'
]);

const allowedEvidenceKinds = new Set([
  'artifact',
  'capture_final_state',
  'operator_note',
  'transcript_observation',
  'preflight_report',
  'finish_gate',
  'derived'
]);

const reconstructedEvidenceKinds = new Set([
  'artifact',
  'capture_final_state',
  'operator_note',
  'preflight_report',
  'finish_gate',
  'derived'
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function pushIf(errors, condition, message) {
  if (condition) errors.push(message);
}

function validateEvidence(evidence, path, errors) {
  pushIf(errors, !isPlainObject(evidence), `${path} must be an object`);
  if (!isPlainObject(evidence)) return;

  pushIf(errors, !allowedEvidenceKinds.has(evidence.kind), `${path}.kind must be one of ${[...allowedEvidenceKinds].join(', ')}`);
  pushIf(errors, !Array.isArray(evidence.references), `${path}.references must be an array`);
  if (Array.isArray(evidence.references)) {
    evidence.references.forEach((reference, index) => {
      pushIf(errors, !nonEmptyString(reference), `${path}.references[${index}] must be a non-empty string`);
    });
  }
}

export function validateStepTrace(trace) {
  const errors = [];
  pushIf(errors, !isPlainObject(trace), 'trace must be an object');
  if (!isPlainObject(trace)) return errors;

  pushIf(errors, trace.schemaVersion !== STEP_TRACE_SCHEMA_VERSION, `schemaVersion must be ${STEP_TRACE_SCHEMA_VERSION}`);
  pushIf(errors, trace.source !== 'ui-tars-step-trace', 'source must be ui-tars-step-trace');
  pushIf(errors, !nonEmptyString(trace.taskId), 'taskId must be a non-empty string');
  pushIf(errors, !nonEmptyString(trace.taskTitle), 'taskTitle must be a non-empty string');
  pushIf(errors, !nonEmptyString(trace.artifactBase), 'artifactBase must be a non-empty string');
  pushIf(errors, !Array.isArray(trace.evidenceLimitations) || trace.evidenceLimitations.length === 0, 'evidenceLimitations must be a non-empty array');
  pushIf(errors, !Array.isArray(trace.steps) || trace.steps.length === 0, 'steps must be a non-empty array');

  const stepIds = new Set();
  let failureStepCount = 0;
  if (Array.isArray(trace.steps)) {
    trace.steps.forEach((step, index) => {
      const path = `steps[${index}]`;
      pushIf(errors, !isPlainObject(step), `${path} must be an object`);
      if (!isPlainObject(step)) return;

      pushIf(errors, !nonEmptyString(step.id), `${path}.id must be a non-empty string`);
      if (nonEmptyString(step.id)) {
        pushIf(errors, stepIds.has(step.id), `${path}.id duplicates ${step.id}`);
        stepIds.add(step.id);
      }
      pushIf(errors, step.index !== index + 1, `${path}.index must be ${index + 1}`);
      pushIf(errors, !allowedPhases.has(step.phase), `${path}.phase must be one of ${[...allowedPhases].join(', ')}`);
      pushIf(errors, !allowedActors.has(step.actor), `${path}.actor must be one of ${[...allowedActors].join(', ')}`);
      pushIf(errors, !nonEmptyString(step.type), `${path}.type must be a non-empty string`);
      pushIf(errors, !nonEmptyString(step.summary), `${path}.summary must be a non-empty string`);
      validateEvidence(step.evidence, `${path}.evidence`, errors);

      if (step.phase === 'failure' || step.type === 'failure_attribution') {
        failureStepCount += 1;
        pushIf(errors, !nonEmptyString(step.failureCode), `${path}.failureCode must be present for failure attribution`);
      }
      if (Array.isArray(step.relatedStepIds)) {
        step.relatedStepIds.forEach((relatedStepId, relatedIndex) => {
          pushIf(errors, !nonEmptyString(relatedStepId), `${path}.relatedStepIds[${relatedIndex}] must be a non-empty string`);
        });
      }
    });

    trace.steps.forEach((step, index) => {
      const path = `steps[${index}]`;
      if (!isPlainObject(step)) return;
      for (const relatedStepId of step.relatedStepIds || []) {
        pushIf(errors, !stepIds.has(relatedStepId), `${path}.relatedStepIds references missing step ${relatedStepId}`);
      }
    });
  }

  pushIf(errors, failureStepCount === 0, 'steps must include at least one failure attribution step');
  pushIf(errors, !isPlainObject(trace.final), 'final must be an object');
  if (isPlainObject(trace.final)) {
    pushIf(errors, typeof trace.final.success !== 'boolean', 'final.success must be boolean');
    pushIf(errors, typeof trace.final.score !== 'number', 'final.score must be number');
    pushIf(errors, !nonEmptyString(trace.final.primaryFailureCode), 'final.primaryFailureCode must be a non-empty string');
    pushIf(errors, !Array.isArray(trace.final.failedCriteria), 'final.failedCriteria must be an array');
  }

  return errors;
}

export function validateReconstructedStepTraceEvidence(trace) {
  const errors = [];
  pushIf(errors, !isPlainObject(trace), 'trace must be an object');
  if (!isPlainObject(trace)) return errors;

  const limitations = Array.isArray(trace.evidenceLimitations)
    ? trace.evidenceLimitations.join(' ')
    : '';
  pushIf(
    errors,
    !/raw UI-TARS action transcript/i.test(limitations),
    'evidenceLimitations must explicitly state that raw UI-TARS action transcript evidence is missing'
  );
  pushIf(
    errors,
    !/(not captured|were not captured|was not captured|not raw|derived|reconstructed)/i.test(limitations),
    'evidenceLimitations must identify reconstructed or non-raw evidence'
  );

  if (Array.isArray(trace.steps)) {
    trace.steps.forEach((step, index) => {
      const kind = step?.evidence?.kind;
      if (!reconstructedEvidenceKinds.has(kind)) {
        errors.push(`steps[${index}].evidence.kind cannot be ${kind} for reconstructed step traces`);
      }
    });
  }

  return errors;
}

export function summarizeStepTrace(trace) {
  const steps = Array.isArray(trace?.steps) ? trace.steps : [];
  const failureCodes = [...new Set(steps
    .map((step) => step?.failureCode)
    .filter(nonEmptyString))];
  const evidenceKinds = [...new Set(steps
    .map((step) => step?.evidence?.kind)
    .filter(nonEmptyString))];

  return {
    taskId: trace?.taskId || '',
    stepCount: steps.length,
    failureCodes,
    evidenceKinds,
    finalScore: typeof trace?.final?.score === 'number' ? trace.final.score : null,
    success: typeof trace?.final?.success === 'boolean' ? trace.final.success : null
  };
}

export function validateTimelineTaxonomyLinks({ taxonomy, traces, experimentDir = 'experiments/2026-05-23-uitars-real-e2e' }) {
  const errors = [];
  pushIf(errors, !isPlainObject(taxonomy), 'taxonomy must be an object');
  if (!isPlainObject(taxonomy)) return errors;
  pushIf(errors, !Array.isArray(taxonomy.tasks), 'taxonomy.tasks must be an array');
  if (!Array.isArray(taxonomy.tasks)) return errors;

  const tracesByTask = new Map((traces || []).map((trace) => [trace.taskId, trace]));
  for (const task of taxonomy.tasks) {
    const label = `tasks[${task?.id || '<missing>'}]`;
    const trace = tracesByTask.get(task?.id);
    pushIf(errors, !trace, `${label} has no matching step trace`);
    pushIf(errors, !isPlainObject(task.timelineAttribution), `${label}.timelineAttribution must be present`);
    if (!trace || !isPlainObject(task.timelineAttribution)) continue;

    const stepIds = new Set(trace.steps.map((step) => step.id));
    const primaryIds = task.timelineAttribution.primaryEvidenceStepIds;
    pushIf(errors, !Array.isArray(primaryIds) || primaryIds.length === 0, `${label}.timelineAttribution.primaryEvidenceStepIds must be a non-empty array`);
    if (Array.isArray(primaryIds)) {
      for (const stepId of primaryIds) {
        pushIf(errors, !stepIds.has(stepId), `${label}.timelineAttribution references missing step ${stepId}`);
      }
    }
    pushIf(errors, task.timelineAttribution.tracePath !== `${experimentDir}/step-traces/${task.id}.json`, `${label}.timelineAttribution.tracePath must point to the task step trace`);
    pushIf(errors, trace.final.primaryFailureCode !== task.primaryCode, `${label} primaryCode must match trace final.primaryFailureCode`);
    const failureStepCodes = new Set(trace.steps
      .filter((step) => step.phase === 'failure' || step.type === 'failure_attribution')
      .map((step) => step.failureCode));
    pushIf(errors, !failureStepCodes.has(task.primaryCode), `${label} primaryCode must appear in a failure attribution step`);
  }

  return errors;
}
