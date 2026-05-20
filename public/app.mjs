import {
  PRODUCTS,
  createInitialState,
  snapshotState,
  visibleProducts,
  visibleTickets
} from '/src/state.mjs';
import { evaluateTask } from '/src/judge.mjs';
import {
  clearRuns as clearStoredRuns,
  exportRuns as exportStoredRuns,
  finalizeRun,
  getRun as getStoredRun,
  importRuns as importStoredRuns,
  listRuns as listStoredRuns,
  recordRunAction,
  recordRunInput,
  startRun,
  summarizeRuns
} from '/src/runs.mjs';

let tasks = [];
let activeTaskId = '';
let state = createInitialState();
let lastResult = null;
let activeRun = null;
let selectedRunId = '';
let pendingInputChanges = new Map();

const taskList = document.querySelector('#task-list');
const taskMeta = document.querySelector('#task-meta');
const taskTitle = document.querySelector('#task-title');
const taskInstruction = document.querySelector('#task-instruction');
const workspace = document.querySelector('#task-workspace');
const resultOutput = document.querySelector('#result-output');
const resetButton = document.querySelector('#reset-task');
const evaluateButton = document.querySelector('#evaluate-task');
const totalRunsMetric = document.querySelector('#metric-total-runs');
const successRateMetric = document.querySelector('#metric-success-rate');
const avgStepsMetric = document.querySelector('#metric-avg-steps');
const avgDurationMetric = document.querySelector('#metric-avg-duration');
const failureReasons = document.querySelector('#failure-reasons');
const perTaskStats = document.querySelector('#per-task-stats');
const runList = document.querySelector('#run-list');
const runReplay = document.querySelector('#run-replay');
const runJudgeDetails = document.querySelector('#run-judge-details');
const exportRunsButton = document.querySelector('#export-runs');
const importRunsButton = document.querySelector('#import-runs');
const clearRunsButton = document.querySelector('#clear-runs');
const runImportFile = document.querySelector('#run-import-file');

function currentTask() {
  return tasks.find((task) => task.id === activeTaskId) || tasks[0];
}

function ensureActiveRun() {
  const task = currentTask();
  if (!task) return null;

  if (!activeRun || activeRun.taskId !== task.id || activeRun.endedAt) {
    activeRun = startRun({
      taskId: task.id,
      taskTitle: task.title,
      state: snapshot(),
      timestamp: new Date()
    });
    selectedRunId = activeRun.id;
  }

  return activeRun;
}

function trackAction(action) {
  const run = ensureActiveRun();
  if (!run) return;
  activeRun = recordRunAction(run, action, snapshot(), { timestamp: new Date() });
  selectedRunId = activeRun.id;
  renderRuns();
}

function trackInput(path, value, label) {
  const run = ensureActiveRun();
  if (!run) return;
  activeRun = recordRunInput(run, { path, value, label }, snapshot(), { timestamp: new Date() });
  selectedRunId = activeRun.id;
  renderRuns();
}

function flushPendingInputs(path = null) {
  const entries = path === null
    ? [...pendingInputChanges.entries()]
    : pendingInputChanges.has(path) ? [[path, pendingInputChanges.get(path)]] : [];

  for (const [inputPath, value] of entries) {
    trackInput(inputPath, value);
    pendingInputChanges.delete(inputPath);
  }
}

function setNestedValue(path, value) {
  const parts = path.split('.');
  let target = state;
  for (const part of parts.slice(0, -1)) {
    target = target[part];
  }
  target[parts.at(-1)] = value;
}

function reset(taskId = activeTaskId || tasks[0]?.id, options = {}) {
  if (options.record !== false) {
    flushPendingInputs();
  }
  pendingInputChanges = new Map();
  const task = tasks.find((item) => item.id === taskId) || tasks[0];
  activeTaskId = task.id;
  state = createInitialState(activeTaskId);
  lastResult = null;
  const url = new URL(window.location.href);
  url.searchParams.set('task', activeTaskId);
  window.history.replaceState({}, '', url);
  render();
  if (options.record !== false) {
    activeRun = startRun({
      taskId: task.id,
      taskTitle: task.title,
      state: snapshot(),
      timestamp: new Date()
    });
    selectedRunId = activeRun.id;
    renderRuns();
  }
  return snapshotState(state);
}

function snapshot() {
  return snapshotState(state);
}

