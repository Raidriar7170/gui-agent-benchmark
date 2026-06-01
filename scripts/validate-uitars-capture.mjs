#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateRun } from '../src/runs.mjs';
import { tracesToRuns } from '../src/trace-importer.mjs';
import { runUitarsCapture } from '../src/uitars-capture.mjs';

const benchmarkUrl = 'http://127.0.0.1:4173/?task=onboarding-form';
const benchmarkBaseUrl = 'http://127.0.0.1:4173';
const tasks = JSON.parse(await readFile(new URL('../public/tasks.json', import.meta.url), 'utf8'));

function expectedCaptureExpression(taskId) {
  const taskIdLiteral = JSON.stringify(taskId);
  if (typeof taskIdLiteral !== 'string') throw new Error('taskId must be JSON-serializable.');
  return `(() => {
    if (!window.__BENCH__ || typeof window.__BENCH__.snapshot !== 'function' || typeof window.__BENCH__.evaluate !== 'function') {
      throw new Error('window.__BENCH__.snapshot/evaluate are not available.');
    }
    const finalState = window.__BENCH__.snapshot();
    const evaluation = window.__BENCH__.evaluate(${taskIdLiteral});
    return { finalState, evaluation };
  })()`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function successValue(extra = {}) {
  return {
    finalState: {
      submitted: true,
      fields: {
        fullName: 'Maya Ortiz',
        email: 'maya.ortiz@example.com',
        role: 'Designer',
        startDate: '2026-06-15',
        notes: 'Figma access'
      },
      ...extra.finalState
    },
    evaluation: {
      success: true,
      score: 1,
      details: [
        {
          criterion: 'synthetic capture passed',
          pass: true,
          expected: true,
          actual: true
        }
      ],
      ...extra.evaluation
    }
  };
}

function encodeServerFrame(payload, opcode = 0x1) {
  const length = payload.length;
  const headerLength = length < 126 ? 2 : length <= 0xffff ? 4 : 10;
  const frame = Buffer.alloc(headerLength + length);
  frame[0] = 0x80 | opcode;
  if (length < 126) {
    frame[1] = length;
  } else if (length <= 0xffff) {
    frame[1] = 126;
    frame.writeUInt16BE(length, 2);
  } else {
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(length), 2);
  }
  payload.copy(frame, headerLength);
  return frame;
}

function decodeClientFrame(buffer) {
  if (buffer.length < 2) return null;
  const byte2 = buffer[1];
  let length = byte2 & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  const masked = Boolean(byte2 & 0x80);
  const maskOffset = offset;
  const payloadOffset = offset + (masked ? 4 : 0);
  if (buffer.length < payloadOffset + length) return null;
  const payload = Buffer.from(buffer.subarray(payloadOffset, payloadOffset + length));
  if (masked) {
    const mask = buffer.subarray(maskOffset, maskOffset + 4);
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }
  return {
    opcode: buffer[0] & 0x0f,
    payload,
    bytes: payloadOffset + length
  };
}

function assertSafeRuntimeEvaluate(message) {
  assert(message.method === 'Runtime.evaluate', `expected Runtime.evaluate, received ${String(message.method)}`);
  const expectedParamKeys = ['expression', 'returnByValue', 'awaitPromise', 'userGesture'];
  const actualParamKeys = Object.keys(message.params || {});
  assert(
    actualParamKeys.length === expectedParamKeys.length
      && expectedParamKeys.every((key) => actualParamKeys.includes(key)),
    `Runtime.evaluate params must only include ${expectedParamKeys.join(', ')}`
  );
  assert(
    message.params?.expression === expectedCaptureExpression('onboarding-form'),
    'Runtime.evaluate expression must match the pinned benchmark capture expression exactly'
  );
  assert(message.params.returnByValue === true, 'Runtime.evaluate returnByValue must be true');
  assert(message.params.awaitPromise === false, 'Runtime.evaluate awaitPromise must be false');
  assert(message.params.userGesture === false, 'Runtime.evaluate userGesture must be false');
}

