#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const timeoutMs = 5000;

function waitForServerUrl(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      finish(reject, new Error(`Server did not report a URL within ${timeoutMs}ms.${stderr ? ` stderr: ${stderr.trim()}` : ''}`));
    }, timeoutMs);

    function finish(callback, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    }

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      const match = stdout.match(/listening on (http:\/\/\S+)/);
      if (match) {
        finish(resolve, new URL(match[1]));
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      finish(reject, error);
    });

    child.on('exit', (code) => {
      finish(reject, new Error(`Server exited before ready with code ${code}.${stderr ? ` stderr: ${stderr.trim()}` : ''}`));
    });
  });
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timeout);
  }
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
      resolve();
    }, 1000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function createElementStub() {
  return {
    children: [],
    className: '',
    dataset: {},
    files: [],
    type: '',
    value: '',
    checked: false,
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    addEventListener() {},
    append(...children) {
      this.children.push(...children);
    },
    click() {},
    replaceChildren(...children) {
      this.children = children;
      this.textContent = '';
      this.innerHTML = '';
    }
  };
}

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

function installBrowserHarness(baseUrl) {
  const previous = {
    document: globalThis.document,
    fetch: globalThis.fetch,
    localStorage: globalThis.localStorage,
    window: globalThis.window
  };
  const elements = new Map();
  const windowStub = {
    alert() {},
    confirm() {
      return true;
    },
    location: { href: `${baseUrl}/` }
  };
  windowStub.history = {
    replaceState(_state, _title, url) {
      windowStub.location.href = String(url);
    }
  };

  globalThis.document = {
    createElement: createElementStub,
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, createElementStub());
      return elements.get(selector);
    }
  };
  globalThis.localStorage = createMemoryStorage();
  globalThis.window = windowStub;
  globalThis.window.localStorage = globalThis.localStorage;
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' && input.startsWith('/') ? `${baseUrl}${input}` : input;
    return previous.fetch(url, init);
  };

  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete globalThis[key];
      } else {
        globalThis[key] = value;
      }
    }
  };
}

async function assertBenchEvaluateRejectsInactiveTask(baseUrl) {
  const restore = installBrowserHarness(baseUrl);
  try {
    let source = await readFile(join(rootDir, 'public/app.mjs'), 'utf8');
    const moduleUrls = new Map([
      ['/src/state.mjs', pathToFileURL(join(rootDir, 'src/state.mjs')).href],
      ['/src/judge.mjs', pathToFileURL(join(rootDir, 'src/judge.mjs')).href],
      ['/src/runs.mjs', pathToFileURL(join(rootDir, 'src/runs.mjs')).href],
      ['/src/trace-importer.mjs', pathToFileURL(join(rootDir, 'src/trace-importer.mjs')).href]
    ]);
    for (const [specifier, moduleUrl] of moduleUrls) {
      source = source.replaceAll(`'${specifier}'`, `'${moduleUrl}'`);
    }

    await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

    const bench = globalThis.window.__BENCH__;
    const tasks = bench?.listTasks?.() || [];
    const activeTaskId = tasks[0]?.id;
    const inactiveTaskId = tasks.find((task) => task.id !== activeTaskId)?.id;
    if (!bench?.evaluate || !activeTaskId || !inactiveTaskId) {
      throw new Error('window.__BENCH__ did not expose enough tasks to test inactive evaluation.');
    }

    bench.reset(activeTaskId, { record: false });
    try {
      bench.evaluate(inactiveTaskId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes(`Cannot evaluate task ${inactiveTaskId} while ${activeTaskId} is active`)) {
        return;
      }
      throw new Error(`window.__BENCH__.evaluate rejected with an unexpected error: ${message}`);
    }

    throw new Error('window.__BENCH__.evaluate allowed an inactive task id.');
  } finally {
    restore();
  }
}

const child = spawn(process.execPath, ['server.mjs', '--host', '127.0.0.1', '--port', '0'], {
  cwd: rootDir,
  stdio: ['ignore', 'pipe', 'pipe']
});

try {
  const serverUrl = await waitForServerUrl(child);
  const baseUrl = serverUrl.href.replace(/\/$/, '');

  const index = await fetchText(`${baseUrl}/`);
  if (!index.response.ok) {
    throw new Error(`GET / returned HTTP ${index.response.status}`);
  }
  if (!index.text.includes('<title>GUI Agent Benchmark</title>') || !index.text.includes('id="task-list"')) {
    throw new Error('GET / did not return the benchmark app shell.');
  }
  for (const marker of ['id="runs-panel"', 'id="run-list"', 'id="export-runs"', 'id="run-judge-details"']) {
    if (!index.text.includes(marker)) {
      throw new Error(`GET / did not include expected runs UI marker ${marker}.`);
    }
  }
  if (!index.text.includes('.jsonl')) {
    throw new Error('GET / did not include JSONL import file marker.');
  }

  const runsModule = await fetchText(`${baseUrl}/src/runs.mjs`);
  if (!runsModule.response.ok) {
    throw new Error(`GET /src/runs.mjs returned HTTP ${runsModule.response.status}`);
  }
  for (const marker of ['export function summarizeRuns', 'export function importRuns', 'RUNS_STORAGE_KEY']) {
    if (!runsModule.text.includes(marker)) {
      throw new Error(`GET /src/runs.mjs did not include expected recorder API marker ${marker}.`);
    }
  }

  const traceImporterModule = await fetchText(`${baseUrl}/src/trace-importer.mjs`);
  if (!traceImporterModule.response.ok) {
    throw new Error(`GET /src/trace-importer.mjs returned HTTP ${traceImporterModule.response.status}`);
  }
  for (const marker of ['export function importExternalRuns', 'export function parseTraceImportPayload', 'export function traceToRun']) {
    if (!traceImporterModule.text.includes(marker)) {
      throw new Error(`GET /src/trace-importer.mjs did not include expected trace importer marker ${marker}.`);
    }
  }

  const tasks = await fetchText(`${baseUrl}/tasks.json`);
  if (!tasks.response.ok) {
    throw new Error(`GET /tasks.json returned HTTP ${tasks.response.status}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(tasks.text);
  } catch {
    throw new Error('GET /tasks.json did not return valid JSON.');
  }

  const taskIds = new Set(Array.isArray(parsed) ? parsed.map((task) => task.id) : []);
  for (const id of ['onboarding-form', 'catalog-filter', 'settings-toggle', 'ticket-review']) {
    if (!taskIds.has(id)) {
      throw new Error(`GET /tasks.json did not include expected task ${id}.`);
    }
  }

  await assertBenchEvaluateRejectsInactiveTask(baseUrl);

  console.log(`Smoke check passed at ${baseUrl}.`);
} catch (error) {
  console.error('Smoke check failed.');
  console.error(`- ${error.message}`);
  process.exitCode = 1;
} finally {
  await stopServer(child);
}