function evaluate(taskId = activeTaskId) {
  if (taskId !== activeTaskId) {
    throw new Error(`Cannot evaluate task ${String(taskId)} while ${activeTaskId} is active. Reset to the task before evaluating it.`);
  }

  flushPendingInputs();
  const run = ensureActiveRun();
  const result = evaluateTask(taskId, state, tasks);
  lastResult = result;
  if (run) {
    activeRun = finalizeRun(run, result, snapshot(), { timestamp: new Date() });
    selectedRunId = activeRun.id;
  }
  renderResult();
  renderRuns();
  return result;
}

function markDirty() {
  if (lastResult) {
    lastResult = null;
    renderResult();
  }
}

function listTasks() {
  return snapshotState(tasks);
}

function runs() {
  return listStoredRuns();
}

function summary() {
  return summarizeRuns(runs());
}

function getRun(id) {
  return getStoredRun(id);
}

function clearRuns() {
  clearStoredRuns();
  activeRun = null;
  selectedRunId = '';
  renderRuns();
  return [];
}

function exportRuns() {
  return exportStoredRuns();
}

function importRuns(payload) {
  const result = importStoredRuns(payload);
  activeRun = activeRun ? getStoredRun(activeRun.id) : null;
  selectedRunId = result.runs[0]?.id || '';
  renderRuns();
  return result;
}

function renderTaskList() {
  taskList.replaceChildren();

  for (const task of tasks) {
    const button = document.createElement('button');
    button.className = 'task-card';
    if (task.id === activeTaskId) button.classList.add('active');
    button.type = 'button';
    button.dataset.taskId = task.id;

    const title = document.createElement('span');
    title.textContent = task.title;
    const steps = document.createElement('small');
    steps.textContent = `${task.maxSteps} steps`;

    button.append(title, steps);
    taskList.append(button);
  }
}

