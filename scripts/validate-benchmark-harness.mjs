#!/usr/bin/env node
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryStorage, listRuns, validateRun } from '../src/runs.mjs';
import { runBenchmarkHarness, inspectSensitiveOutput } from '../src/benchmark-harness.mjs';
import { importExternalRuns, tracesToRuns } from '../src/trace-importer.mjs';
import { loadTasks } from '../src/task-registry.mjs';
import {
  isBenchmarkAppTarget,
  isBenchmarkTarget,
  prepareUitarsTarget,
  runUitarsPreflight,
  validatePreflightReport
} from '../src/uitars-preflight.mjs';

const errors = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function collectOutputFiles(dir, files = []) {
  if (!(await pathExists(dir))) return files;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectOutputFiles(path, files);
    } else if (entry.name.endsWith('.json') || entry.name.endsWith('.txt')) {
      files.push(path);
    }
  }
  return files;
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
  if (!masked) return null;
  const payloadOffset = offset + 4;
  if (buffer.length < payloadOffset + length) return null;
  const mask = buffer.subarray(offset, offset + 4);
  const payload = Buffer.from(buffer.subarray(payloadOffset, payloadOffset + length));
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] ^= mask[index % 4];
  }
  return {
    opcode: buffer[0] & 0x0f,
    payload,
    bytes: payloadOffset + length
  };
}

function encodeServerFrame(payload, opcode = 0x1) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const headerLength = body.length < 126 ? 2 : body.length <= 0xffff ? 4 : 10;
  const frame = Buffer.alloc(headerLength + body.length);
  frame[0] = 0x80 | opcode;
  if (body.length < 126) {
    frame[1] = body.length;
  } else if (body.length <= 0xffff) {
    frame[1] = 126;
    frame.writeUInt16BE(body.length, 2);
  } else {
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(body.length), 2);
  }
  body.copy(frame, headerLength);
  return frame;
}

const root = await mkdtemp(join(tmpdir(), 'uitars-harness-'));
const credentialRoot = await mkdtemp(join(tmpdir(), 'uitars-harness-credentials-'));

