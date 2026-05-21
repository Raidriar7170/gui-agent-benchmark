#!/usr/bin/env node
import { createServer } from 'node:http';
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
  await new Promise((resolve, reject) => {
    fixtureServer.once('error', reject);
    fixtureServer.listen(0, '127.0.0.1', resolve);
  });
  try {
    const { port } = fixtureServer.address();
    const cdpUrl = `http://127.0.0.1:${port}`;
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
