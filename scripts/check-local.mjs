#!/usr/bin/env node
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function expandHome(filePath) {
  if (!filePath) return filePath;
  if (filePath === '~') return homedir();
  if (filePath.startsWith('~/')) return join(homedir(), filePath.slice(2));
  return filePath;
}

async function commandVersion(command, args) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: 5000 });
    return { ok: true, text: `${stdout}${stderr}`.trim() };
  } catch (error) {
    return { ok: false, text: error.message };
  }
}

function collectConfigCandidates() {
  const cwd = process.cwd();
  const envCandidates = [
    process.env.UI_TARS_CONFIG,
    ...(process.env.UI_TARS_CONFIG_PATHS || '').split(/[:,]/)
  ].filter(Boolean);

  return [
    ...envCandidates,
    join(cwd, 'ui-tars.config.json'),
    join(cwd, '.ui-tars.json'),
    '~/Library/Application Support/ui-tars-desktop/ui_tars.setting.json',
    '~/.ui-tars/config.json',
    '~/.config/ui-tars/config.json'
  ].map((candidate) => resolve(expandHome(candidate)));
}

async function fileAccess(filePath) {
  try {
    await access(filePath, constants.R_OK);
    return { readable: true, exists: true };
  } catch {
    try {
      await access(filePath, constants.F_OK);
      return { readable: false, exists: true };
    } catch {
      return { readable: false, exists: false };
    }
  }
}

const failures = [];

console.log('== Local tool versions ==');
console.log(`node: ${process.version}`);
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (!Number.isInteger(nodeMajor) || nodeMajor < 18) {
  failures.push(`Node >=18 is required, found ${process.version}`);
}

const pythonCommands = [
  process.env.PYTHON_BIN,
  'python3',
  'python'
].filter((value, index, list) => value && list.indexOf(value) === index);

let pythonFound = false;
for (const command of pythonCommands) {
  const result = await commandVersion(command, ['--version']);
  if (result.ok) {
    pythonFound = true;
    console.log(`${command}: ${result.text}`);
    break;
  }
}
if (!pythonFound) failures.push('Python was not found. Set PYTHON_BIN or install python3.');

const gitResult = await commandVersion('git', ['--version']);
if (gitResult.ok) {
  console.log(`git: ${gitResult.text}`);
} else {
  failures.push(`git was not found: ${gitResult.text}`);
}

console.log('\n== UI-TARS config files ==');
const configCandidates = collectConfigCandidates();
const foundConfigs = [];
for (const candidate of configCandidates) {
  const result = await fileAccess(candidate);
  if (result.readable) {
    foundConfigs.push(candidate);
    console.log(`found: ${candidate}`);
  } else if (result.exists) {
    console.warn(`warning: config exists but is not readable: ${candidate}`);
  }
}

if (foundConfigs.length === 0) {
  const message = `No readable UI-TARS config found. Checked ${configCandidates.length} candidate paths.`;
  if (process.env.UI_TARS_CONFIG_REQUIRED === '1') {
    failures.push(message);
  } else {
    console.warn(`warning: ${message}`);
  }
}

if (failures.length > 0) {
  console.error('\nLocal health check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('\nLocal health check passed.');
