#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const errors = [];

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

async function startInspectFixture({ hasState }) {
  const server = createServer((request, response) => {
    if (request.url === '/json/list') {
      const port = server.address().port;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify([
        {
          id: 'renderer-token-secret',
          type: 'page',
          title: 'UI-TARS Renderer remote.example.com Authorization Bearer REAL_SECRET token cookie',
          url: 'https://remote.example.com/path?token=REAL_SECRET&host=203.0.113.10',
          webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/renderer-token-secret`
        }
      ]));
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
      if (!hasState) {
        socket.write(encodeServerFrame({
          id: message.id,
          result: {
            exceptionDetails: {
              text: 'Authorization Bearer REAL_SECRET token cookie remote.example.com 203.0.113.10 webSocketDebuggerUrl wss://remote.example.com/devtools/page/x data:image/png;base64,abc'
            }
          }
        }));
        return;
      }
      socket.write(encodeServerFrame({
        id: message.id,
        result: {
          result: {
            type: 'object',
            value: {
              source: 'zustandBridge.getState',
              messages: [
                {
                  role: 'assistant',
                  content: 'ready',
                  screenshot: 'data:image/png;base64,' + 'a'.repeat(620)
                }
              ]
            }
          }
        }
      }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    cdpUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

function assertSanitized(label, text) {
  for (const forbidden of [
    'webSocketDebuggerUrl',
    'ws://',
    'data:image',
    'Bearer',
    'token',
    'cookie',
    'authorization',
    'REAL_SECRET',
    'REAL_COOKIE',
    '192.168.1.20',
    '203.0.113.10',
    'remote.example.com',
    'wss://'
  ]) {
    assert(!text.toLowerCase().includes(forbidden.toLowerCase()), `${label} must not contain ${forbidden}`);
  }
}

const tempDir = await mkdtemp(join(tmpdir(), 'uitars-renderer-state-inspect-'));
try {
  const successFixture = await startInspectFixture({ hasState: true });
  try {
    const output = join(tempDir, 'success', 'inspect.json');
    const result = await execFileAsync(process.execPath, [
      'scripts/uitars-renderer-state-inspect.mjs',
      '--cdp-url',
      successFixture.cdpUrl,
      '--output',
      output
    ]);
    const reportText = await readFile(output, 'utf8');
    const stdoutText = result.stdout || '';
    const report = JSON.parse(reportText);
    assert(report.rendererState?.available === true, 'success fixture should report renderer state available');
    assert(report.rendererState?.messageCount > 0, 'success fixture should report messageCount > 0');
    assertSanitized('success stdout', stdoutText);
    assertSanitized('success report', reportText);
  } finally {
    await successFixture.close();
  }

  const missingFixture = await startInspectFixture({ hasState: false });
  try {
    const output = join(tempDir, 'missing', 'inspect.json');
    await mkdir(join(tempDir, 'missing'), { recursive: true });
    let failed = false;
    let stdoutText = '';
    let stderrText = '';
    try {
      await execFileAsync(process.execPath, [
        'scripts/uitars-renderer-state-inspect.mjs',
        '--cdp-url',
        missingFixture.cdpUrl,
        '--output',
        output
      ]);
    } catch (error) {
      failed = error.code !== 0;
      stdoutText = error.stdout || '';
      stderrText = error.stderr || '';
    }
    assert(failed, 'missing-state fixture should exit non-zero');
    const reportText = await readFile(output, 'utf8');
    const report = JSON.parse(reportText);
    assert(report.rendererState?.available === false, 'missing-state fixture should write unavailable renderer state report');
    assert(typeof report.rendererState?.error === 'string' && report.rendererState.error.length > 0, 'missing-state fixture should write sanitized error');
    assertSanitized('missing stdout', stdoutText);
    assertSanitized('missing stderr', stderrText);
    assertSanitized('missing report', reportText);
  } finally {
    await missingFixture.close();
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

if (errors.length > 0) {
  console.error('UI-TARS renderer state inspector validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('UI-TARS renderer state inspector validation passed.');
