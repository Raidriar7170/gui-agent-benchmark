#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

import {
  exportUitarsNativeTranscriptFromState,
  readJsonFile
} from '../src/uitars-native-transcript-export.mjs';
import { DEFAULT_NATIVE_ACTION_EVIDENCE_EXPERIMENT_DIR } from '../src/native-action-evidence-gate.mjs';

function usage() {
  return `Usage:
  node scripts/export-uitars-native-transcript.mjs --task <id> --state-json <path> [options]

Options:
  --experiment-dir <dir>       Output experiment dir. Defaults to ${DEFAULT_NATIVE_ACTION_EVIDENCE_EXPERIMENT_DIR}
  --task-title <title>         Human-readable task title.
  --final-capture <path>       capture.json with final evaluation.
  --prompt <text>              Operator prompt text.
  --prompt-file <path>         File containing operator prompt text.
  --cdp-url <url>              Reserved for live renderer export; offline --state-json is required in this version.
  --discover-local-uitars      Reserved for live local renderer discovery; offline --state-json is required in this version.
  --help                       Show this help.
`;
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function parseArgs(argv) {
  const options = {
    experimentDir: DEFAULT_NATIVE_ACTION_EVIDENCE_EXPERIMENT_DIR,
    taskTitle: '',
    prompt: '',
    stateJson: '',
    finalCapture: '',
    cdpUrl: '',
    discoverLocalUitars: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') {
      options.help = true;
    } else if (arg === '--task') {
      options.taskId = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--task=')) {
      options.taskId = arg.slice('--task='.length);
    } else if (arg === '--experiment-dir') {
      options.experimentDir = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--experiment-dir=')) {
      options.experimentDir = arg.slice('--experiment-dir='.length);
    } else if (arg === '--state-json') {
      options.stateJson = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--state-json=')) {
      options.stateJson = arg.slice('--state-json='.length);
    } else if (arg === '--final-capture') {
      options.finalCapture = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--final-capture=')) {
      options.finalCapture = arg.slice('--final-capture='.length);
    } else if (arg === '--prompt') {
      options.prompt = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--prompt=')) {
      options.prompt = arg.slice('--prompt='.length);
    } else if (arg === '--prompt-file') {
      options.promptFile = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--prompt-file=')) {
      options.promptFile = arg.slice('--prompt-file='.length);
    } else if (arg === '--task-title') {
      options.taskTitle = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--task-title=')) {
      options.taskTitle = arg.slice('--task-title='.length);
    } else if (arg === '--cdp-url') {
      options.cdpUrl = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--cdp-url=')) {
      options.cdpUrl = arg.slice('--cdp-url='.length);
    } else if (arg === '--discover-local-uitars') {
      options.discoverLocalUitars = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(usage());
  process.exit(0);
}
if (!options.taskId) throw new Error('--task is required.');
if (!options.stateJson) {
  const liveFlag = options.cdpUrl || options.discoverLocalUitars;
  throw new Error(liveFlag
    ? 'Live CDP export is documented but not enabled in this zero-dependency CLI yet; provide --state-json captured from window.zustandBridge.getState().'
    : '--state-json is required.');
}

const state = await readJsonFile(options.stateJson);
const finalCapture = options.finalCapture ? await readJsonFile(options.finalCapture) : null;
const prompt = options.promptFile ? await readFile(options.promptFile, 'utf8') : options.prompt;
const result = await exportUitarsNativeTranscriptFromState({
  state,
  taskId: options.taskId,
  taskTitle: options.taskTitle || options.taskId,
  experimentDir: options.experimentDir,
  prompt,
  finalCapture
});

console.log(`Wrote raw UI-TARS trace: ${result.rawTracePath}`);
