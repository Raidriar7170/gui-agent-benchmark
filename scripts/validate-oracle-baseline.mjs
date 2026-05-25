#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateRun } from '../src/runs.mjs';
import {
  oracleScenarios,
  summarizeOracleResults,
  validateOracleScenarios
} from '../src/oracle-baseline.mjs';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

const tasks = JSON.parse(await readFile(new URL('../public/tasks.json', import.meta.url), 'utf8'));
const errors = validateOracleScenarios(tasks, oracleScenarios);

if (errors.length > 0) {
  throw new Error(`Oracle baseline validation failed: ${errors.join('; ')}`);
}

const uiPathResults = await runOracleScenariosThroughApp(tasks, oracleScenarios);
if (uiPathResults.length !== tasks.length) {
  throw new Error(`Oracle baseline must execute ${tasks.length} UI-path results; received ${uiPathResults.length}.`);
}

const summary = summarizeOracleResults(uiPathResults);
if (summary.successfulTasks !== summary.totalTasks || summary.averageScore !== 1) {
  const failed = summary.results
    .filter((result) => result.success !== true || result.score !== 1)
    .map((result) => `${result.taskId} score=${result.score}`)
    .join(', ');
  throw new Error(`Oracle baseline expected all tasks to pass with score 1. Failed: ${failed}`);
}

console.log(`Oracle baseline validation passed: ${uiPathResults.length}/${tasks.length} tasks succeeded through scripted UI actions.`);

async function runOracleScenariosThroughApp(taskList, scenarios) {
  const harness = installBrowserHarness();
  try {
    await importBenchmarkApp();
    const bench = globalThis.window.__BENCH__;
    if (!bench || typeof bench.reset !== 'function' || typeof bench.evaluate !== 'function') {
      throw new Error('window.__BENCH__.reset/evaluate are not available.');
    }

    bench.clearRuns();
    const results = [];
    for (const scenario of scenarios) {
      bench.reset(scenario.taskId, { record: false });
      for (const action of scenario.actions) {
        dispatchOracleAction(harness.workspace, action);
      }

      const evaluation = bench.evaluate(scenario.taskId);
      results.push({
        taskId: scenario.taskId,
        success: evaluation.success,
        score: evaluation.score,
        failedCriteria: evaluation.details
          .filter((detail) => detail.pass !== true)
          .map((detail) => detail.criterion),
        steps: scenario.actions.length
      });
    }

    const exported = JSON.parse(bench.exportRuns());
    if (!Array.isArray(exported.runs) || exported.runs.length !== taskList.length) {
      throw new Error(`Oracle baseline expected ${taskList.length} exported runs; received ${exported.runs?.length ?? 0}.`);
    }

    const runErrors = exported.runs.flatMap((run, index) => (
      validateRun(run).map((error) => `runs[${index}]: ${error}`)
    ));
    if (runErrors.length > 0) {
      throw new Error(`Oracle baseline exported invalid runs: ${runErrors.join('; ')}`);
    }

    return results;
  } finally {
    harness.restore();
  }
}

async function importBenchmarkApp() {
  let source = await readFile(join(rootDir, 'public/app.mjs'), 'utf8');
  const originalDebug = console.debug;
  const moduleUrls = new Map([
    ['/src/state.mjs', pathToFileURL(join(rootDir, 'src/state.mjs')).href],
    ['/src/judge.mjs', pathToFileURL(join(rootDir, 'src/judge.mjs')).href],
    ['/src/runs.mjs', pathToFileURL(join(rootDir, 'src/runs.mjs')).href],
    ['/src/trace-importer.mjs', pathToFileURL(join(rootDir, 'src/trace-importer.mjs')).href]
  ]);

  for (const [specifier, moduleUrl] of moduleUrls) {
    source = source.replaceAll(`'${specifier}'`, `'${moduleUrl}'`);
  }

  const encoded = Buffer.from(source).toString('base64');
  try {
    console.debug = () => {};
    await import(`data:text/javascript;base64,${encoded}#oracle-baseline-${Date.now()}`);
  } finally {
    console.debug = originalDebug;
  }
}

