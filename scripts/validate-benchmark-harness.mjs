#!/usr/bin/env node
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryStorage, listRuns, validateRun } from '../src/runs.mjs';
import { runBenchmarkHarness, inspectSensitiveOutput } from '../src/benchmark-harness.mjs';
import { importExternalRuns, tracesToRuns } from '../src/trace-importer.mjs';
import { loadTasks } from '../src/task-registry.mjs';
import { isBenchmarkTarget, validatePreflightReport } from '../src/uitars-preflight.mjs';

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
    preflightFix: false,
    now: new Date('2026-05-21T00:00:00.000Z')
  });

  assert(result.outputDir === root, 'harness should report the requested output directory');
  assert(result.totalTasks === 1, 'harness should generate one selected task');
  assert(result.blockedTasks === 1, 'no-CDP validation should record the task as blocked');

  const taskDir = join(root, 'tasks', 'onboarding-form');
  const metadata = await readJson(join(root, 'metadata.json'));
  const dryRunReport = await readJson(join(taskDir, 'preflight-dry-run.json'));
  const trace = await readJson(join(taskDir, 'trace.json'));
  const runExport = await readJson(join(taskDir, 'run-export.json'));
  const prompt = await readFile(join(taskDir, 'prompt.txt'), 'utf8');

  assert(metadata.tasks[0]?.status === 'blocked', 'metadata should record blocked task status');
  assert(prompt.includes('Maya Ortiz'), 'prompt should contain the task instruction');
  assert(dryRunReport.status === 'blocked', 'dry-run preflight should be blocked without CDP');
  assert(validatePreflightReport(dryRunReport).length === 0, 'dry-run preflight report should satisfy schema validation');

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
