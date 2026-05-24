import {
  findInventoryBySku,
  findInvoiceById,
  findProductBySku,
  findTicketById,
  snapshotState
} from './state.mjs';

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

function judgeModalConfirmation(state) {
  return finalize([
    makeDetail('request REQ-77 is selected', state.modal.selectedRequestId === 'REQ-77', 'REQ-77', state.modal.selectedRequestId),
    makeDetail('confirmation dialog was opened', state.modal.dialogOpened === true, true, state.modal.dialogOpened),
    makeDetail('request is confirmed', state.modal.confirmed === true, true, state.modal.confirmed)
  ], state);
}

function judgePaginationReview(state) {
  const invoice = findInvoiceById('INV-203');
  return finalize([
    makeDetail('pagination is on page 2', Number(state.pagination.page) === 2, 2, state.pagination.page),
    makeDetail('invoice INV-203 exists', invoice?.id === 'INV-203', 'INV-203', invoice?.id ?? null),
    makeDetail('invoice INV-203 is reviewed', state.pagination.reviewedIds.includes('INV-203'), true, state.pagination.reviewedIds.includes('INV-203'))
  ], state);
}

function judgeSortableInventory(state) {
  const item = findInventoryBySku(state.inventory.selectedSku);
  return finalize([
    makeDetail('inventory is sorted by risk', state.inventory.sortKey === 'risk', 'risk', state.inventory.sortKey),
    makeDetail('risk sort is descending', state.inventory.sortDirection === 'desc', 'desc', state.inventory.sortDirection),
    makeDetail('selected SKU is BATT-88', state.inventory.selectedSku === 'BATT-88', 'BATT-88', state.inventory.selectedSku),
    makeDetail('selected item has risk 9', item?.risk === 9, 9, item?.risk ?? null)
  ], state);
}

function judgeMultiSelectApprovals(state) {
  const selected = new Set(state.approvals.selectedIds);
  return finalize([
    makeDetail('APR-102 is selected', selected.has('APR-102'), true, selected.has('APR-102')),
    makeDetail('APR-205 is selected', selected.has('APR-205'), true, selected.has('APR-205')),
    makeDetail('only requested approvals are selected', selected.size === 2, ['APR-102', 'APR-205'], state.approvals.selectedIds),
    makeDetail('approvals are submitted', state.approvals.submitted === true, true, state.approvals.submitted)
  ], state);
}

function judgeValidationRecovery(state) {
  return finalize([
    makeDetail('validation error was shown before successful submit', state.validation.errorShown === true, true, state.validation.errorShown),
    makeDetail('title is Quarterly access review', normalize(state.validation.title) === 'Quarterly access review', 'Quarterly access review', state.validation.title),
    makeDetail('owner is Morgan Lee', normalize(state.validation.owner) === 'Morgan Lee', 'Morgan Lee', state.validation.owner),
    makeDetail('due date is 2026-06-30', state.validation.dueDate === '2026-06-30', '2026-06-30', state.validation.dueDate),
    makeDetail('validation form is submitted', state.validation.submitted === true, true, state.validation.submitted)
  ], state);
}

function judgeFileUploadRequest(state) {
  return finalize([
    makeDetail('security-audit.pdf is attached', state.upload.selectedFile === 'security-audit.pdf', 'security-audit.pdf', state.upload.selectedFile),
    makeDetail('category is Compliance', state.upload.category === 'Compliance', 'Compliance', state.upload.category),
    makeDetail('description mentions Q2 security audit evidence', normalize(state.upload.description).toLowerCase().includes('q2 security audit evidence'), 'contains Q2 security audit evidence', state.upload.description),
    makeDetail('upload request is submitted', state.upload.submitted === true, true, state.upload.submitted)
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
  if (taskId === 'modal-confirmation') return judgeModalConfirmation(state);
  if (taskId === 'pagination-review') return judgePaginationReview(state);
  if (taskId === 'sortable-inventory') return judgeSortableInventory(state);
  if (taskId === 'multi-select-approvals') return judgeMultiSelectApprovals(state);
  if (taskId === 'validation-error-recovery') return judgeValidationRecovery(state);
  if (taskId === 'file-upload-request') return judgeFileUploadRequest(state);

  return finalize([
    makeDetail('task has judge implementation', false, 'implemented task id', taskId)
  ], state);
}
