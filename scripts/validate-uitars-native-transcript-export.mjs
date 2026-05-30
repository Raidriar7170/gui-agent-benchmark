#!/usr/bin/env node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  exportUitarsNativeTranscriptFromState,
  convertUitarsStateToRawTrace
} from '../src/uitars-native-transcript-export.mjs';
import {
  RAW_UITARS_TRACE_SCHEMA_VERSION,
  validateRawUitarsTraceBundle
} from '../src/uitars-raw-trace.mjs';

const errors = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function stateFixture() {
  return {
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'Complete settings-toggle.',
        createdAt: '2026-05-29T00:00:01.000Z'
      },
      {
        id: 'm2',
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will click the digest checkbox.' },
          {
            type: 'tool_call',
            name: 'click',
            arguments: {
              start_box: '[0.1,0.2,0.1,0.2]',
              screenshot: 'data:image/png;base64,' + 'a'.repeat(620)
            }
          }
        ],
        createdAt: '2026-05-29T00:00:02.000Z'
      },
      {
        id: 'm-real-uitars',
        from: 'gpt',
        value: 'Thought: I should type into the focused input.\nAction: type',
        timing: {
          start: 1780000002000,
          end: 1780000002500,
          cost: 500
        },
        predictionParsed: [
          {
            action_type: 'type',
            action_inputs: {
              content: 'abc',
              screenshot: 'data:image/png;base64,' + 'c'.repeat(620)
            },
            thought: 'I should type into the focused input.',
            reflection: ''
          }
        ]
      },
      {
        id: 'm-real-uitars-object',
        from: 'gpt',
        value: 'Thought: I should click the Evaluate button.\nAction: click',
        timing: {
          start: 1780000003000,
          end: 1780000003500,
          cost: 500
        },
        predictionParsed: {
          action_type: 'click',
          action_inputs: {
            target: 'Evaluate'
          },
          thought: 'I should click the Evaluate button.',
          reflection: ''
        }
      },
      {
        id: 'm3',
        role: 'tool',
        content: {
          ok: true,
          screenshot: 'data:image/png;base64,' + 'b'.repeat(620)
        },
        createdAt: '2026-05-29T00:00:03.000Z'
      }
    ]
  };
}

const finalCapture = {
  evaluation: {
    success: false,
    score: 0.75,
    details: [
      { criterion: 'weekly email digest is enabled', pass: true },
      { criterion: 'timezone is America/New_York', pass: false }
    ],
    primaryFailureCode: 'ACT-DROPDOWN-VALUE-MISS'
  }
};