try {
  const tasks = await loadTasks();
  const result = await runBenchmarkHarness({
    outputDir: root,
    tasks: 'onboarding-form',
    baseUrl: 'http://127.0.0.1:4173',
    cdpUrl: '',
    discoverLocalUitars: false,
    prepareTarget: true,
    preflightFix: false,
    now: new Date('2026-05-21T00:00:00.000Z')
  });

  assert(result.outputDir === root, 'harness should report the requested output directory');
  assert(result.totalTasks === 1, 'harness should generate one selected task');
  assert(result.blockedTasks === 1, 'no-CDP validation should record the task as blocked');

  const taskDir = join(root, 'tasks', 'onboarding-form');
  const metadata = await readJson(join(root, 'metadata.json'));
  const targetPrepareReport = await readJson(join(taskDir, 'target-prepare.json'));
  const dryRunReport = await readJson(join(taskDir, 'preflight-dry-run.json'));
  const trace = await readJson(join(taskDir, 'trace.json'));
  const runExport = await readJson(join(taskDir, 'run-export.json'));
  const prompt = await readFile(join(taskDir, 'prompt.txt'), 'utf8');

  assert(metadata.tasks[0]?.status === 'blocked', 'metadata should record blocked task status');
  assert(metadata.tasks[0]?.targetPrepareStatus === 'blocked', 'metadata should record target preparation status');
  assert(metadata.tasks[0]?.files?.targetPrepare === 'tasks/onboarding-form/target-prepare.json', 'metadata should reference target preparation report');
  assert(prompt.includes('Maya Ortiz'), 'prompt should contain the task instruction');
  assert(targetPrepareReport.status === 'blocked', 'target preparation should be blocked without CDP');
  assert(validatePreflightReport(targetPrepareReport).length === 0, 'target preparation report should satisfy schema validation');
  assert(dryRunReport.status === 'blocked', 'dry-run preflight should be blocked without CDP');
  assert(validatePreflightReport(dryRunReport).length === 0, 'dry-run preflight report should satisfy schema validation');
  assert(trace.events[0]?.type === 'target_prepare', 'trace should include target preparation event before preflight');
  assert(trace.events[0]?.countsAsStep === false, 'target preparation event should not count as a step');

  const runsFromTrace = tracesToRuns([trace], tasks);
  assert(runsFromTrace.length === 1, 'tracesToRuns should accept harness trace');
  assert(validateRun(runsFromTrace[0]).length === 0, 'run normalized from harness trace should validate');
  assert(runsFromTrace[0].endedAt === null, 'harness trace without final state should remain active');
  assert(runsFromTrace[0].success === null, 'harness trace should remain unjudged');

  assert(runExport.runs.length === 1, 'run export should include one run');
  assert(validateRun(runExport.runs[0]).length === 0, 'run export should satisfy run schema');
  assert(runExport.runs[0].id === runsFromTrace[0].id, 'run export should match trace importer output');

  const storage = createMemoryStorage();
  const imported = importExternalRuns({ traces: [trace] }, { storage, tasks });
  assert(imported.imported === 1, 'importExternalRuns should import harness trace');
  assert(listRuns(storage).length === 1, 'imported harness trace should appear in run storage');

  const outputFiles = await collectOutputFiles(root);
  for (const file of outputFiles) {
    const text = await readFile(file, 'utf8');
    const payload = file.endsWith('.json') ? JSON.parse(text) : text;
    const sensitiveErrors = inspectSensitiveOutput(payload, file);
    for (const error of sensitiveErrors) errors.push(error);
  }

  const expectedCatalogUrl = new URL('http://127.0.0.1:4173/?task=catalog-filter');
  assert(
    isBenchmarkAppTarget({
      type: 'page',
      title: 'GUI Agent Benchmark',
      url: 'http://127.0.0.1:4173/?task=onboarding-form'
    }, expectedCatalogUrl),
    'benchmark app target matching should accept same origin/path with a wrong task query'
  );
  assert(
    !isBenchmarkTarget({
      type: 'page',
      title: 'GUI Agent Benchmark',
      url: 'http://127.0.0.1:4173/?task=onboarding-form'
    }, expectedCatalogUrl),
    'benchmark target matching should reject a parseable wrong task URL even with the benchmark title'
  );
  assert(
    !isBenchmarkTarget({
      type: 'page',
      title: 'GUI Agent Benchmark',
      url: ''
    }, expectedCatalogUrl),
    'benchmark target matching should reject an empty URL when the expected task URL has a query'
  );
  assert(
    !isBenchmarkTarget({
      type: 'page',
      title: 'GUI Agent Benchmark',
      url: 'not a url'
    }, expectedCatalogUrl),
    'benchmark target matching should reject a malformed URL when the expected task URL has a query'
  );
  assert(
    isBenchmarkTarget({
      type: 'page',
      title: 'GUI Agent Benchmark',
      url: 'http://127.0.0.1:4173/?task=catalog-filter'
    }, expectedCatalogUrl),
    'benchmark target matching should accept the concrete expected task URL'
  );

  let fixtureTargets = [];
  let fixtureTargetLists = null;
  let fixtureListReads = 0;
  const fixtureNavigateLog = [];
  const fixtureCdpErrors = [];
  const allowedFixtureCdpMethods = new Set(['Page.navigate']);
  const fixtureServer = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/json/version') {
      response.end(JSON.stringify({ Browser: 'Chrome/125.0.0.0', 'Protocol-Version': '1.3' }));
      return;
    }
    if (request.url === '/json/list') {
      const targets = fixtureTargetLists
        ? fixtureTargetLists[Math.min(fixtureListReads, fixtureTargetLists.length - 1)]
        : fixtureTargets;
      fixtureListReads += 1;
      response.end(JSON.stringify(targets));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not found' }));
  });
  fixtureServer.on('upgrade', (request, socket) => {
    const id = request.url?.match(/\/devtools\/page\/([^/?#]+)/)?.[1];
    const key = request.headers['sec-websocket-key'];
    if (!id || typeof key !== 'string') {
      socket.destroy();
      return;
    }
    const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
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
      while (buffer.length >= 2) {
        const frame = decodeClientFrame(buffer);
        if (!frame) return;
        buffer = buffer.subarray(frame.bytes);
        if (frame.opcode === 0x8) {
          socket.end(encodeServerFrame(Buffer.alloc(0), 0x8));
          return;
        }
        if (frame.opcode !== 0x1) continue;
        const message = JSON.parse(frame.payload.toString('utf8'));
        if (!allowedFixtureCdpMethods.has(message.method)) {
          fixtureCdpErrors.push({ id, method: message.method || '' });
          socket.write(encodeServerFrame(JSON.stringify({
            id: message.id,
            error: { code: -32601, message: `Synthetic fixture rejects CDP method ${message.method || '<missing>'}` }
          })));
          continue;
        }
        if (message.method === 'Page.navigate') {
          const target = fixtureTargets.find((candidate) => candidate.id === id);
          if (target) target.url = message.params?.url || target.url;
          fixtureNavigateLog.push({ id, url: message.params?.url || '' });
        }
        socket.write(encodeServerFrame(JSON.stringify({ id: message.id, result: {} })));
      }
    });
  });
  await new Promise((resolve, reject) => {
    fixtureServer.once('error', reject);
    fixtureServer.listen(0, '127.0.0.1', resolve);
  });
  try {
    const { port } = fixtureServer.address();
    const cdpUrl = `http://127.0.0.1:${port}`;
    fixtureTargets = [
      {
        id: 'exact-task-1',
        type: 'page',
        title: 'GUI Agent Benchmark',
        url: 'http://127.0.0.1:4173/?task=catalog-filter',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/exact-task-1`
      },
      {
        id: 'exact-task-2',
        type: 'page',
        title: 'GUI Agent Benchmark',
        url: 'http://127.0.0.1:4173/?task=catalog-filter',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/exact-task-2`
      }
    ];
    fixtureTargetLists = null;
    fixtureListReads = 0;
    const multiExactDryRun = await runUitarsPreflight({
      benchmarkUrl: expectedCatalogUrl.href,
      cdpUrl
    });
    assert(multiExactDryRun.status === 'ambiguous', 'multiple exact benchmark targets should make dry-run preflight ambiguous');
    assert(/multiple benchmark page targets prevent unique real capture/i.test(multiExactDryRun.reason), 'multiple exact dry-run reason should explain unique real capture isolation/manual cleanup');
    assert(multiExactDryRun.warnings.length > 0, 'multiple exact dry-run should retain warnings');
    assert(validatePreflightReport(multiExactDryRun).length === 0, 'multiple exact dry-run report should satisfy schema validation');

    const multiExactPrepare = await prepareUitarsTarget({
      benchmarkUrl: expectedCatalogUrl.href,
      cdpUrl
    });
    assert(multiExactPrepare.status === 'ambiguous', 'multiple exact benchmark targets should make target preparation ambiguous without isolate');
    assert(validatePreflightReport(multiExactPrepare).length === 0, 'multiple exact prepare report should satisfy schema validation');

    fixtureTargets = [
      {
        id: 'search-fix-1',
        type: 'page',
        title: 'Google',
        url: 'https://www.google.com/',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/search-fix-1`
      },
      {
        id: 'search-fix-2',
        type: 'page',
        title: 'Google',
        url: 'https://www.google.com/search?q=benchmark',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/search-fix-2`
      }
    ];
    fixtureTargetLists = null;
    fixtureListReads = 0;
    const multiSearchFixAmbiguous = await runUitarsPreflight({
      benchmarkUrl: expectedCatalogUrl.href,
      cdpUrl,
      fix: true,
      confirmExplicitCdpFix: true
    });
    assert(multiSearchFixAmbiguous.status === 'ambiguous', 'preflight fix that creates multiple exact benchmark targets should be ambiguous');
    assert(validatePreflightReport(multiSearchFixAmbiguous).length === 0, 'multiple search preflight fix report should satisfy schema validation');

    fixtureTargets = [{
      id: 'wrong-task',
      type: 'page',
      title: 'GUI Agent Benchmark',
      url: 'http://127.0.0.1:4173/?task=onboarding-form',
      webSocketDebuggerUrl: 'ws://127.0.0.1:65535/devtools/page/wrong-task'
    }];
    const wrongTaskPrepare = await prepareUitarsTarget({
      benchmarkUrl: expectedCatalogUrl.href,
      cdpUrl
    });
    assert(wrongTaskPrepare.status === 'blocked', 'wrong-task benchmark app target should require explicit confirmation before navigation');
    assert(wrongTaskPrepare.actions[0]?.candidateType === 'benchmark_app_wrong_task', 'wrong-task benchmark app target should be reported as a prepare candidate');
    assert(validatePreflightReport(wrongTaskPrepare).length === 0, 'wrong-task prepare candidate report should satisfy schema validation');

    fixtureTargets = [
      {
        id: 'wrong-task-1',
        type: 'page',
        title: 'GUI Agent Benchmark',
        url: 'http://127.0.0.1:4173/?task=onboarding-form',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9/devtools/page/wrong-task-1'
      },
      {
        id: 'wrong-task-2',
        type: 'page',
        title: 'GUI Agent Benchmark',
        url: 'http://127.0.0.1:4173/?task=onboarding-form',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9/devtools/page/wrong-task-2'
      }
    ];
    const multiWrongTaskBlocked = await prepareUitarsTarget({
      benchmarkUrl: expectedCatalogUrl.href,
      cdpUrl
    });
    assert(multiWrongTaskBlocked.status === 'blocked', 'multiple wrong-task benchmark app targets should still require explicit confirmation');
    assert(multiWrongTaskBlocked.actions.length === 2, 'multiple wrong-task blocked report should include one action per candidate');
    assert(multiWrongTaskBlocked.actions.every((action) => action.candidateType === 'benchmark_app_wrong_task'), 'multiple wrong-task blocked actions should preserve candidate type');
    assert(validatePreflightReport(multiWrongTaskBlocked).length === 0, 'multiple wrong-task blocked report should satisfy schema validation');

    const multiWrongTaskConfirmed = await prepareUitarsTarget({
      benchmarkUrl: expectedCatalogUrl.href,
      cdpUrl,
      confirmExplicitCdpFix: true
    });
    assert(multiWrongTaskConfirmed.status === 'error', 'confirmed multiple wrong-task targets should attempt navigation and report safe failure with closed fixture websockets');
    assert(multiWrongTaskConfirmed.actions.length === 2, 'confirmed multiple wrong-task report should include one navigation action per candidate');
    assert(multiWrongTaskConfirmed.actions.every((action) => action.status === 'error'), 'confirmed multiple wrong-task actions should fail individually against closed fixture websockets');
    assert(validatePreflightReport(multiWrongTaskConfirmed).length === 0, 'confirmed multiple wrong-task report should satisfy schema validation');

    fixtureTargetLists = [
      [
        {
          id: 'wrong-task-converges-1',
          type: 'page',
          title: 'GUI Agent Benchmark',
          url: 'http://127.0.0.1:4173/?task=onboarding-form',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9/devtools/page/wrong-task-converges-1'
        },
        {
          id: 'wrong-task-converges-2',
          type: 'page',
          title: 'GUI Agent Benchmark',
          url: 'http://127.0.0.1:4173/?task=onboarding-form',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9/devtools/page/wrong-task-converges-2'
        }
      ],
      [
        {
          id: 'exact-task-converges-1',
          type: 'page',
          title: 'GUI Agent Benchmark',
          url: 'http://127.0.0.1:4173/?task=catalog-filter',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9/devtools/page/exact-task-converges-1'
        },
        {
          id: 'exact-task-converges-2',
          type: 'page',
          title: 'GUI Agent Benchmark',
          url: 'http://127.0.0.1:4173/?task=catalog-filter',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9/devtools/page/exact-task-converges-2'
        }
      ]
    ];
    fixtureListReads = 0;
    const multiWrongTaskConvergesAmbiguous = await prepareUitarsTarget({
      benchmarkUrl: expectedCatalogUrl.href,
      cdpUrl,
      confirmExplicitCdpFix: true
    });
    fixtureTargetLists = null;
    assert(multiWrongTaskConvergesAmbiguous.status === 'ambiguous', 'multiple wrong-task benchmark app targets that converge to multiple exact targets should be ambiguous by default');
    assert(validatePreflightReport(multiWrongTaskConvergesAmbiguous).length === 0, 'multiple wrong-task converges report should satisfy schema validation');

    fixtureTargets = [
      {
        id: 'isolate-keeper',
        type: 'page',
        title: 'GUI Agent Benchmark',
        url: 'http://127.0.0.1:4173/?task=onboarding-form',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/isolate-keeper`
      },
      {
        id: 'isolate-extra',
        type: 'page',
        title: 'GUI Agent Benchmark',
        url: 'http://127.0.0.1:4173/?task=onboarding-form',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/isolate-extra`
      }
    ];
    fixtureTargetLists = null;
    fixtureListReads = 0;
    fixtureNavigateLog.length = 0;
    const isolatedPrepare = await prepareUitarsTarget({
      benchmarkUrl: expectedCatalogUrl.href,
      cdpUrl,
      confirmExplicitCdpFix: true,
      isolateTarget: true
    });
    const isolatedExactTargets = isolatedPrepare.targetsAfter.filter((target) => target.url === expectedCatalogUrl.href);
    assert(isolatedPrepare.status === 'fixed', 'isolate target preparation should fix multiple same-app candidates to one exact target');
    assert(isolatedPrepare.actions.length === 2, 'isolate target preparation should navigate keeper and holding targets');
    assert(isolatedPrepare.actions.some((action) => action.candidateType === 'benchmark_app_keeper' && action.navigateTo === expectedCatalogUrl.href), 'isolate target preparation should record the benchmark app keeper');
    assert(isolatedPrepare.actions.some((action) => action.candidateType === 'benchmark_app_holding' && action.navigateTo === 'about:blank'), 'isolate target preparation should record benchmark app holding navigation');
    assert(fixtureNavigateLog.some((entry) => entry.id === 'isolate-extra' && entry.url === 'about:blank'), 'isolate target preparation should navigate extra same-app targets to about:blank');
    assert(isolatedExactTargets.length === 1, 'isolate target preparation should leave exactly one exact target afterward');
    assert(validatePreflightReport(isolatedPrepare).length === 0, 'isolated prepare report should satisfy schema validation');

    fixtureTargets = [
      {
        id: 'isolate-search-keeper',
        type: 'page',
        title: 'GUI Agent Benchmark',
        url: 'http://127.0.0.1:4173/?task=catalog-filter',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/isolate-search-keeper`
      },
      {
        id: 'isolate-search-extra',
        type: 'page',
        title: 'Google',
        url: 'https://www.google.com/search?q=benchmark',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/isolate-search-extra`
      }
    ];
    fixtureTargetLists = null;
    fixtureListReads = 0;
    fixtureNavigateLog.length = 0;
    const isolatedSearchPrepare = await prepareUitarsTarget({
      benchmarkUrl: expectedCatalogUrl.href,
      cdpUrl,
      confirmExplicitCdpFix: true,
      isolateTarget: true
    });
    const isolatedSearchExactTargets = isolatedSearchPrepare.targetsAfter.filter((target) => target.url === expectedCatalogUrl.href);
    assert(isolatedSearchPrepare.status === 'fixed', 'isolate target preparation should fix exact benchmark plus search extra to one exact target');
    assert(isolatedSearchPrepare.actions.some((action) => action.candidateType === 'benchmark_app_keeper' && action.navigateTo === expectedCatalogUrl.href), 'isolate search preparation should record the exact benchmark keeper');
    assert(isolatedSearchPrepare.actions.some((action) => action.candidateType === 'search_holding' && action.navigateTo === 'about:blank'), 'isolate search preparation should record search holding navigation');
    assert(fixtureNavigateLog.some((entry) => entry.id === 'isolate-search-keeper' && entry.url === expectedCatalogUrl.href), 'isolate search preparation should navigate keeper to benchmark URL');
    assert(fixtureNavigateLog.some((entry) => entry.id === 'isolate-search-extra' && entry.url === 'about:blank'), 'isolate search preparation should navigate search extra to about:blank');
    assert(isolatedSearchExactTargets.length === 1, 'isolate search preparation should leave exactly one exact target afterward');
    assert(!isolatedSearchPrepare.targetsAfter.some((target) => target.url === 'https://www.google.com/search?q=benchmark'), 'isolate search preparation should leave no search extra afterward');
    assert(validatePreflightReport(isolatedSearchPrepare).length === 0, 'isolated search prepare report should satisfy schema validation');

    fixtureTargets = [
      {
        id: 'harness-exact-1',
        type: 'page',
        title: 'GUI Agent Benchmark',
        url: 'http://127.0.0.1:4173/?task=catalog-filter',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/harness-exact-1`
      },
      {
        id: 'harness-exact-2',
        type: 'page',
        title: 'GUI Agent Benchmark',
        url: 'http://127.0.0.1:4173/?task=catalog-filter',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/harness-exact-2`
      }
    ];
    const ambiguousHarnessRoot = await mkdtemp(join(tmpdir(), 'uitars-harness-ambiguous-'));
    try {
      const ambiguousHarness = await runBenchmarkHarness({
        outputDir: ambiguousHarnessRoot,
        tasks: 'catalog-filter',
        baseUrl: 'http://127.0.0.1:4173',
        cdpUrl,
        discoverLocalUitars: false,
        prepareTarget: true,
        preflightFix: false,
        now: new Date('2026-05-21T00:00:00.000Z')
      });
      const ambiguousMetadata = await readJson(join(ambiguousHarnessRoot, 'metadata.json'));
      const ambiguousTargetPrepareReport = await readJson(join(ambiguousHarnessRoot, 'tasks', 'catalog-filter', 'target-prepare.json'));
      assert(ambiguousTargetPrepareReport.status === 'ambiguous', 'harness target preparation should record ambiguous multiple exact targets');
      assert(ambiguousMetadata.tasks[0]?.targetPrepareStatus === 'ambiguous', 'harness metadata should preserve ambiguous target preparation status');
      assert(ambiguousMetadata.tasks[0]?.status !== 'ready', 'harness metadata task status must not be ready when target preparation is ambiguous');
      assert(ambiguousHarness.tasks[0]?.status !== 'ready', 'harness result task status must not be ready when target preparation is ambiguous');
    } finally {
      await rm(ambiguousHarnessRoot, { recursive: true, force: true });
    }

    fixtureTargetLists = [
      [{
        id: 'wrong-task-visible-after-failure',
        type: 'page',
        title: 'GUI Agent Benchmark',
        url: 'http://127.0.0.1:4173/?task=onboarding-form',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9/devtools/page/wrong-task-visible-after-failure'
      }],
      [{
        id: 'exact-visible-after-failure',
        type: 'page',
        title: 'GUI Agent Benchmark',
        url: 'http://127.0.0.1:4173/?task=catalog-filter',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9/devtools/page/exact-visible-after-failure'
      }]
    ];
    fixtureListReads = 0;
    const visibleAfterFailedNavigate = await prepareUitarsTarget({
      benchmarkUrl: expectedCatalogUrl.href,
      cdpUrl,
      confirmExplicitCdpFix: true
    });
    fixtureTargetLists = null;
    assert(visibleAfterFailedNavigate.status === 'fixed', 'target visible after failed navigation response should report fixed, not error');
    assert(visibleAfterFailedNavigate.actions[0]?.status === 'error', 'target visible after failed navigation response should preserve action failure');
    assert(visibleAfterFailedNavigate.targetsAfter.some((target) => target.url === expectedCatalogUrl.href), 'target visible after failed navigation response should record exact target in targetsAfter');
    assert(!visibleAfterFailedNavigate.targetsAfter.some((target) => target.url === 'https://www.google.com/'), 'target visible after failed navigation response should have no remaining search target');
    assert(visibleAfterFailedNavigate.warnings.some((warning) => warning.includes('became visible')), 'target visible after failed navigation response should include explanatory warning');
    assert(validatePreflightReport(visibleAfterFailedNavigate).length === 0, 'visible-after-failed-navigation report should satisfy schema validation');

    fixtureTargets = [
      {
        id: 'exact-task-with-search',
        type: 'page',
        title: 'GUI Agent Benchmark',
        url: 'http://127.0.0.1:4173/?task=catalog-filter',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9/devtools/page/exact-task-with-search'
      },
      {
        id: 'search-with-exact-task',
        type: 'page',
        title: 'Google',
        url: 'https://www.google.com/',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9/devtools/page/search-with-exact-task'
      }
    ];
    const exactWithSearchBlocked = await prepareUitarsTarget({
      benchmarkUrl: expectedCatalogUrl.href,
      cdpUrl
    });
    assert(exactWithSearchBlocked.status === 'blocked', 'exact target plus search target should not report ready without navigation confirmation');
    assert(exactWithSearchBlocked.actions.length === 1, 'exact target plus search target should only plan the search target correction');
    assert(exactWithSearchBlocked.actions[0]?.candidateType === 'search', 'exact target plus search target should treat the search page as the prepare candidate');
    assert(validatePreflightReport(exactWithSearchBlocked).length === 0, 'exact plus search blocked report should satisfy schema validation');

    const exactWithSearchConfirmed = await prepareUitarsTarget({
      benchmarkUrl: expectedCatalogUrl.href,
      cdpUrl,
      confirmExplicitCdpFix: true
    });
    assert(!['fixed', 'ready'].includes(exactWithSearchConfirmed.status), 'confirmed exact plus remaining search target should not report fixed or ready');
    assert(exactWithSearchConfirmed.actions.length === 1, 'confirmed exact plus search report should include one search navigation action');
    assert(exactWithSearchConfirmed.actions[0]?.status === 'error', 'confirmed exact plus search action should fail against closed fixture websocket');
    assert(validatePreflightReport(exactWithSearchConfirmed).length === 0, 'exact plus search confirmed report should satisfy schema validation');
    const dryRunAfterExactWithSearch = await runUitarsPreflight({
      benchmarkUrl: expectedCatalogUrl.href,
      cdpUrl
    });
    assert(dryRunAfterExactWithSearch.status === 'needs_fix', 'dry-run after exact plus remaining search target should still be needs_fix');
    assert(validatePreflightReport(dryRunAfterExactWithSearch).length === 0, 'dry-run after exact plus remaining search target should satisfy schema validation');

    fixtureTargets = [
      {
        id: 'wrong-task-mixed',
        type: 'page',
        title: 'GUI Agent Benchmark',
        url: 'http://127.0.0.1:4173/?task=onboarding-form',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9/devtools/page/wrong-task-mixed'
      },
      {
        id: 'search-mixed',
        type: 'page',
        title: 'Google',
        url: 'https://www.google.com/',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9/devtools/page/search-mixed'
      }
    ];
    const mixedPrepare = await prepareUitarsTarget({
      benchmarkUrl: expectedCatalogUrl.href,
      cdpUrl,
      confirmExplicitCdpFix: true
    });
    assert(mixedPrepare.status === 'ambiguous', 'mixed wrong-task benchmark app and search candidates should remain ambiguous');
    assert(mixedPrepare.actions.length === 2, 'mixed candidate report should include each candidate');
    assert(validatePreflightReport(mixedPrepare).length === 0, 'mixed candidate report should satisfy schema validation');

    fixtureTargets = [{
      id: 'exact-task',
      type: 'page',
      title: 'GUI Agent Benchmark',
      url: 'http://127.0.0.1:4173/?task=catalog-filter',
      webSocketDebuggerUrl: 'ws://127.0.0.1:65535/devtools/page/exact-task'
    }];
    const exactPrepare = await prepareUitarsTarget({
      benchmarkUrl: expectedCatalogUrl.href,
      cdpUrl
    });
    assert(exactPrepare.status === 'ready', 'exact task target should be ready without navigation');
    assert(exactPrepare.actions.length === 0, 'exact task target should not produce navigation actions');
    assert(validatePreflightReport(exactPrepare).length === 0, 'exact target prepare report should satisfy schema validation');
    assert(
      fixtureCdpErrors.length === 0,
      `synthetic CDP fixture should only receive Page.navigate during target preparation, got ${fixtureCdpErrors.map((entry) => `${entry.id}:${entry.method}`).join(', ')}`
    );
  } finally {
    await new Promise((resolve) => fixtureServer.close(resolve));
  }

  const credentialOutputDir = join(credentialRoot, 'experiment');
  let credentialError = null;
  try {
    await runBenchmarkHarness({
      outputDir: credentialOutputDir,
      tasks: 'onboarding-form',
      baseUrl: 'http://user:pass@127.0.0.1:4173',
      now: new Date('2026-05-21T00:00:00.000Z')
    });
  } catch (error) {
    credentialError = error;
  }
  assert(credentialError, 'credentialed baseUrl should fail before writing output');
  assert(
    !String(credentialError?.message || '').includes('user:pass'),
    'credentialed baseUrl error should not echo credentials'
  );
  const credentialFiles = await collectOutputFiles(credentialOutputDir);
  for (const file of credentialFiles) {
    const text = await readFile(file, 'utf8');
    assert(!text.includes('user:pass'), `${file} should not contain credential content`);
    inspectSensitiveOutput(file.endsWith('.json') ? JSON.parse(text) : text, file)
      .forEach((error) => errors.push(error));
  }
  assert(credentialFiles.length === 0, 'credentialed baseUrl should not write task files');
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(credentialRoot, { recursive: true, force: true });
}

if (errors.length > 0) {
  console.error('Benchmark harness validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Benchmark harness validation passed with synthetic no-CDP output.');
