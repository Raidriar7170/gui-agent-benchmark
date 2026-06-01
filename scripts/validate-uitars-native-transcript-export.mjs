#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import {
  exportUitarsNativeTranscriptFromState,
  exportUitarsNativeTranscriptFromLiveCdp,
  convertUitarsStateToRawTrace,
  uitarsRendererStateExpression
} from '../src/uitars-native-transcript-export.mjs';
import {
  RAW_UITARS_TRACE_SCHEMA_VERSION,
  validateRawUitarsTraceBundle
} from '../src/uitars-raw-trace.mjs';

const errors = [];
const execFileAsync = promisify(execFile);

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function decodeClientFrame(buffer) {
  const opcode = buffer[0] & 0x0f;
  const lengthCode = buffer[1] & 0x7f;
  let length = lengthCode;
  let offset = 2;
  if (lengthCode === 126) {
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (lengthCode === 127) {
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  const mask = buffer.subarray(offset, offset + 4);
  const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length));
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] ^= mask[index % 4];
  }
  if (opcode !== 0x1 || payload.length === 0) return null;
  return JSON.parse(payload.toString('utf8'));
}

function encodeServerFrame(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  const headerLength = payload.length < 126 ? 2 : 4;
  const frame = Buffer.alloc(headerLength + payload.length);
  frame[0] = 0x81;
  if (payload.length < 126) {
    frame[1] = payload.length;
    payload.copy(frame, 2);
  } else {
    frame[1] = 126;
    frame.writeUInt16BE(payload.length, 2);
    payload.copy(frame, 4);
  }
  return frame;
}

