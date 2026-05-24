import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { STEP_TRACE_SCHEMA_VERSION, validateStepTrace } from './step-trace.mjs';

export const RAW_UITARS_TRACE_SCHEMA_VERSION = 1;

const allowedEventTypes = new Set([
  'prompt',
  'observation',
  'thought',
  'action',
  'tool_result',
  'call_user',
  'preflight',
  'capture',
  'judge_result'
]);

const allowedRoles = new Set([
  'operator',
  'assistant',
  'tool',
  'system',
  'benchmark',
  'preflight',
  'capture'
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

function hasInlineBase64(value, key = '') {
  if (typeof value === 'string') {
    const compact = value.replace(/\s/g, '');
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(compact)) return true;
    if (/(base64|screenshot|image|frame)/i.test(key) && compact.length > 512 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return true;
    return false;
  }
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => hasInlineBase64(item, key));
  return Object.entries(value).some(([childKey, child]) => hasInlineBase64(child, childKey));
}

function isoOrEmpty(value) {
  if (value === undefined || value === null || value === '') return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function validateFinal(final, errors) {
  pushIf(errors, !isPlainObject(final), 'final must be an object');
  if (!isPlainObject(final)) return;
  pushIf(errors, typeof final.success !== 'boolean', 'final.success must be boolean');
  pushIf(errors, typeof final.score !== 'number' || !Number.isFinite(final.score), 'final.score must be a finite number');
  pushIf(errors, !nonEmptyString(final.primaryFailureCode), 'final.primaryFailureCode must be a non-empty string');
  pushIf(errors, !Array.isArray(final.failedCriteria), 'final.failedCriteria must be an array');
}

export function validateRawUitarsTrace(trace) {
  const errors = [];
  pushIf(errors, !isPlainObject(trace), 'raw trace must be an object');
  if (!isPlainObject(trace)) return errors;

  pushIf(errors, trace.schemaVersion !== RAW_UITARS_TRACE_SCHEMA_VERSION, `schemaVersion must be ${RAW_UITARS_TRACE_SCHEMA_VERSION}`);
  pushIf(errors, trace.source !== 'ui-tars-raw-transcript', 'source must be ui-tars-raw-transcript');
  pushIf(errors, !nonEmptyString(trace.taskId), 'taskId must be a non-empty string');
  pushIf(errors, !nonEmptyString(trace.taskTitle), 'taskTitle must be a non-empty string');
  pushIf(errors, !nonEmptyString(trace.artifactBase), 'artifactBase must be a non-empty string');
  pushIf(errors, hasInlineBase64(trace), 'raw trace must not contain inline base64 screenshots or image payloads');
  pushIf(errors, !Array.isArray(trace.events) || trace.events.length === 0, 'events must be a non-empty array');

  const ids = new Set();
  if (Array.isArray(trace.events)) {
    trace.events.forEach((event, index) => {
      const path = `events[${index}]`;
      pushIf(errors, !isPlainObject(event), `${path} must be an object`);
      if (!isPlainObject(event)) return;
      pushIf(errors, !nonEmptyString(event.id), `${path}.id must be a non-empty string`);
      if (nonEmptyString(event.id)) {
        pushIf(errors, ids.has(event.id), `${path}.id duplicates ${event.id}`);
        ids.add(event.id);
      }
      pushIf(errors, !allowedEventTypes.has(event.type), `${path}.type must be one of ${[...allowedEventTypes].join(', ')}`);
      pushIf(errors, !allowedRoles.has(event.role), `${path}.role must be one of ${[...allowedRoles].join(', ')}`);
      if (event.type === 'action') {
        pushIf(errors, !isPlainObject(event.action), `${path}.action must be present for action events`);
        pushIf(errors, isPlainObject(event.action) && !nonEmptyString(event.action.name), `${path}.action.name must be a non-empty string`);
      }
      if (event.type === 'judge_result') {
        pushIf(errors, !isPlainObject(event.evaluation), `${path}.evaluation must be present for judge_result events`);
      }
      if (event.artifactRefs !== undefined) {
        pushIf(errors, !Array.isArray(event.artifactRefs), `${path}.artifactRefs must be an array when present`);
      }
    });
  }

  validateFinal(trace.final, errors);
  return errors;
}

function phaseForEvent(event) {
  if (event.type === 'prompt') return 'prompt';
  if (event.type === 'preflight') return 'preflight';
  if (event.type === 'action' || event.type === 'tool_result' || event.type === 'call_user') return 'action';
  if (event.type === 'capture') return 'capture';
  if (event.type === 'judge_result') return 'evaluation';
  return 'observation';
}

function actorForEvent(event) {
  if (event.role === 'assistant') return 'ui-tars';
  if (event.role === 'operator') return 'operator';
  if (event.role === 'benchmark') return 'benchmark';
  if (event.role === 'preflight') return 'preflight';
  if (event.role === 'capture') return 'capture';
  if (event.role === 'tool') return 'ui-tars';
  return 'environment';
}

function evidenceKindForEvent(event) {
  if (event.type === 'preflight') return 'preflight_report';
  if (event.type === 'capture' || event.type === 'judge_result') return 'capture_final_state';
  return 'transcript_observation';
}

function referencesForEvent(event) {
  const references = [];
  if (Array.isArray(event.artifactRefs)) references.push(...event.artifactRefs.filter(nonEmptyString));
  if (nonEmptyString(event.screenshotRef)) references.push(event.screenshotRef);
  references.push(event.id);
  return [...new Set(references)];
}

function actionSummary(event) {
  if (!isPlainObject(event.action)) return event.text || event.type;
  const args = isPlainObject(event.action.args) ? event.action.args : {};
  const target = args.target || args.selector || args.text || args.value || '';
  return [event.action.name, target ? `(${target})` : ''].join(' ').trim();
}

function summaryForEvent(event) {
  if (nonEmptyString(event.text)) return event.text.trim();
  if (event.type === 'action') return `Action: ${actionSummary(event)}`;
  if (event.type === 'judge_result') return `Judge result: score ${event.evaluation?.score ?? 'unknown'}`;
  return event.type.replaceAll('_', ' ');
}

function valueForEvent(event) {
  const value = {};
  if (event.type === 'action' && isPlainObject(event.action)) value.action = event.action;
  if (event.type === 'judge_result' && isPlainObject(event.evaluation)) value.evaluation = event.evaluation;
  if (nonEmptyString(event.observation)) value.observation = event.observation;
  if (nonEmptyString(event.text)) value.text = event.text;
  return Object.keys(value).length === 0 ? undefined : value;
}

export function convertRawUitarsTraceToStepTrace(rawTrace) {
  const errors = validateRawUitarsTrace(rawTrace);
  if (errors.length > 0) {
    throw new Error(`Invalid raw UI-TARS trace: ${errors.join('; ')}`);
  }

  const steps = rawTrace.events.map((event, index) => {
    const value = valueForEvent(event);
    return {
      id: `${rawTrace.taskId}-raw-${String(index + 1).padStart(2, '0')}`,
      rawEventId: event.id,
      index: index + 1,
      timestamp: isoOrEmpty(event.timestamp),
      phase: phaseForEvent(event),
      actor: actorForEvent(event),
      type: event.type,
      summary: summaryForEvent(event),
      evidence: {
        kind: evidenceKindForEvent(event),
        references: referencesForEvent(event)
      },
      ...(value ? { value } : {})
    };
  });

  const lastEvidenceStepIds = steps.slice(-3).map((step) => step.id);
  steps.push({
    id: `${rawTrace.taskId}-failure-attribution`,
    index: steps.length + 1,
    phase: 'failure',
    actor: 'analysis',
    type: 'failure_attribution',
    summary: `Primary failure attributed to ${rawTrace.final.primaryFailureCode}.`,
    failureCode: rawTrace.final.primaryFailureCode,
    evidence: {
      kind: 'derived',
      references: lastEvidenceStepIds
    },
    relatedStepIds: lastEvidenceStepIds
  });

  const stepTrace = {
    schemaVersion: STEP_TRACE_SCHEMA_VERSION,
    source: 'ui-tars-step-trace',
    taskId: rawTrace.taskId,
    taskTitle: rawTrace.taskTitle,
    artifactBase: rawTrace.artifactBase,
    evidenceLimitations: [
      'Converted from structured raw UI-TARS transcript input.',
      'Inline screenshots and base64 image payloads are rejected by the ingestion validator.'
    ],
    steps,
    final: {
      success: rawTrace.final.success,
      score: rawTrace.final.score,
      primaryFailureCode: rawTrace.final.primaryFailureCode,
      failedCriteria: rawTrace.final.failedCriteria
    }
  };

  const stepErrors = validateStepTrace(stepTrace);
  if (stepErrors.length > 0) {
    throw new Error(`Converted step trace is invalid: ${stepErrors.join('; ')}`);
  }
  return stepTrace;
}

export function summarizeRawUitarsTrace(rawTrace) {
  const events = Array.isArray(rawTrace?.events) ? rawTrace.events : [];
  const eventTypes = {};
  for (const event of events) {
    eventTypes[event.type] = (eventTypes[event.type] || 0) + 1;
  }
  return {
    taskId: rawTrace?.taskId || '',
    eventCount: events.length,
    eventTypes,
    hasJudgeResult: events.some((event) => event.type === 'judge_result'),
    hasCallUser: events.some((event) => event.type === 'call_user')
  };
}

export async function ingestRawUitarsTraceFile({ inputPath, outputPath }) {
  if (!inputPath) throw new Error('inputPath is required.');
  if (!outputPath) throw new Error('outputPath is required.');
  const rawTrace = JSON.parse(await readFile(inputPath, 'utf8'));
  const stepTrace = convertRawUitarsTraceToStepTrace(rawTrace);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(stepTrace, null, 2)}\n`, 'utf8');
  return {
    inputPath,
    outputPath,
    summary: summarizeRawUitarsTrace(rawTrace),
    stepCount: stepTrace.steps.length
  };
}
