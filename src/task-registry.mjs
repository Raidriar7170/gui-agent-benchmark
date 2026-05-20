import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
export const defaultTasksPath = join(rootDir, 'public', 'tasks.json');

const requiredFields = [
  'id',
  'title',
  'instruction',
  'startUrl',
  'maxSteps',
  'successCriteria'
];

export async function loadTasks(tasksPath = defaultTasksPath) {
  const text = await readFile(tasksPath, 'utf8');
  return JSON.parse(text);
}

export function validateTasks(tasks) {
  const errors = [];
  const ids = new Set();

  if (!Array.isArray(tasks)) {
    return ['tasks.json must contain an array'];
  }

  if (tasks.length < 4) {
    errors.push('tasks.json must contain at least 4 tasks');
  }

  tasks.forEach((task, index) => {
    const label = `task[${index}]`;
    for (const field of requiredFields) {
      if (!(field in task)) {
        errors.push(`${label} missing required field ${field}`);
      }
    }

    if (typeof task.id !== 'string' || !/^[a-z0-9-]+$/.test(task.id)) {
      errors.push(`${label}.id must be a lowercase slug`);
    } else if (ids.has(task.id)) {
      errors.push(`${label}.id duplicates ${task.id}`);
    } else {
      ids.add(task.id);
    }

    for (const field of ['title', 'instruction', 'startUrl']) {
      if (typeof task[field] !== 'string' || task[field].trim() === '') {
        errors.push(`${label}.${field} must be a non-empty string`);
      }
    }

    if (typeof task.startUrl === 'string' && !task.startUrl.startsWith('/')) {
      errors.push(`${label}.startUrl must be a local path`);
    }

    if (!Number.isInteger(task.maxSteps) || task.maxSteps <= 0) {
      errors.push(`${label}.maxSteps must be a positive integer`);
    }

    const criteria = task.successCriteria;
    const validCriteria = Array.isArray(criteria)
      && criteria.length > 0
      && criteria.every((item) => typeof item === 'string' && item.trim() !== '');
    if (!validCriteria) {
      errors.push(`${label}.successCriteria must be a non-empty array of strings`);
    }
  });

  return errors;
}
