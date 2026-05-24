#!/usr/bin/env node
import { evaluateTask } from '../src/judge.mjs';
import { createInitialState } from '../src/state.mjs';
import { loadTasks, validateTasks } from '../src/task-registry.mjs';

function makePassingState(taskId) {
  const state = createInitialState(taskId);

  if (taskId === 'onboarding-form') {
    state.form.fullName = 'Maya Ortiz';
    state.form.email = 'maya.ortiz@example.com';
    state.form.role = 'Designer';
    state.form.startDate = '2026-06-15';
    state.form.notes = 'Needs Figma access';
    state.form.submitted = true;
  } else if (taskId === 'catalog-filter') {
    state.catalog.search = 'laptop stand';
    state.catalog.category = 'office';
    state.catalog.minRating = 4.5;
    state.catalog.inStockOnly = true;
    state.catalog.selectedSku = 'ERGO-27';
  } else if (taskId === 'settings-toggle') {
    state.settings.weeklyDigest = true;
    state.settings.autosave = true;
    state.settings.dataSharing = false;
    state.settings.timezone = 'America/New_York';
  } else if (taskId === 'ticket-review') {
    state.table.query = 'Priya Shah';
    state.table.selectedTicketId = 'INC-2048';
    state.tickets.find((ticket) => ticket.id === 'INC-2048').reviewed = true;
  } else if (taskId === 'modal-confirmation') {
    state.modal.selectedRequestId = 'REQ-77';
    state.modal.dialogOpened = true;
    state.modal.confirmed = true;
  } else if (taskId === 'pagination-review') {
    state.pagination.page = 2;
    state.pagination.reviewedIds.push('INV-203');
  } else if (taskId === 'sortable-inventory') {
    state.inventory.sortKey = 'risk';
    state.inventory.sortDirection = 'desc';
    state.inventory.selectedSku = 'BATT-88';
  } else if (taskId === 'multi-select-approvals') {
    state.approvals.selectedIds = ['APR-102', 'APR-205'];
    state.approvals.submitted = true;
  } else if (taskId === 'validation-error-recovery') {
    state.validation.errorShown = true;
    state.validation.title = 'Quarterly access review';
    state.validation.owner = 'Morgan Lee';
    state.validation.dueDate = '2026-06-30';
    state.validation.submitted = true;
  } else if (taskId === 'file-upload-request') {
    state.upload.selectedFile = 'security-audit.pdf';
    state.upload.category = 'Compliance';
    state.upload.description = 'Q2 security audit evidence';
    state.upload.submitted = true;
  }

  return state;
}

const tasks = await loadTasks();
const errors = validateTasks(tasks);

if (tasks.length !== 10) {
  errors.push(`expected 10 benchmark tasks, found ${tasks.length}`);
}

for (const task of tasks) {
  const initialResult = evaluateTask(task.id, createInitialState(task.id), tasks);
  if (initialResult.success) {
    errors.push(`${task.id} unexpectedly passes from initial state`);
  }

  const passingResult = evaluateTask(task.id, makePassingState(task.id), tasks);
  if (!passingResult.success || passingResult.score !== 1) {
    errors.push(`${task.id} does not pass with expected completion state`);
  }
}

if (errors.length > 0) {
  console.error('Task validation failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Task validation passed: ${tasks.length} tasks, ${tasks.reduce((sum, task) => sum + task.successCriteria.length, 0)} criteria.`);