async function withSyntheticCdpServer(config, callback) {
  const cdpErrors = [];
  const websocketPaths = [];
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/json/version') {
      response.end(JSON.stringify({
        Browser: 'SyntheticChrome/1.0',
        'Protocol-Version': '1.3'
      }));
      return;
    }
    if (request.url === '/json/list') {
      const port = server.address().port;
      response.end(JSON.stringify(config.targets(port)));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not found' }));
  });

  server.on('upgrade', (request, socket) => {
    websocketPaths.push(request.url);
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

    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const frame = decodeClientFrame(buffer);
        if (!frame) return;
        buffer = buffer.subarray(frame.bytes);
        if (frame.opcode === 0x8) {
          socket.end(encodeServerFrame(Buffer.alloc(0), 0x8));
          return;
        }
        const message = JSON.parse(frame.payload.toString('utf8'));
        try {
          assertSafeRuntimeEvaluate(message);
        } catch (error) {
          cdpErrors.push(error instanceof Error ? error.message : String(error));
        }
        const response = config.runtimeException
          ? {
            id: message.id,
            result: {
              exceptionDetails: {
                text: 'Uncaught',
                exception: { description: config.runtimeException }
              }
            }
          }
          : {
            id: message.id,
            result: {
              result: {
                type: 'object',
                value: config.runtimeValue || successValue()
              }
            }
          };
        socket.write(encodeServerFrame(Buffer.from(JSON.stringify(response), 'utf8')));
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await callback(`http://127.0.0.1:${server.address().port}`);
    if (cdpErrors.length > 0) throw new Error(cdpErrors.join('; '));
    if (config.websocketPaths) {
      assert(
        JSON.stringify(websocketPaths) === JSON.stringify(config.websocketPaths),
        `expected WebSocket paths ${JSON.stringify(config.websocketPaths)}, received ${JSON.stringify(websocketPaths)}`
      );
    }
    return result;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function exactTarget(port, id = 'target-1') {
  return {
    id,
    type: 'page',
    title: 'GUI Agent Benchmark',
    url: benchmarkUrl,
    webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${id}`
  };
}

function decoyTarget(port, id = 'decoy-target') {
  return {
    id,
    type: 'page',
    title: 'GUI Agent Benchmark',
    url: 'http://127.0.0.1:4173/?task=catalog-filter',
    webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${id}`
  };
}

async function expectRejects(label, config, expectedPattern) {
  await withSyntheticCdpServer(config, async (cdpUrl) => {
    const outputDir = await mkdtemp(join(tmpdir(), 'uitars-capture-negative-'));
    try {
      let rejected = false;
      try {
        await runUitarsCapture({
          taskId: 'onboarding-form',
          outputDir,
          baseUrl: benchmarkBaseUrl,
          cdpUrl
        });
      } catch (error) {
        rejected = true;
        assert(expectedPattern.test(error.message), `${label} rejected with unexpected message: ${error.message}`);
      }
      assert(rejected, `${label} unexpectedly succeeded`);
      for (const fileName of ['capture.json', 'trace.json', 'run-export.json']) {
        assert(!await pathExists(join(outputDir, fileName)), `${label} wrote ${fileName} after rejection`);
      }
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
}

const errors = [];

async function runTest(name, fn) {
  try {
    await fn();
  } catch (error) {
    errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await runTest('successful capture writes valid artifacts', async () => {
  await withSyntheticCdpServer({
    targets: (port) => [exactTarget(port)]
  }, async (cdpUrl) => {
    const outputDir = await mkdtemp(join(tmpdir(), 'uitars-capture-success-'));
    try {
      const result = await runUitarsCapture({
        taskId: 'onboarding-form',
        outputDir,
        baseUrl: benchmarkBaseUrl,
        cdpUrl
      });
      assert(result.capture.captureStatus === 'captured', 'capture status should be captured');
      const capture = JSON.parse(await readFile(join(outputDir, 'capture.json'), 'utf8'));
      const trace = JSON.parse(await readFile(join(outputDir, 'trace.json'), 'utf8'));
      const runExport = JSON.parse(await readFile(join(outputDir, 'run-export.json'), 'utf8'));

      assert(capture.finalState.submitted === true, 'capture should include finalState');
      assert(trace.source === 'ui-tars-real-run-capture', 'trace should identify capture source');
      assert(trace.events.some((event) => event.type === 'real_run_capture' && event.countsAsStep === false), 'trace should include non-step capture event');
      assert(runExport.runs.length === 1, 'run export should include one run');

      const runs = tracesToRuns([trace], tasks);
      assert(validateRun(runs[0]).length === 0, 'trace should convert to a valid run');
      assert(validateRun(runExport.runs[0]).length === 0, 'run export should validate');

      const artifactText = JSON.stringify({ capture, trace, runExport });
      assert(!/webSocketDebuggerUrl|cookie|header|token|password|base64/i.test(artifactText), 'artifacts should not include sensitive content');
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});

await runTest('zero exact target is blocked', async () => {
  await expectRejects('zero target', {
    targets: () => []
  }, /blocked|No exact benchmark target/i);
});

await runTest('multiple exact targets are ambiguous', async () => {
  await expectRejects('multiple targets', {
    targets: (port) => [exactTarget(port, 'target-1'), exactTarget(port, 'target-2')]
  }, /ambiguous|multiple exact benchmark targets/i);
});

await runTest('exact target ignores wrong-task decoy on same app URL', async () => {
  await withSyntheticCdpServer({
    targets: (port) => [decoyTarget(port), exactTarget(port, 'exact-target')],
    websocketPaths: ['/devtools/page/exact-target']
  }, async (cdpUrl) => {
    const outputDir = await mkdtemp(join(tmpdir(), 'uitars-capture-exact-target-'));
    try {
      await runUitarsCapture({
        taskId: 'onboarding-form',
        outputDir,
        baseUrl: benchmarkBaseUrl,
        cdpUrl
      });
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});

await runTest('wrong-task decoy without exact target is blocked', async () => {
  await expectRejects('wrong-task decoy', {
    targets: (port) => [decoyTarget(port)],
    websocketPaths: []
  }, /blocked|No exact benchmark target/i);
});

await runTest('require live guard blocks sign-in target and writes report', async () => {
  await withSyntheticCdpServer({
    targets: (port) => [
      exactTarget(port),
      {
        id: 'signin-target',
        type: 'page',
        title: 'Sign in',
        url: 'https://signin.volcengine.com/auth/login',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/signin-target`
      }
    ],
    websocketPaths: []
  }, async (cdpUrl) => {
    const outputDir = await mkdtemp(join(tmpdir(), 'uitars-capture-live-guard-'));
    try {
      let rejected = false;
      try {
        await runUitarsCapture({
          taskId: 'onboarding-form',
          outputDir,
          baseUrl: benchmarkBaseUrl,
          cdpUrl,
          requireLiveGuard: true
        });
      } catch (error) {
        rejected = true;
        assert(/blocked by live target guard: .*external|blocked by live target guard: .*sign-in/i.test(error.message), `live guard rejected with unexpected message: ${error.message}`);
      }
      assert(rejected, 'live guard unsafe target unexpectedly succeeded');
      const guard = JSON.parse(await readFile(join(outputDir, 'live-guard.json'), 'utf8'));
      assert(guard.verdict === 'blocked', 'capture live guard report should record blocked verdict');
      assert(guard.blockedTargets?.[0]?.url === '[redacted-url]', 'capture live guard report should redact blocked remote sign-in URL');
      assert(!JSON.stringify(guard).includes('signin.volcengine.com'), 'capture live guard report should omit blocked remote sign-in hostname');
      for (const fileName of ['capture.json', 'trace.json', 'run-export.json']) {
        assert(!await pathExists(join(outputDir, fileName)), `live guard rejection wrote ${fileName}`);
      }
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});

await runTest('runtime exception is rejected', async () => {
  await expectRejects('runtime exception', {
    targets: (port) => [exactTarget(port)],
    runtimeException: 'window.__BENCH__.evaluate failed'
  }, /Runtime\.evaluate|evaluate failed/i);
});

await runTest('sensitive runtime output is rejected', async () => {
  await expectRejects('sensitive output', {
    targets: (port) => [exactTarget(port)],
    runtimeValue: successValue({
      finalState: {
        webSocketDebuggerUrl: `ws://127.0.0.1:${randomBytes(2).toString('hex')}/devtools/page/1`
      }
    })
  }, /sensitive|prohibited/i);
});

if (errors.length > 0) {
  console.error('UI-TARS capture validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('UI-TARS capture validation passed for synthetic CDP fixtures.');
