#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

import {
  evaluateLiveTargetGuard,
  sanitizeReportString
} from '../src/uitars-live-target-guard.mjs';

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

async function startTargetListServer({ targets, version = null, state = null }) {
  const fixture = {
    expressionSeen: false
  };
  const sockets = new Set();
  const server = createServer((request, response) => {
    if (request.url === '/json/list') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(typeof targets === 'function' ? targets(server.address().port) : targets));
      return;
    }
    if (request.url === '/json/version') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(version || {
        Browser: 'SyntheticChrome/1.0',
        'Protocol-Version': '1.3'
      }));
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });
  server.on('upgrade', (request, socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
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
      if (message.method === 'Runtime.evaluate') fixture.expressionSeen = true;
      socket.write(encodeServerFrame({
        id: message.id,
        result: {
          result: {
            type: 'object',
            value: {
              source: 'zustandBridge.getState',
              messages: state?.messages || [{ role: 'assistant', content: 'ready' }]
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
    close: () => new Promise((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(resolve);
    })
  };
}

function target(id, url, title = 'GUI Agent Benchmark') {
  return {
    id,
    type: 'page',
    title,
    url
  };
}

const taskUrl = 'http://127.0.0.1:4173/?task=ticket-review';
const forbiddenReportStrings = [
  'secret-value',
  'SECRET123',
  '192.168.1.20',
  '203.0.113.10',
  'remote.example.com',
  'Bearer',
  'api_key=',
  'token:',
  'Authorization',
  'webSocketDebuggerUrl',
  'ws://',
  'wss://'
];
const cases = [
  {
    name: 'safe exact benchmark target',
    targets: [target('task', taskUrl)],
    requireRendererState: false,
    expectedVerdict: 'safe_to_prompt'
  },
  {
    name: 'missing exact benchmark target',
    targets: [],
    requireRendererState: false,
    expectedVerdict: 'blocked'
  },
  {
    name: 'multiple exact benchmark targets',
    targets: [target('task-1', taskUrl), target('task-2', taskUrl)],
    requireRendererState: false,
    expectedVerdict: 'blocked'
  },
  {
    name: 'exact target plus search page',
    targets: [
      target('task', taskUrl),
      target('search', 'https://www.google.com/search?q=benchmark', 'Google Search')
    ],
    requireRendererState: false,
    expectedVerdict: 'blocked'
  },
  {
    name: 'exact target plus external sign-in page',
    targets: [
      target('task', taskUrl),
      target('signin', 'https://signin.volcengine.com/auth/login', 'Sign in')
    ],
    requireRendererState: false,
    expectedVerdict: 'blocked'
  },
  {
    name: 'exact target plus arbitrary external page',
    targets: [
      target('task', taskUrl),
      target('external', 'https://example.com/', 'Example Domain')
    ],
    requireRendererState: false,
    expectedVerdict: 'blocked'
  },
  {
    name: 'exact target plus private-network page',
    targets: [
      target('task', taskUrl),
      target('private-network', 'http://192.168.1.20/login?token=SECRET123', 'Private login')
    ],
    requireRendererState: false,
    expectedVerdict: 'blocked'
  },
  {
    name: 'requireRendererState=true with missing renderer state',
    targets: [target('task', taskUrl)],
    requireRendererState: true,
    expectedVerdict: 'blocked'
  },
  {
    name: 'renderer-state error is sanitized',
    targets: [
      target('task', taskUrl),
      target('renderer', 'about:blank', 'UI-TARS renderer Authorization: Bearer SECRET123 token: SECRET123')
    ],
    requireRendererState: true,
    expectedVerdict: 'blocked',
    forbiddenStrings: ['SECRET123', 'Bearer', 'token: SECRET123', 'Authorization']
  },
  {
    name: 'sensitive version and target fields are sanitized',
    version: {
      Browser: 'SyntheticChrome api_key=secret-value headers: Bearer SECRET123',
      'Protocol-Version': '1.3 passwd: SECRET123 token: SECRET123'
    },
    targets: [
      target(
        'target-api_key=secret-value',
        taskUrl,
        'GUI Agent Benchmark Authorization: Bearer SECRET123'
      )
    ],
    requireRendererState: false,
    expectedVerdict: 'safe_to_prompt'
  },
  {
    name: 'successful renderer state target fields are sanitized',
    targets: (port) => [
      target('task', taskUrl),
      {
        id: 'renderer',
        type: 'page',
        title: 'UI-TARS Local Browser Operator headers: Bearer SECRET123 token: SECRET123',
        url: 'http://127.0.0.1/synthetic-uitars-renderer?localstorage=secret-value&base64=SECRET123',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/renderer`
      }
    ],
    requireRendererState: true,
    expectedVerdict: 'safe_to_prompt'
  }
];

for (const item of cases) {
  const fixture = await startTargetListServer({
    targets: item.targets,
    version: item.version,
    state: item.state
  });
  try {
    const report = await evaluateLiveTargetGuard({
      cdpUrl: fixture.cdpUrl,
      benchmarkUrl: taskUrl,
      taskId: 'ticket-review',
      requireRendererState: item.requireRendererState,
      timeoutMs: 250
    });
    assert(
      report.verdict === item.expectedVerdict,
      `${item.name}: expected ${item.expectedVerdict}, got ${report.verdict}`
    );
    assert(
      JSON.stringify(report).includes('webSocketDebuggerUrl') === false,
      `${item.name}: report must sanitize debugger websocket URLs`
    );
    assert(
      JSON.stringify(report).includes('ws://') === false,
      `${item.name}: report must sanitize raw websocket URLs`
    );
    for (const forbidden of item.forbiddenStrings || []) {
      assert(
        JSON.stringify(report).includes(forbidden) === false,
        `${item.name}: report must sanitize sensitive renderer error text "${forbidden}"`
      );
    }
    for (const forbidden of forbiddenReportStrings) {
      assert(
        JSON.stringify(report).includes(forbidden) === false,
        `${item.name}: report must not include sensitive string "${forbidden}"`
      );
    }
  } finally {
    await fixture.close();
  }
}

const splitGuardFixture = await startTargetListServer({
  targets: [target('task', taskUrl)]
});
const splitRendererFixture = await startTargetListServer({
  targets: (port) => [
    {
      id: 'renderer',
      type: 'page',
      title: 'UI-TARS Local Browser Operator',
      url: 'http://127.0.0.1/synthetic-uitars-renderer',
      webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/renderer`
    }
  ],
  state: {
    messages: [
      {
        role: 'assistant',
        content: 'renderer ready'
      }
    ]
  }
});
try {
  const report = await evaluateLiveTargetGuard({
    cdpUrl: splitGuardFixture.cdpUrl,
    rendererCdpUrl: splitRendererFixture.cdpUrl,
    benchmarkUrl: taskUrl,
    taskId: 'ticket-review',
    requireRendererState: true,
    timeoutMs: 250
  });
  assert(report.verdict === 'safe_to_prompt', `split renderer endpoint: expected safe_to_prompt, got ${report.verdict}`);
  assert(splitRendererFixture.fixture.expressionSeen, 'split renderer endpoint should evaluate renderer state on rendererCdpUrl');
  assert(!splitGuardFixture.fixture.expressionSeen, 'split renderer endpoint should not evaluate renderer state on guard cdpUrl');
  assert(
    new URL(report.rendererState?.cdp?.endpoint).origin === new URL(splitRendererFixture.cdpUrl).origin,
    'split renderer endpoint should be reported as sanitized rendererState cdp endpoint'
  );
  assert(JSON.stringify(report).includes('webSocketDebuggerUrl') === false, 'split renderer endpoint report must sanitize debugger websocket URLs');
  assert(JSON.stringify(report).includes('ws://') === false, 'split renderer endpoint report must sanitize raw websocket URLs');
} finally {
  await splitGuardFixture.close();
  await splitRendererFixture.close();
}

const remoteAllowedSplitReportText = JSON.stringify({
  cdp: {
    endpoint: 'https://203.0.113.10:9222/json/list'
  },
  rendererState: {
    cdp: {
      endpoint: 'https://remote.example.com:9333'
    },
    targetTitle: 'UI-TARS Renderer at remote.example.com',
    targetUrl: 'https://remote.example.com/path?token=SECRET123',
    websocket: 'wss://remote.example.com/devtools/page/renderer'
  },
  benchmark: {
    url: taskUrl
  }
});
const sanitizedRemoteAllowedSplitReport = sanitizeReportString(remoteAllowedSplitReportText);
assert(
  sanitizedRemoteAllowedSplitReport.includes(taskUrl),
  'remote-allowed split report sanitizer should preserve local benchmark URL'
);
for (const forbidden of ['203.0.113.10', 'remote.example.com', 'wss://', 'SECRET123', 'token=']) {
  assert(
    !sanitizedRemoteAllowedSplitReport.includes(forbidden),
    `remote-allowed split report sanitizer must not include "${forbidden}"`
  );
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('UI-TARS live target guard validation passed.');
}