const tempDir = await mkdtemp(join(tmpdir(), 'uitars-native-transcript-export-'));
try {
  const experimentDir = join(tempDir, 'experiment');
  const rawTrace = convertUitarsStateToRawTrace({
    state: stateFixture(),
    taskId: 'settings-toggle',
    taskTitle: 'Update workspace settings',
    experimentDir,
    prompt: 'Complete settings-toggle.',
    finalCapture,
    createdAt: '2026-05-29T00:00:00.000Z'
  });

  assert(rawTrace.schemaVersion === RAW_UITARS_TRACE_SCHEMA_VERSION, 'raw trace should use the shared raw UI-TARS schema version');
  assert(rawTrace.source === 'ui-tars-raw-transcript', 'raw trace source should be ui-tars-raw-transcript');
  assert(rawTrace.events.some((event) => event.type === 'action' && event.action?.name === 'click'), 'conversion should preserve native action calls');
  assert(
    rawTrace.events.some((event) => (
      event.type === 'action' &&
      event.action?.name === 'type' &&
      event.action?.args?.content === 'abc' &&
      event.role === 'assistant' &&
      event.text.includes('Thought:')
    )),
    'conversion should preserve real UI-TARS array predictionParsed action_type/action_inputs entries'
  );
  assert(
    rawTrace.events.some((event) => (
      event.type === 'action' &&
      event.action?.name === 'click' &&
      event.action?.args?.target === 'Evaluate' &&
      event.role === 'assistant' &&
      event.text.includes('Evaluate')
    )),
    'conversion should preserve real UI-TARS object predictionParsed action_type/action_inputs entries'
  );
  assert(JSON.stringify(rawTrace).includes('data:image') === false, 'conversion should omit inline screenshot data');
  assert(JSON.stringify(rawTrace).includes('webSocketDebuggerUrl') === false, 'conversion should omit debugger websocket fields');
  assert(rawTrace.final.primaryFailureCode === 'ACT-DROPDOWN-VALUE-MISS', 'conversion should read final evaluation from capture data');

  const written = await exportUitarsNativeTranscriptFromState({
    state: stateFixture(),
    taskId: 'settings-toggle',
    taskTitle: 'Update workspace settings',
    experimentDir,
    prompt: 'Complete settings-toggle.',
    finalCapture,
    createdAt: '2026-05-29T00:00:00.000Z'
  });

  const persistedTrace = JSON.parse(await readFile(written.rawTracePath, 'utf8'));
  const bundleErrors = await validateRawUitarsTraceBundle(persistedTrace, { bundleRoot: experimentDir });
  assert(bundleErrors.length === 0, `exported raw bundle should validate: ${bundleErrors.join('; ')}`);
  assert(
    persistedTrace.events.some((event) => event.artifactRefs?.some((ref) => ref.startsWith('tasks/settings-toggle/raw/'))),
    'export should write raw message/action artifacts with relative refs'
  );
  const predictionEvent = persistedTrace.events.find((event) => event.action?.name === 'type');
  const predictionArtifact = JSON.parse(await readFile(join(experimentDir, predictionEvent.artifactRefs[0]), 'utf8'));
  assert(
    predictionArtifact.message.predictionParsed?.[0]?.action_type === 'type',
    'export should preserve sanitized predictionParsed metadata in raw artifacts'
  );
  assert(
    JSON.stringify(predictionArtifact).includes('data:image') === false,
    'exported raw artifacts should omit inline screenshot data from predictionParsed metadata'
  );

  const unsafeExperimentDir = join(tempDir, 'unsafe-experiment');
  let threw = false;
  try {
    await exportUitarsNativeTranscriptFromState({
      state: {
        messages: [
          {
            id: 'unsafe',
            from: 'gpt',
            value: 'authorization: Bearer secret-value',
            timing: {
              start: 1780000004000
            },
            predictionParsed: {
              action_type: 'type',
              action_inputs: {
                content: 'abc'
              }
            }
          }
        ]
      },
      taskId: 'settings-toggle',
      taskTitle: 'Update workspace settings',
      experimentDir: unsafeExperimentDir,
      prompt: 'Complete settings-toggle.',
      finalCapture,
      createdAt: '2026-05-29T00:00:00.000Z'
    });
  } catch (error) {
    threw = /sensitive-looking content/i.test(error.message);
  }
  assert(threw, 'export should reject sensitive content before writing raw artifacts');
  await readFile(join(unsafeExperimentDir, 'tasks/settings-toggle/raw-trace.json'), 'utf8')
    .then(
      () => assert(false, 'failed export must not leave raw-trace.json on disk'),
      () => assert(true, 'failed export should not create raw-trace.json')
    );

  const unsafeAuthExperimentDir = join(tempDir, 'unsafe-auth-experiment');
  let authThrew = false;
  try {
    await exportUitarsNativeTranscriptFromState({
      state: {
        messages: [
          {
            id: 'unsafe-auth',
            from: 'gpt',
            value: 'Thought: I should type with auth.',
            timing: {
              start: 1780000005000
            },
            predictionParsed: {
              action_type: 'type',
              action_inputs: {
                content: 'abc',
                auth: 'secret'
              }
            }
          }
        ]
      },
      taskId: 'settings-toggle',
      taskTitle: 'Update workspace settings',
      experimentDir: unsafeAuthExperimentDir,
      prompt: 'Complete settings-toggle.',
      finalCapture,
      createdAt: '2026-05-29T00:00:00.000Z'
    });
  } catch (error) {
    authThrew = /sensitive-looking content/i.test(error.message);
  }
  assert(authThrew, 'export should reject auth fields before writing raw artifacts');
  await readFile(join(unsafeAuthExperimentDir, 'tasks/settings-toggle/raw-trace.json'), 'utf8')
    .then(
      () => assert(false, 'failed auth export must not leave raw-trace.json on disk'),
      () => assert(true, 'failed auth export should not create raw-trace.json')
    );
  await readFile(join(unsafeAuthExperimentDir, 'tasks/settings-toggle/raw/message-001-action-01.json'), 'utf8')
    .then(
      () => assert(false, 'failed auth export must not leave raw action artifacts on disk'),
      () => assert(true, 'failed auth export should not create raw action artifacts')
    );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

if (errors.length > 0) {
  console.error('UI-TARS native transcript export validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('UI-TARS native transcript export validation passed.');