async function startSyntheticUitarsCdpServer({ state, targets = null, version = null }) {
  const fixture = {
    expressionSeen: false,
    awaitPromiseSeen: false
  };
  const server = createServer((request, response) => {
    if (request.url === '/json/version') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(version || {
        Browser: 'SyntheticChrome/1.0',
        'Protocol-Version': '1.3'
      }));
      return;
    }
    if (request.url === '/json/list') {
      const port = server.address().port;
      const body = JSON.stringify(targets ? targets(port) : [
        {
          id: 'renderer-1',
          type: 'page',
          title: 'UI-TARS Local Browser Operator',
          url: 'http://127.0.0.1/synthetic-uitars-renderer',
          webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/renderer-1`
        }
      ]);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(body);
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });

  server.on('upgrade', (request, socket) => {
    const key = request.headers['sec-websocket-key'];
    const accept = createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '\r\n'
    ].join('\r\n'));
    socket.on('data', (chunk) => {
      if ((chunk[0] & 0x0f) === 0x8) {
        socket.end();
        return;
      }
      const message = decodeClientFrame(chunk);
      if (!message) return;
      if (message.method !== 'Runtime.evaluate') {
        socket.write(encodeServerFrame({
          id: message.id,
          error: { code: -32601, message: `Synthetic fixture rejects ${message.method}` }
        }));
        return;
      }
      if (!message.params?.expression?.includes('zustandBridge')) {
        socket.write(encodeServerFrame({
          id: message.id,
          error: { code: -32602, message: 'Synthetic fixture expected zustandBridge renderer-state expression' }
        }));
        return;
      }
      fixture.expressionSeen = true;
      fixture.awaitPromiseSeen = message.params?.awaitPromise === true;
      socket.write(encodeServerFrame({
        id: message.id,
        result: {
          result: {
            type: 'object',
            value: {
              source: 'zustandBridge.getState',
              messages: state.messages
            }
          }
        }
      }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    cdpUrl: `http://127.0.0.1:${server.address().port}`,
    fixture,
    close: () => new Promise((resolve) => server.close(resolve))
  };
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
  const rendererExpression = uitarsRendererStateExpression();
  assert(/^\(async \(\) =>/.test(rendererExpression), 'renderer state expression should use an async IIFE');
  assert(rendererExpression.includes('await getter()'), 'renderer state expression should await async store getters');

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

  const scopedRawTrace = convertUitarsStateToRawTrace({
    state: {
      messages: [
        {
          id: 'old-user',
          role: 'user',
          content: 'Old task.',
          createdAt: '2026-05-29T00:00:01.000Z'
        },
        {
          id: 'old-action',
          from: 'gpt',
          value: 'Thought: stale action.\nAction: click',
          timing: {
            start: 1780000002000
          },
          predictionParsed: {
            action_type: 'click',
            action_inputs: {
              target: 'stale'
            }
          }
        },
        {
          id: 'current-user',
          role: 'user',
          content: 'Current task.',
          createdAt: '2026-05-29T00:00:03.000Z'
        },
        {
          id: 'current-action',
          from: 'gpt',
          value: 'Thought: current action.\nAction: click',
          timing: {
            start: 1780000004000
          },
          predictionParsed: {
            action_type: 'click',
            action_inputs: {
              target: 'current'
            }
          }
        }
      ]
    },
    taskId: 'settings-toggle',
    taskTitle: 'Update workspace settings',
    experimentDir,
    prompt: 'Current task.',
    finalCapture,
    requirePromptBoundary: true,
    createdAt: '2026-05-29T00:00:05.000Z'
  });
  assert(
    scopedRawTrace.events.some((event) => event.text?.includes('current action')),
    'run-scoped conversion should preserve actions after the matching prompt'
  );
  assert(
    scopedRawTrace.events.every((event) => !event.text?.includes('stale action')),
    'run-scoped conversion should drop stale actions before the matching prompt'
  );
  assert(
    scopedRawTrace.events[0]?.type === 'prompt' && scopedRawTrace.events[0]?.timestamp === '2026-05-29T00:00:03.000Z',
    'run-scoped conversion should use the matching renderer prompt as the run boundary'
  );

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

  const liveServer = await startSyntheticUitarsCdpServer({ state: stateFixture() });
  try {
    const liveExperimentDir = join(tempDir, 'live-experiment');
    const liveWritten = await exportUitarsNativeTranscriptFromLiveCdp({
      cdpUrl: liveServer.cdpUrl,
      taskId: 'settings-toggle',
      taskTitle: 'Update workspace settings',
      experimentDir: liveExperimentDir,
      prompt: 'Complete settings-toggle.',
      finalCapture,
      createdAt: '2026-05-29T00:00:00.000Z'
    });
    const liveTrace = JSON.parse(await readFile(liveWritten.rawTracePath, 'utf8'));
    assert(
      liveTrace.events.some((event) => event.type === 'action' && event.action?.name === 'click'),
      'live CDP export should preserve native action calls from the renderer state'
    );
    assert(
      JSON.stringify(liveTrace).includes('webSocketDebuggerUrl') === false,
      'live CDP export must not persist debugger websocket fields'
    );
    const liveBundleErrors = await validateRawUitarsTraceBundle(liveTrace, { bundleRoot: liveExperimentDir });
    assert(liveBundleErrors.length === 0, `live exported raw bundle should validate: ${liveBundleErrors.join('; ')}`);
    assert(liveServer.fixture.expressionSeen, 'live CDP export should evaluate the zustandBridge renderer-state expression');
    assert(liveServer.fixture.awaitPromiseSeen, 'live CDP export should request Runtime.evaluate awaitPromise=true for async renderer stores');
  } finally {
    await liveServer.close();
  }

  const splitGuardServer = await startSyntheticUitarsCdpServer({
    state: stateFixture(),
    targets: (port) => [
      {
        id: 'benchmark-task',
        type: 'page',
        title: 'GUI Agent Benchmark',
        url: 'http://127.0.0.1:4173/?task=settings-toggle',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/benchmark-task`
      }
    ]
  });
  const splitRendererServer = await startSyntheticUitarsCdpServer({ state: stateFixture() });
  try {
    const splitExperimentDir = join(tempDir, 'split-cdp-live-experiment');
    const splitWritten = await exportUitarsNativeTranscriptFromLiveCdp({
      guardCdpUrl: splitGuardServer.cdpUrl,
      rendererCdpUrl: splitRendererServer.cdpUrl,
      taskId: 'settings-toggle',
      taskTitle: 'Update workspace settings',
      experimentDir: splitExperimentDir,
      prompt: 'Complete settings-toggle.',
      benchmarkUrl: 'http://127.0.0.1:4173/?task=settings-toggle',
      finalCapture,
      requireLiveGuard: true,
      createdAt: '2026-05-29T00:00:00.000Z'
    });
    const splitTrace = JSON.parse(await readFile(splitWritten.rawTracePath, 'utf8'));
    assert(
      splitTrace.events.some((event) => event.type === 'action' && event.action?.name === 'click'),
      'split-CDP live export should preserve native action calls from the renderer endpoint'
    );
    assert(splitRendererServer.fixture.expressionSeen, 'split-CDP live export should evaluate renderer state on the renderer endpoint');
    assert(!splitGuardServer.fixture.expressionSeen, 'split-CDP live export should not evaluate renderer state on the guard endpoint');
  } finally {
    await splitGuardServer.close();
    await splitRendererServer.close();
  }

  const blockedSplitGuardServer = await startSyntheticUitarsCdpServer({
    state: stateFixture(),
    targets: (port) => [
      {
        id: 'benchmark-task',
        type: 'page',
        title: 'GUI Agent Benchmark',
        url: 'http://127.0.0.1:4173/?task=settings-toggle',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/benchmark-task`
      },
      {
        id: 'signin-target',
        type: 'page',
        title: 'Sign in',
        url: 'https://signin.volcengine.com/auth/login',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/signin-target`
      }
    ]
  });
  const blockedSplitRendererServer = await startSyntheticUitarsCdpServer({ state: stateFixture() });
  try {
    const blockedSplitExperimentDir = join(tempDir, 'blocked-split-cdp-live-experiment');
    let blockedSplit = false;
    try {
      await exportUitarsNativeTranscriptFromLiveCdp({
        guardCdpUrl: blockedSplitGuardServer.cdpUrl,
        rendererCdpUrl: blockedSplitRendererServer.cdpUrl,
        taskId: 'settings-toggle',
        taskTitle: 'Update workspace settings',
        experimentDir: blockedSplitExperimentDir,
        prompt: 'Complete settings-toggle.',
        benchmarkUrl: 'http://127.0.0.1:4173/?task=settings-toggle',
        finalCapture,
        requireLiveGuard: true,
        createdAt: '2026-05-29T00:00:00.000Z'
      });
    } catch (error) {
      blockedSplit = /blocked by live target guard/i.test(error.message);
    }
    assert(blockedSplit, 'split-CDP live export should block when the guard endpoint is unsafe');
    assert(!blockedSplitRendererServer.fixture.expressionSeen, 'blocked split-CDP export must not evaluate the renderer endpoint');
    await readFile(join(blockedSplitExperimentDir, 'tasks/settings-toggle/raw-trace.json'), 'utf8')
      .then(
        () => assert(false, 'blocked split-CDP export must not leave raw-trace.json on disk'),
        () => assert(true, 'blocked split-CDP export should not create raw-trace.json')
      );
  } finally {
    await blockedSplitGuardServer.close();
    await blockedSplitRendererServer.close();
  }

  const blockedLiveServer = await startSyntheticUitarsCdpServer({
    state: stateFixture(),
    targets: (port) => [
      {
        id: 'benchmark-task',
        type: 'page',
        title: 'GUI Agent Benchmark',
        url: 'http://127.0.0.1:4173/?task=settings-toggle',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/benchmark-task`
      },
      {
        id: 'signin-target',
        type: 'page',
        title: 'Sign in',
        url: 'https://signin.volcengine.com/auth/login',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/signin-target`
      },
      {
        id: 'renderer-1',
        type: 'page',
        title: 'UI-TARS Local Browser Operator',
        url: 'http://127.0.0.1/synthetic-uitars-renderer',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/renderer-1`
      }
    ]
  });
  try {
    const blockedLiveExperimentDir = join(tempDir, 'blocked-live-experiment');
    let blocked = false;
    try {
      await exportUitarsNativeTranscriptFromLiveCdp({
        cdpUrl: blockedLiveServer.cdpUrl,
        taskId: 'settings-toggle',
        taskTitle: 'Update workspace settings',
        experimentDir: blockedLiveExperimentDir,
        prompt: 'Complete settings-toggle.',
        finalCapture: {
          ...finalCapture,
          benchmarkUrl: 'http://127.0.0.1:4173/?task=settings-toggle'
        },
        requireLiveGuard: true,
        createdAt: '2026-05-29T00:00:00.000Z'
      });
    } catch (error) {
      blocked = /blocked by live target guard: .*external|blocked by live target guard: .*sign-in/i.test(error.message);
    }
    assert(blocked, 'live CDP export should block unsafe target guard before writing raw trace');
    const liveGuard = JSON.parse(await readFile(join(blockedLiveExperimentDir, 'tasks/settings-toggle/raw/live-guard.json'), 'utf8'));
    assert(liveGuard.verdict === 'blocked', 'blocked live export should write live-guard.json with blocked verdict');
    assert(liveGuard.blockedTargets?.[0]?.url === '[redacted-url]', 'blocked live export guard should redact blocked remote sign-in URL');
    assert(!JSON.stringify(liveGuard).includes('signin.volcengine.com'), 'blocked live export guard should omit blocked remote sign-in hostname');
    await readFile(join(blockedLiveExperimentDir, 'tasks/settings-toggle/raw-trace.json'), 'utf8')
      .then(
        () => assert(false, 'blocked live guard export must not leave raw-trace.json on disk'),
        () => assert(true, 'blocked live guard export should not create raw-trace.json')
      );
    assert(!blockedLiveServer.fixture.expressionSeen, 'blocked live guard export should not evaluate renderer state after unsafe target verdict');
  } finally {
    await blockedLiveServer.close();
  }

  const sensitiveGuardServer = await startSyntheticUitarsCdpServer({
    state: stateFixture(),
    version: {
      Browser: 'SyntheticChrome api_key=secret-value',
      'Protocol-Version': '1.3'
    },
    targets: (port) => [
      {
        id: 'benchmark-task',
        type: 'page',
        title: 'GUI Agent Benchmark',
        url: 'http://127.0.0.1:4173/?task=settings-toggle',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/benchmark-task`
      },
      {
        id: 'renderer-1',
        type: 'page',
        title: 'UI-TARS Local Browser Operator',
        url: 'http://127.0.0.1/synthetic-uitars-renderer',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/renderer-1`
      }
    ]
  });
  try {
    const sensitiveGuardExperimentDir = join(tempDir, 'sensitive-guard-experiment');
    await exportUitarsNativeTranscriptFromLiveCdp({
      cdpUrl: sensitiveGuardServer.cdpUrl,
      taskId: 'settings-toggle',
      taskTitle: 'Update workspace settings',
      experimentDir: sensitiveGuardExperimentDir,
      prompt: 'Complete settings-toggle.',
      benchmarkUrl: 'http://127.0.0.1:4173/?task=settings-toggle',
      requireLiveGuard: true,
      createdAt: '2026-05-29T00:00:00.000Z'
    });
    const sensitiveGuardText = await readFile(join(sensitiveGuardExperimentDir, 'tasks/settings-toggle/raw/live-guard.json'), 'utf8');
    assert(!sensitiveGuardText.includes('secret-value'), 'sensitive live guard export should redact version secret value');
    assert(!sensitiveGuardText.includes('api_key='), 'sensitive live guard export should redact version api_key key-value text');
    assert(!sensitiveGuardText.includes('webSocketDebuggerUrl'), 'sensitive live guard export should omit debugger websocket keys');
    assert(!sensitiveGuardText.includes('ws://'), 'sensitive live guard export should omit debugger websocket URLs');
    await readFile(join(sensitiveGuardExperimentDir, 'tasks/settings-toggle/raw-trace.json'), 'utf8')
      .then(
        () => assert(true, 'sensitive live guard export should still write raw-trace.json after sanitizing guard report'),
        () => assert(false, 'sensitive live guard export should write raw-trace.json after sanitizing guard report')
      );
  } finally {
    await sensitiveGuardServer.close();
  }

  const envLiveServer = await startSyntheticUitarsCdpServer({ state: stateFixture() });
  try {
    const envLiveExperimentDir = join(tempDir, 'env-live-experiment');
    await execFileAsync(
      process.execPath,
      [
        'scripts/export-uitars-native-transcript.mjs',
        '--task',
        'settings-toggle',
        '--experiment-dir',
        envLiveExperimentDir,
        '--prompt',
        'Complete settings-toggle.'
      ],
      {
        env: {
          ...process.env,
          UI_TARS_CDP_URL: envLiveServer.cdpUrl
        }
      }
    );
    const envLiveTrace = JSON.parse(await readFile(join(envLiveExperimentDir, 'tasks/settings-toggle/raw-trace.json'), 'utf8'));
    assert(
      envLiveTrace.events.some((event) => event.type === 'action' && event.action?.name === 'click'),
      'CLI export should use UI_TARS_CDP_URL when --state-json is omitted'
    );
    assert(envLiveServer.fixture.expressionSeen, 'CLI export through UI_TARS_CDP_URL should evaluate the renderer-state expression');
  } finally {
    await envLiveServer.close();
  }

  const envDiscoverLiveServer = await startSyntheticUitarsCdpServer({ state: stateFixture() });
  try {
    const envDiscoverExperimentDir = join(tempDir, 'env-discover-live-experiment');
    const fakeBinDir = join(tempDir, 'fake-bin');
    const profileDir = join(tempDir, 'puppeteer_dev_chrome_profile-discover');
    const cdpPort = new URL(envDiscoverLiveServer.cdpUrl).port;
    await mkdir(fakeBinDir, { recursive: true });
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(profileDir, 'DevToolsActivePort'), `${cdpPort}\n/devtools/browser/synthetic\n`, 'utf8');
    await writeFile(
      join(fakeBinDir, 'ps'),
      [
        '#!/bin/sh',
        'cat <<EOF',
        '100 1 /Applications/UI TARS.app/Contents/MacOS/UI-TARS',
        `101 100 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=${profileDir} --remote-debugging-port=0`,
        'EOF'
      ].join('\n'),
      'utf8'
    );
    await chmod(join(fakeBinDir, 'ps'), 0o755);
    await execFileAsync(
      process.execPath,
      [
        'scripts/export-uitars-native-transcript.mjs',
        '--task',
        'settings-toggle',
        '--experiment-dir',
        envDiscoverExperimentDir,
        '--prompt',
        'Complete settings-toggle.'
      ],
      {
        env: {
          ...process.env,
          PATH: `${fakeBinDir}:${process.env.PATH || ''}`,
          UI_TARS_CDP_URL: '',
          UI_TARS_DISCOVER_LOCAL: '1'
        }
      }
    );
    const envDiscoverTrace = JSON.parse(await readFile(join(envDiscoverExperimentDir, 'tasks/settings-toggle/raw-trace.json'), 'utf8'));
    assert(
      envDiscoverTrace.events.some((event) => event.type === 'action' && event.action?.name === 'click'),
      'CLI export should honor UI_TARS_DISCOVER_LOCAL=1 when --state-json is omitted'
    );
    assert(envDiscoverLiveServer.fixture.expressionSeen, 'CLI export through UI_TARS_DISCOVER_LOCAL=1 should evaluate the renderer-state expression');
  } finally {
    await envDiscoverLiveServer.close();
  }

  const stateJsonPath = join(tempDir, 'state-fixture.json');
  const stateGuardExperimentDir = join(tempDir, 'state-json-live-guard-experiment');
  await writeFile(stateJsonPath, `${JSON.stringify(stateFixture(), null, 2)}\n`, 'utf8');
  let stateGuardRejected = false;
  try {
    await execFileAsync(
      process.execPath,
      [
        'scripts/export-uitars-native-transcript.mjs',
        '--task',
        'settings-toggle',
        '--experiment-dir',
        stateGuardExperimentDir,
        '--state-json',
        stateJsonPath,
        '--require-live-guard'
      ]
    );
  } catch (error) {
    stateGuardRejected = /--require-live-guard only applies to live CDP export/i.test(`${error.stderr || ''}${error.message || ''}`);
  }
  assert(stateGuardRejected, 'CLI should reject --state-json together with --require-live-guard');
  await readFile(join(stateGuardExperimentDir, 'tasks/settings-toggle/raw-trace.json'), 'utf8')
    .then(
      () => assert(false, 'rejected --state-json --require-live-guard export must not write raw-trace.json'),
      () => assert(true, 'rejected --state-json --require-live-guard export should not create raw-trace.json')
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
