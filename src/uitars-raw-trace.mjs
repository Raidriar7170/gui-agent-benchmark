import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';

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

const externalReferenceRequiredEventTypes = new Set([
  'action',
  'tool_result',
  'capture'
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function nonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmptyString);
}

function isValidExternalArtifactReference(value) {
  if (!nonEmptyString(value)) return false;
  if (value !== value.trim()) return false;
  if (/[\x00-\x1f\x7f]/.test(value)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  if (value.startsWith('/') || value.startsWith('\\') || value.startsWith('~')) return false;
  if (value.includes('\\')) return false;
  if (value.length > 512) return false;

  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return false;
  return segments.every((segment) => /^[A-Za-z0-9._-]+$/.test(segment) && segment.length <= 128);
}

function validExternalArtifactReferenceArray(value) {
  return nonEmptyStringArray(value) && value.every(isValidExternalArtifactReference);
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
        pushIf(errors, !nonEmptyStringArray(event.artifactRefs), `${path}.artifactRefs must be a non-empty string array when present`);
        pushIf(
          errors,
          nonEmptyStringArray(event.artifactRefs) && !validExternalArtifactReferenceArray(event.artifactRefs),
          `${path}.artifactRefs must contain valid external artifact references`
        );
      }
      if (event.screenshotRef !== undefined) {
        pushIf(errors, !nonEmptyString(event.screenshotRef), `${path}.screenshotRef must be a non-empty string when present`);
        pushIf(
          errors,
          nonEmptyString(event.screenshotRef) && !isValidExternalArtifactReference(event.screenshotRef),
          `${path}.screenshotRef must be a valid external artifact reference`
        );
      }
      if (externalReferenceRequiredEventTypes.has(event.type)) {
        pushIf(
          errors,
          !validExternalArtifactReferenceArray(event.artifactRefs) && !isValidExternalArtifactReference(event.screenshotRef),
          `${path} must include artifactRefs or screenshotRef for ${event.type} events`
        );
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

function eventExternalReferences(event) {
  const refs = [];
  if (Array.isArray(event.artifactRefs)) refs.push(...event.artifactRefs.filter(nonEmptyString));
  if (nonEmptyString(event.screenshotRef)) refs.push(event.screenshotRef);
  return refs;
}

function isInsideDirectory(root, path) {
  const rootPath = resolve(root);
  const childPath = resolve(path);
  return childPath === rootPath || childPath.startsWith(`${rootPath}/`);
}

function isScreenshotReference(value) {
  return /\.(png|jpg|jpeg|webp)$/i.test(value);
}

const textArtifactExtensions = new Set([
  '.json',
  '.jsonl',
  '.md',
  '.txt',
  '.log',
  '.html',
  '.htm'
]);

const sensitiveTextPatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
  /["']?(?:api_?key|token|password|authorization|cookie)["']?\s*[:=]\s*["']?[^"',}\s]+/i,
  /\bwebSocketDebuggerUrl\b/i,
  /\bws:\/\/[^\s"'<>]+\/devtools\//i,
  /\/Users\/[^/\s]+\/\.ssh\b/i,
  /(^|[\s"'`])~\/\.ssh\b/i,
  /(^|[\s"'`])\/root(?:\/|[\s"'`]|$)/i,
  /\bssh\s+-L\b/i,
  /\bssh\s+[^\s]+@[^\s]+/i
];

function containsSensitiveText(text) {
  if (sensitiveTextPatterns.some((pattern) => pattern.test(text))) return true;
  for (const match of text.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
    const ip = match[0];
    const octets = ip.split('.').map((part) => Number(part));
    if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) continue;
    if (ip === '127.0.0.1' || ip.startsWith('127.')) continue;
    return true;
  }
  return false;
}

async function validateTextArtifactContent({ resolvedPath, ref, path, errors }) {
  if (!textArtifactExtensions.has(extname(ref).toLowerCase())) return;
  let text;
  try {
    text = await readFile(resolvedPath, 'utf8');
  } catch (error) {
    errors.push(`${path} referenced text artifact cannot be read: ${ref}: ${error.message}`);
    return;
  }
  if (containsSensitiveText(text)) {
    errors.push(`${path} referenced text artifact contains sensitive-looking content: ${ref}`);
  }
}

async function validateExistingBundleReference({ bundleRoot, realBundleRoot, ref, path, errors }) {
  if (!isValidExternalArtifactReference(ref)) return;
  const resolvedPath = resolve(bundleRoot, ref);
  if (!isInsideDirectory(bundleRoot, resolvedPath)) {
    errors.push(`${path} resolves outside bundle root: ${ref}`);
    return;
  }

  let stats;
  try {
    stats = await lstat(resolvedPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      errors.push(`${path} referenced file does not exist: ${ref}`);
      return;
    }
    errors.push(`${path} referenced file cannot be read: ${ref}: ${error.message}`);
    return;
  }

  let realResolvedPath;
  try {
    realResolvedPath = await realpath(resolvedPath);
  } catch (error) {
    errors.push(`${path} referenced file cannot be resolved: ${ref}: ${error.message}`);
    return;
  }
  if (!isInsideDirectory(realBundleRoot, realResolvedPath)) {
    errors.push(`${path} referenced file resolves outside bundle root: ${ref}`);
    return;
  }

  if (stats.isSymbolicLink()) {
    errors.push(`${path} referenced path must not be a symlink: ${ref}`);
    return;
  }

  if (!stats.isFile()) {
    errors.push(`${path} referenced path must be a file: ${ref}`);
    return;
  }

  await validateTextArtifactContent({ resolvedPath: realResolvedPath, ref, path, errors });
}

export async function validateRawUitarsTraceBundle(rawTrace, options = {}) {
  const errors = validateRawUitarsTrace(rawTrace);
  const bundleRoot = options.bundleRoot || rawTrace?.artifactBase;
  if (!nonEmptyString(bundleRoot)) {
    errors.push('bundleRoot or rawTrace.artifactBase must be a non-empty string');
    return errors;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(bundleRoot)) {
    errors.push('bundle root must be a local directory path, not a URL');
    return errors;
  }
  let realBundleRoot;
  try {
    realBundleRoot = await realpath(bundleRoot);
  } catch (error) {
    errors.push(`bundle root cannot be resolved: ${error.message}`);
    return errors;
  }

  const events = Array.isArray(rawTrace?.events) ? rawTrace.events : [];
  const seenRefs = new Set();
  for (const [index, event] of events.entries()) {
    if (!isPlainObject(event)) continue;
    for (const ref of eventExternalReferences(event)) {
      const path = `events[${index}]`;
      if (seenRefs.has(ref)) errors.push(`${path} duplicate external artifact reference: ${ref}`);
      seenRefs.add(ref);
      if (event.screenshotRef === ref && !isScreenshotReference(ref)) {
        errors.push(`${path}.screenshotRef must point to a .png, .jpg, .jpeg, or .webp file`);
      }
      if (extname(ref).toLowerCase() === '.json') {
        // JSON artifacts are allowed as opaque raw evidence; readability is covered by stat.
      }
      await validateExistingBundleReference({ bundleRoot, realBundleRoot, ref, path, errors });
    }
  }

  return errors;
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
