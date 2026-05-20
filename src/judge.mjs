import { findProductBySku, findTicketById, snapshotState } from './state.mjs';

function normalize(value) {
  return String(value ?? '').trim();
}

function makeDetail(criterion, pass, expected, actual) {
  return {
    criterion,
    pass: Boolean(pass),
    expected,
    actual
  };
}

function finalize(details, state) {
  const met = details.filter((detail) => detail.pass).length;
  const score = details.length === 0 ? 0 : Number((met / details.length).toFixed(2));

  return {
    success: details.length > 0 && met === details.length,
    score,
    details,
    state: snapshotState(state)
  };
}

function judgeOnboarding(state) {
  const notes = normalize(state.form.notes).toLowerCase();
  return finalize([
    makeDetail('form is submitted', state.form.submitted === true, true, state.form.submitted),
    makeDetail('full name is Maya Ortiz', normalize(state.form.fullName) === 'Maya Ortiz', 'Maya Ortiz', state.form.fullName),
    makeDetail('email is maya.ortiz@example.com', normalize(state.form.email).toLowerCase() === 'maya.ortiz@example.com', 'maya.ortiz@example.com', state.form.email),
    makeDetail('role is Designer', state.form.role === 'Designer', 'Designer', state.form.role),
    makeDetail('start date is 2026-06-15', state.form.startDate === '2026-06-15', '2026-06-15', state.form.startDate),
    makeDetail('notes mention Figma access', notes.includes('figma') && notes.includes('access'), 'contains Figma access', state.form.notes)
  ], state);
}

function judgeCatalog(state) {
  const product = findProductBySku(state.catalog.selectedSku);
  return finalize([
    makeDetail('selected SKU is ERGO-27', state.catalog.selectedSku === 'ERGO-27', 'ERGO-27', state.catalog.selectedSku),
    makeDetail('selected product is in stock', product?.inStock === true, true, product?.inStock ?? null),
    makeDetail('selected product category is office', product?.category === 'office', 'office', product?.category ?? null),
    makeDetail('selected product rating is at least 4.5', Number(product?.rating ?? 0) >= 4.5, '>= 4.5', product?.rating ?? null)
  ], state);
}

function judgeSettings(state) {
  return finalize([
    makeDetail('weekly email digest is enabled', state.settings.weeklyDigest === true, true, state.settings.weeklyDigest),
    makeDetail('autosave remains enabled', state.settings.autosave === true, true, state.settings.autosave),
    makeDetail('product analytics sharing is disabled', state.settings.dataSharing === false, false, state.settings.dataSharing),
    makeDetail('timezone is America/New_York', state.settings.timezone === 'America/New_York', 'America/New_York', state.settings.timezone)
  ], state);
}

function judgeTicketReview(state) {
  const ticket = findTicketById(state, 'INC-2048');
  const query = normalize(state.table.query).toLowerCase();
  return finalize([
    makeDetail('table query identifies Priya Shah or INC-2048', query.includes('priya') || query.includes('inc-2048'), 'Priya Shah or INC-2048', state.table.query),
    makeDetail('INC-2048 is selected', state.table.selectedTicketId === 'INC-2048', 'INC-2048', state.table.selectedTicketId),
    makeDetail('INC-2048 is marked reviewed', ticket?.reviewed === true, true, ticket?.reviewed ?? null)
  ], state);
}

export function evaluateTask(taskId, state, tasks = []) {
  const knownTask = tasks.length === 0 || tasks.some((task) => task.id === taskId);
  if (!knownTask) {
    return finalize([
      makeDetail('task is registered', false, 'known task id', taskId)
    ], state);
  }

  if (taskId === 'onboarding-form') return judgeOnboarding(state);
  if (taskId === 'catalog-filter') return judgeCatalog(state);
  if (taskId === 'settings-toggle') return judgeSettings(state);
  if (taskId === 'ticket-review') return judgeTicketReview(state);

  return finalize([
    makeDetail('task has judge implementation', false, 'implemented task id', taskId)
  ], state);
}