function installBrowserHarness() {
  const previous = {
    document: globalThis.document,
    fetch: globalThis.fetch,
    localStorage: globalThis.localStorage,
    window: globalThis.window
  };
  const elements = new Map();
  const workspace = createElementStub('#task-workspace');
  elements.set('#task-workspace', workspace);
  const windowStub = {
    alert() {},
    confirm() {
      return true;
    },
    location: { href: 'http://127.0.0.1:4173/' },
    history: {
      replaceState(_state, _title, url) {
        windowStub.location.href = String(url);
      }
    }
  };

  globalThis.document = {
    createElement(tagName = 'div') {
      const element = createElementStub(String(tagName).toLowerCase());
      element.tagName = String(tagName).toUpperCase();
      return element;
    },
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, createElementStub(selector));
      return elements.get(selector);
    }
  };
  globalThis.localStorage = createMemoryStorage();
  globalThis.window = windowStub;
  globalThis.window.localStorage = globalThis.localStorage;
  globalThis.fetch = async (input) => {
    if (String(input) === '/tasks.json') {
      return new Response(await readFile(join(rootDir, 'public/tasks.json'), 'utf8'), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    }
    throw new Error(`Unexpected oracle baseline fetch: ${String(input)}`);
  };

  return {
    workspace,
    restore() {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete globalThis[key];
        } else {
          globalThis[key] = value;
        }
      }
    }
  };
}

function createElementStub(selector = '') {
  const listeners = new Map();
  return {
    children: [],
    className: '',
    dataset: {},
    files: [],
    id: selector.startsWith('#') ? selector.slice(1) : '',
    innerHTML: '',
    textContent: '',
    type: '',
    value: '',
    checked: false,
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    addEventListener(type, listener) {
      const handlers = listeners.get(type) || [];
      handlers.push(listener);
      listeners.set(type, handlers);
    },
    append(...children) {
      this.children.push(...children);
    },
    click() {},
    dispatch(type, event) {
      for (const listener of listeners.get(type) || []) {
        listener(event);
      }
    },
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

function dispatchOracleAction(workspace, action) {
  assertSelectorRendered(workspace, action.selector);
  const target = createActionTarget(action);
  const event = {
    target,
    preventDefault() {}
  };

  if (action.type === 'submit') {
    workspace.dispatch('submit', event);
    return;
  }

  workspace.dispatch(action.type, event);
}

function createActionTarget(action) {
  const dataset = datasetFromSelector(action.selector);
  const inputType = action.inputType || (typeof action.value === 'boolean' ? 'checkbox' : typeof action.value === 'number' ? 'number' : 'text');
  const id = action.selector.startsWith('#') ? action.selector.slice(1) : '';
  return {
    dataset,
    id,
    type: inputType,
    value: action.value,
    checked: Boolean(action.value),
    closest(selector) {
      return targetMatchesSelector({ dataset, id, selector: action.selector }, selector) ? this : null;
    }
  };
}

function datasetFromSelector(selector) {
  const dataset = {};
  const matches = selector.matchAll(/\[data-([a-z0-9-]+)(?:="([^"]*)")?\]/gi);
  for (const match of matches) {
    dataset[dataAttributeToDatasetKey(match[1])] = match[2] ?? '';
  }
  return dataset;
}

function targetMatchesSelector(target, requestedSelector) {
  if (requestedSelector === target.selector) return true;
  if (requestedSelector.startsWith('#')) return target.id === requestedSelector.slice(1);

  const match = requestedSelector.match(/^\[data-([a-z0-9-]+)(?:="([^"]*)")?\]$/i);
  if (!match) return false;
  const key = dataAttributeToDatasetKey(match[1]);
  if (!(key in target.dataset)) return false;
  return match[2] === undefined || target.dataset[key] === match[2];
}

function dataAttributeToDatasetKey(attribute) {
  return attribute.replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
}

function assertSelectorRendered(workspace, selector) {
  const html = workspace.innerHTML;
  if (selector.startsWith('#')) {
    const id = selector.slice(1);
    if (html.includes(`id="${id}"`) || html.includes(`id='${id}'`)) return;
  }

  const match = selector.match(/^\[([a-z0-9-]+)(?:="([^"]*)")?\]$/i);
  if (match) {
    const [, attribute, value] = match;
    if (value === undefined && html.includes(attribute)) return;
    if (value !== undefined && (
      html.includes(`${attribute}="${value}"`) || html.includes(`${attribute}='${value}'`)
    )) {
      return;
    }
  }

  throw new Error(`Oracle action selector is not rendered for current task: ${selector}`);
}
