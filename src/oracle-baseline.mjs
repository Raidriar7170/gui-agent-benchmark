export const ORACLE_BASELINE_SCHEMA_VERSION = 1;

const supportedActionTypes = new Set(['input', 'change', 'click', 'submit']);

export const oracleScenarios = [
  {
    taskId: 'onboarding-form',
    actions: [
      input('[data-state-path="form.fullName"]', 'form.fullName', 'Maya Ortiz'),
      input('[data-state-path="form.email"]', 'form.email', 'maya.ortiz@example.com'),
      change('[data-state-path="form.role"]', 'form.role', 'Designer'),
      input('[data-state-path="form.startDate"]', 'form.startDate', '2026-06-15'),
      input('[data-state-path="form.notes"]', 'form.notes', 'Needs Figma access for design onboarding.'),
      submit('#onboarding-form')
    ]
  },
  {
    taskId: 'catalog-filter',
    actions: [
      input('[data-state-path="catalog.search"]', 'catalog.search', 'Laptop Stand'),
      change('[data-state-path="catalog.category"]', 'catalog.category', 'office'),
      input('[data-state-path="catalog.minRating"]', 'catalog.minRating', 4.5, { inputType: 'number' }),
      change('[data-state-path="catalog.inStockOnly"]', 'catalog.inStockOnly', true, { inputType: 'checkbox' }),
      click('[data-select-sku="ERGO-27"]')
    ]
  },
  {
    taskId: 'settings-toggle',
    actions: [
      change('[data-state-path="settings.weeklyDigest"]', 'settings.weeklyDigest', true, { inputType: 'checkbox' }),
      change('[data-state-path="settings.dataSharing"]', 'settings.dataSharing', false, { inputType: 'checkbox' }),
      change('[data-state-path="settings.timezone"]', 'settings.timezone', 'America/New_York')
    ]
  },
  {
    taskId: 'ticket-review',
    actions: [
      input('[data-state-path="table.query"]', 'table.query', 'Priya Shah'),
      click('[data-review-ticket="INC-2048"]')
    ]
  },
  {
    taskId: 'modal-confirmation',
    actions: [
      click('[data-open-confirm-request="REQ-77"]'),
      click('[data-confirm-request]')
    ]
  },
  {
    taskId: 'pagination-review',
    actions: [
      click('[data-page-delta="1"]'),
      click('[data-review-invoice="INV-203"]')
    ]
  },
  {
    taskId: 'sortable-inventory',
    actions: [
      click('[data-sort-inventory-risk]'),
      click('[data-select-inventory="BATT-88"]')
    ]
  },
  {
    taskId: 'multi-select-approvals',
    actions: [
      change('[data-approval-id="APR-102"]', 'approvals.selectedIds', true, { inputType: 'checkbox' }),
      change('[data-approval-id="APR-205"]', 'approvals.selectedIds', true, { inputType: 'checkbox' }),
      click('[data-submit-approvals]')
    ]
  },
  {
    taskId: 'validation-error-recovery',
    actions: [
      submit('#validation-form'),
      input('[data-state-path="validation.title"]', 'validation.title', 'Quarterly access review'),
      input('[data-state-path="validation.owner"]', 'validation.owner', 'Morgan Lee'),
      input('[data-state-path="validation.dueDate"]', 'validation.dueDate', '2026-06-30'),
      submit('#validation-form')
    ]
  },
  {
    taskId: 'file-upload-request',
    actions: [
      click('[data-upload-file="security-audit.pdf"]'),
      change('[data-state-path="upload.category"]', 'upload.category', 'Compliance'),
      input('[data-state-path="upload.description"]', 'upload.description', 'Q2 security audit evidence'),
      click('[data-submit-upload]')
    ]
  }
];

export function validateOracleScenarios(tasks, scenarios = oracleScenarios) {
  const errors = [];
  const taskList = Array.isArray(tasks) ? tasks : [];
  const scenarioList = Array.isArray(scenarios) ? scenarios : [];
  const taskIds = new Set(taskList.map((task) => task?.id).filter(Boolean));
  const scenarioCounts = new Map();

  if (taskList.length === 0) errors.push('tasks must be a non-empty array');
  if (scenarioList.length === 0) errors.push('oracleScenarios must be a non-empty array');

  scenarioList.forEach((scenario, scenarioIndex) => {
    const label = `oracleScenarios[${scenarioIndex}]`;
    if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) {
      errors.push(`${label} must be an object`);
      return;
    }

    if (typeof scenario.taskId !== 'string' || scenario.taskId.trim() === '') {
      errors.push(`${label}.taskId must be a non-empty string`);
    } else {
      scenarioCounts.set(scenario.taskId, (scenarioCounts.get(scenario.taskId) || 0) + 1);
      if (!taskIds.has(scenario.taskId)) {
        errors.push(`${label}.taskId must reference a registered task`);
      }
    }

    if (!Array.isArray(scenario.actions) || scenario.actions.length === 0) {
      errors.push(`${label}.actions must be a non-empty array`);
      return;
    }

    scenario.actions.forEach((action, actionIndex) => {
      const actionLabel = `${label}.actions[${actionIndex}]`;
      validateAction(action, actionLabel, errors);
    });
  });

  for (const taskId of taskIds) {
    const count = scenarioCounts.get(taskId) || 0;
    if (count !== 1) errors.push(`task ${taskId} must have exactly one oracle scenario; found ${count}`);
  }

  for (const [taskId, count] of scenarioCounts.entries()) {
    if (count > 1) errors.push(`task ${taskId} has duplicate oracle scenarios`);
  }

  return errors;
}

export function summarizeOracleResults(results) {
  const rows = Array.isArray(results) ? results : [];
  const successfulTasks = rows.filter((result) => result.success === true).length;
  const scoreSum = rows.reduce((sum, result) => sum + (typeof result.score === 'number' ? result.score : 0), 0);
  return {
    schemaVersion: ORACLE_BASELINE_SCHEMA_VERSION,
    totalTasks: rows.length,
    successfulTasks,
    failedTasks: rows.length - successfulTasks,
    averageScore: rows.length === 0 ? 0 : Number((scoreSum / rows.length).toFixed(4)),
    results: rows
  };
}

function validateAction(action, label, errors) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    errors.push(`${label} must be an object`);
    return;
  }

  if (!supportedActionTypes.has(action.type)) {
    errors.push(`${label}.type must be one of ${[...supportedActionTypes].join(', ')}`);
  }

  if (typeof action.selector !== 'string' || action.selector.trim() === '') {
    errors.push(`${label}.selector must be a non-empty string`);
  }

  if (['input', 'change'].includes(action.type)) {
    if (typeof action.path !== 'string' || action.path.trim() === '') {
      errors.push(`${label}.path must be a non-empty string`);
    }
    if (!('value' in action)) {
      errors.push(`${label}.value must be present`);
    }
  }
}

function input(selector, path, value, options = {}) {
  return {
    type: 'input',
    selector,
    path,
    value,
    ...options
  };
}

function change(selector, path, value, options = {}) {
  return {
    type: 'change',
    selector,
    path,
    value,
    ...options
  };
}

function click(selector) {
  return { type: 'click', selector };
}

function submit(selector) {
  return { type: 'submit', selector };
}