function renderResult() {
  if (!lastResult) {
    resultOutput.className = 'result-output muted';
    resultOutput.textContent = 'No evaluation yet.';
    return;
  }

  const summary = lastResult.success ? 'success' : 'needs work';
  resultOutput.className = `result-output ${lastResult.success ? 'pass' : 'fail'}`;
  resultOutput.innerHTML = `
    <div class="score-line">
      <strong>${summary}</strong>
      <span>score ${lastResult.score.toFixed(2)}</span>
    </div>
    <ul>
      ${lastResult.details.map((detail) => `
        <li class="${detail.pass ? 'ok' : 'missing'}">
          <span>${escapeHtml(detail.criterion)}</span>
          <small>${detail.pass ? 'met' : `expected ${escapeHtml(detail.expected)}, got ${escapeHtml(detail.actual)}`}</small>
        </li>
      `).join('')}
    </ul>
  `;
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function formatDuration(ms) {
  if (!ms) return '0s';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

function formatTimestamp(value) {
  if (!value) return 'active';
  return new Date(value).toLocaleString();
}

function formatTraceValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function statusLabel(run) {
  if (run.success === true) return ['pass', 'success'];
  if (run.success === false) return ['fail', 'failed'];
  return ['', 'active'];
}

function renderRuns() {
  const allRuns = runs();
  if (selectedRunId && !allRuns.some((run) => run.id === selectedRunId)) {
    selectedRunId = '';
  }
  if (!selectedRunId && allRuns[0]) {
    selectedRunId = allRuns[0].id;
  }

  const summary = summarizeRuns(allRuns);
  totalRunsMetric.textContent = String(summary.totalRuns);
  successRateMetric.textContent = formatPercent(summary.successRate);
  avgStepsMetric.textContent = String(summary.avgSteps);
  avgDurationMetric.textContent = formatDuration(summary.avgDurationMs);

  failureReasons.className = `mini-list${summary.failureReasons.length === 0 ? ' muted' : ''}`;
  failureReasons.innerHTML = summary.failureReasons.length === 0
    ? 'No failed runs.'
    : summary.failureReasons.map((item) => `
      <div class="mini-row">
        <strong>${escapeHtml(item.reason)}</strong>
        <span class="run-meta">${item.count} run${item.count === 1 ? '' : 's'}</span>
      </div>
    `).join('');

  perTaskStats.className = `mini-list${summary.perTask.length === 0 ? ' muted' : ''}`;
  perTaskStats.innerHTML = summary.perTask.length === 0
    ? 'No runs recorded.'
    : summary.perTask.map((task) => `
      <div class="mini-row">
        <strong>${escapeHtml(task.taskTitle)}</strong>
        <span class="run-meta">${task.totalRuns} runs · ${formatPercent(task.successRate)} success · ${task.avgSteps} avg steps</span>
      </div>
    `).join('');

  runList.className = `run-list${allRuns.length === 0 ? ' muted' : ''}`;
  if (allRuns.length === 0) {
    runList.textContent = 'No runs recorded.';
  } else {
    runList.replaceChildren();
    for (const run of allRuns) {
      const [className, label] = statusLabel(run);
      const button = document.createElement('button');
      if (run.id === selectedRunId) button.classList.add('active');
      button.type = 'button';
      button.dataset.runId = run.id;

      const title = document.createElement('strong');
      title.textContent = run.taskTitle;
      const meta = document.createElement('span');
      meta.className = 'run-meta';
      meta.textContent = `${formatTimestamp(run.startedAt)} · ${run.steps} steps · ${formatDuration(run.durationMs)}`;
      const status = document.createElement('span');
      status.className = `run-status ${className}`;
      status.textContent = `${label}${run.score === null ? '' : ` · score ${run.score.toFixed(2)}`}`;

      button.append(title, meta, status);
      runList.append(button);
    }
  }

  renderSelectedRun(selectedRunId ? getRun(selectedRunId) : null);
}

function renderSelectedRun(run) {
  if (!run) {
    runReplay.className = 'replay-box muted';
    runReplay.textContent = 'Select a run to inspect its timeline.';
    runJudgeDetails.className = 'judge-details muted';
    runJudgeDetails.textContent = 'No finalized run selected.';
    return;
  }

  const lastState = run.stateTimeline.at(-1);
  runReplay.className = `replay-box${run.actions.length === 0 ? ' muted' : ''}`;
  runReplay.innerHTML = run.actions.length === 0
    ? 'No actions recorded.'
    : `
      ${run.actions.map((action, index) => `
        <div class="timeline-row">
          <span class="timeline-time">${index + 1}. ${formatTimestamp(action.timestamp)}</span>
          <strong>${escapeHtml(action.label)}</strong>
          <span class="run-meta">${escapeHtml(action.type)}${action.path ? ` · ${escapeHtml(action.path)}` : ''}</span>
          ${action.value === null ? '' : `<pre class="timeline-value">${escapeHtml(formatTraceValue(action.value))}</pre>`}
        </div>
      `).join('')}
      ${lastState ? `
        <details>
          <summary>Last state snapshot</summary>
          <pre class="timeline-value">${escapeHtml(formatTraceValue(lastState.state))}</pre>
        </details>
      ` : ''}
    `;

  const details = run.evaluation?.details || [];
  runJudgeDetails.className = `judge-details${details.length === 0 ? ' muted' : ''}`;
  runJudgeDetails.innerHTML = details.length === 0
    ? 'No finalized run selected.'
    : details.map((detail) => `
      <div class="judge-row">
        <strong>${escapeHtml(detail.criterion)}</strong>
        <span class="run-status ${detail.pass ? 'pass' : 'fail'}">${detail.pass ? 'met' : 'missing'}</span>
        ${detail.pass ? '' : `<span class="run-meta">expected ${escapeHtml(detail.expected)}, got ${escapeHtml(detail.actual)}</span>`}
      </div>
    `).join('');
}

function field(label, control) {
  return `<label class="field"><span>${label}</span>${control}</label>`;
}

function renderOnboarding() {
  const form = state.form;
  workspace.innerHTML = `
    <div class="panel-header">
      <h2>Onboarding Request</h2>
      <span class="status-pill ${form.submitted ? 'done' : ''}">${form.submitted ? 'Submitted' : 'Draft'}</span>
    </div>
    <form class="stack" id="onboarding-form">
      ${field('Full name', `<input data-state-path="form.fullName" value="${escapeHtml(form.fullName)}" autocomplete="off">`)}
      ${field('Work email', `<input data-state-path="form.email" value="${escapeHtml(form.email)}" autocomplete="off">`)}
      ${field('Role', `
        <select data-state-path="form.role">
          ${['', 'Designer', 'Engineer', 'Researcher', 'Manager'].map((role) => `
            <option value="${role}" ${form.role === role ? 'selected' : ''}>${role || 'Select role'}</option>
          `).join('')}
        </select>
      `)}
      ${field('Start date', `<input data-state-path="form.startDate" type="date" value="${form.startDate}">`)}
      ${field('Access notes', `<textarea data-state-path="form.notes" rows="4">${escapeHtml(form.notes)}</textarea>`)}
      <div class="action-row align-left">
        <button type="submit">Submit Request</button>
      </div>
    </form>
  `;
}

function renderCatalog() {
  const catalog = state.catalog;
  const products = visibleProducts(state);
  workspace.innerHTML = `
    <div class="panel-header">
      <h2>Procurement Catalog</h2>
      <span class="status-pill">${products.length} matches</span>
    </div>
    <div class="filters">
      ${field('Search', `<input data-state-path="catalog.search" value="${escapeHtml(catalog.search)}" autocomplete="off">`)}
      ${field('Category', `
        <select data-state-path="catalog.category">
          ${[
            ['all', 'All categories'],
            ['office', 'Office'],
            ['hardware', 'Hardware'],
            ['travel', 'Travel']
          ].map(([value, label]) => `<option value="${value}" ${catalog.category === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      `)}
      ${field('Minimum rating', `<input data-state-path="catalog.minRating" type="number" min="0" max="5" step="0.1" value="${catalog.minRating}">`)}
      <label class="check-field"><input data-state-path="catalog.inStockOnly" type="checkbox" ${catalog.inStockOnly ? 'checked' : ''}>In stock only</label>
    </div>
    <div class="product-grid">
      ${products.map((product) => `
        <article class="product-card ${catalog.selectedSku === product.sku ? 'selected' : ''}">
          <div>
            <h3>${product.name}</h3>
            <p>${product.category} · ${product.rating.toFixed(1)} stars · $${product.price}</p>
            <small>${product.sku} · ${product.inStock ? 'In stock' : 'Backorder'}</small>
          </div>
          <button type="button" data-select-sku="${product.sku}">${catalog.selectedSku === product.sku ? 'Selected' : 'Select'}</button>
        </article>
      `).join('') || '<p class="empty-state">No matching products.</p>'}
    </div>
  `;
}

function renderSettings() {
  const settings = state.settings;
  workspace.innerHTML = `
    <div class="panel-header">
      <h2>Workspace Settings</h2>
      <span class="status-pill">Admin</span>
    </div>
    <div class="settings-list">
      <label class="switch-row">
        <span><strong>Weekly email digest</strong><small>Send a summary every Monday.</small></span>
        <input data-state-path="settings.weeklyDigest" type="checkbox" ${settings.weeklyDigest ? 'checked' : ''}>
      </label>
      <label class="switch-row">
        <span><strong>Autosave workspace</strong><small>Keep local task changes after each edit.</small></span>
        <input data-state-path="settings.autosave" type="checkbox" ${settings.autosave ? 'checked' : ''}>
      </label>
      <label class="switch-row">
        <span><strong>Product analytics sharing</strong><small>Allow anonymized usage data.</small></span>
        <input data-state-path="settings.dataSharing" type="checkbox" ${settings.dataSharing ? 'checked' : ''}>
      </label>
      ${field('Timezone', `
        <select data-state-path="settings.timezone">
          ${['UTC', 'America/New_York', 'America/Los_Angeles', 'Asia/Shanghai', 'Europe/London'].map((zone) => `
            <option value="${zone}" ${settings.timezone === zone ? 'selected' : ''}>${zone}</option>
          `).join('')}
        </select>
      `)}
    </div>
  `;
}

function renderTickets() {
  const tickets = visibleTickets(state);
  workspace.innerHTML = `
    <div class="panel-header">
      <h2>Support Review Queue</h2>
      <span class="status-pill">${tickets.length} visible</span>
    </div>
    <div class="filters single">
      ${field('Find ticket', `<input data-state-path="table.query" value="${escapeHtml(state.table.query)}" autocomplete="off">`)}
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Ticket</th>
            <th>Requester</th>
            <th>Priority</th>
            <th>Topic</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${tickets.map((ticket) => `
            <tr class="${state.table.selectedTicketId === ticket.id ? 'selected-row' : ''}">
              <td>${ticket.id}</td>
              <td>${ticket.requester}</td>
              <td>${ticket.priority}</td>
              <td>${ticket.topic}</td>
              <td>${ticket.reviewed ? 'Reviewed' : ticket.status}</td>
              <td><button type="button" data-review-ticket="${ticket.id}">${ticket.reviewed ? 'Reviewed' : 'Mark reviewed'}</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderWorkspace() {
  if (activeTaskId === 'onboarding-form') {
    renderOnboarding();
  } else if (activeTaskId === 'catalog-filter') {
    renderCatalog();
  } else if (activeTaskId === 'settings-toggle') {
    renderSettings();
  } else if (activeTaskId === 'ticket-review') {
    renderTickets();
  }
}

function render() {
  const task = currentTask();
  taskMeta.textContent = `Task ${tasks.findIndex((item) => item.id === task.id) + 1} · max ${task.maxSteps} steps`;
  taskTitle.textContent = task.title;
  taskInstruction.textContent = task.instruction;
  renderTaskList();
  renderWorkspace();
  renderResult();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

taskList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-task-id]');
  if (!button) return;
  reset(button.dataset.taskId);
});

workspace.addEventListener('input', (event) => {
  const target = event.target.closest('[data-state-path]');
  if (!target) return;
  const value = target.type === 'checkbox' ? target.checked : target.type === 'number' ? Number(target.value) : target.value;
  setNestedValue(target.dataset.statePath, value);
  pendingInputChanges.set(target.dataset.statePath, value);
  markDirty();
});

workspace.addEventListener('change', (event) => {
  const target = event.target.closest('[data-state-path]');
  if (!target) return;
  const value = target.type === 'checkbox' ? target.checked : target.type === 'number' ? Number(target.value) : target.value;
  setNestedValue(target.dataset.statePath, value);
  pendingInputChanges.set(target.dataset.statePath, value);
  markDirty();
  renderWorkspace();
  flushPendingInputs(target.dataset.statePath);
});

workspace.addEventListener('click', (event) => {
  flushPendingInputs();
  const skuButton = event.target.closest('[data-select-sku]');
  if (skuButton) {
    state.catalog.selectedSku = skuButton.dataset.selectSku;
    markDirty();
    renderWorkspace();
    trackAction({
      type: 'select_click',
      label: `Selected SKU ${skuButton.dataset.selectSku}`,
      target: 'catalog.selectedSku',
      value: skuButton.dataset.selectSku
    });
    return;
  }

  const ticketButton = event.target.closest('[data-review-ticket]');
  if (ticketButton) {
    const ticket = state.tickets.find((item) => item.id === ticketButton.dataset.reviewTicket);
    if (ticket) {
      ticket.reviewed = true;
      state.table.selectedTicketId = ticket.id;
      markDirty();
      renderWorkspace();
      trackAction({
        type: 'select_click',
        label: `Marked ${ticket.id} reviewed`,
        target: 'table.selectedTicketId',
        value: ticket.id
      });
    }
  }
});

workspace.addEventListener('submit', (event) => {
  if (event.target.id === 'onboarding-form') {
    event.preventDefault();
    flushPendingInputs();
    state.form.submitted = true;
    markDirty();
    renderWorkspace();
    trackAction({
      type: 'submit',
      label: 'Submitted onboarding request',
      target: '#onboarding-form',
      value: true
    });
  }
});

resetButton.addEventListener('click', () => reset(activeTaskId));
evaluateButton.addEventListener('click', () => evaluate(activeTaskId));
runList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-run-id]');
  if (!button) return;
  selectedRunId = button.dataset.runId;
  renderRuns();
});

exportRunsButton.addEventListener('click', () => {
  const blobUrl = URL.createObjectURL(new Blob([exportRuns()], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = `gui-agent-runs-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(blobUrl);
});

importRunsButton.addEventListener('click', () => {
  runImportFile.click();
});

runImportFile.addEventListener('change', async () => {
  const file = runImportFile.files[0];
  if (!file) return;
  try {
    importRuns(await file.text());
  } catch (error) {
    window.alert(error.message);
  } finally {
    runImportFile.value = '';
  }
});

clearRunsButton.addEventListener('click', () => {
  if (window.confirm('Clear all recorded runs?')) {
    clearRuns();
  }
});

window.__BENCH__ = {
  reset,
  snapshot,
  evaluate,
  listTasks,
  runs,
  summary,
  getRun,
  clearRuns,
  exportRuns,
  importRuns
};

const response = await fetch('/tasks.json', { cache: 'no-store' });
tasks = await response.json();
const requestedTask = new URL(window.location.href).searchParams.get('task');
reset(tasks.some((task) => task.id === requestedTask) ? requestedTask : tasks[0].id);

console.debug('Loaded benchmark products', PRODUCTS.length);
