#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

import {
  exportUitarsNativeTranscriptFromLiveCdp,
  exportUitarsNativeTranscriptFromState,
  readJsonFile
} from '../src/uitars-native-transcript-export.mjs';
import { DEFAULT_NATIVE_ACTION_EVIDENCE_EXPERIMENT_DIR } from '../src/native-action-evidence-gate.mjs';

function usage() {
  return `Usage:
  node scripts/export-uitars-native-transcript.mjs --task <id> (--state-json <path> | --renderer-cdp-url <url> | --cdp-url <url> | --discover-local-uitars) [options]

Options:
  --experiment-dir <dir>       Output experiment dir. Defaults to ${DEFAULT_NATIVE_ACTION_EVIDENCE_EXPERIMENT_DIR}
  --task-title <title>         Human-readable task title.
  --final-capture <path>       capture.json with final evaluation.
  --prompt <text>              Operator prompt text.
  --prompt-file <path>         File containing operator prompt text.
  --benchmark-url <url>        Benchmark task URL for live target guard.
  --guard-cdp-url <url>        CDP endpoint used only for live target safety checks.
  --renderer-cdp-url <url>     CDP endpoint used to read UI-TARS renderer state.
  --cdp-url <url>              Legacy renderer CDP endpoint alias; also used as guard fallback.
  --discover-local-uitars      Discover a local UI-TARS child Chrome CDP endpoint when --state-json is omitted.
  --require-live-guard         Require safe live target guard before live CDP export.
  --help                       Show this help.

Environment:
  UI_TARS_GUARD_CDP_URL        Guard CDP endpoint when --guard-cdp-url is omitted.
  UI_TARS_RENDERER_CDP_URL     Renderer CDP endpoint when --renderer-cdp-url is omitted.
  UI_TARS_CDP_URL              Legacy renderer CDP endpoint alias and guard fallback.
  UI_TARS_DISCOVER_LOCAL=1     Enable safe local UI-TARS discovery when --state-json is omitted.
  BENCHMARK_URL                Benchmark task URL when --benchmark-url is omitted.
  UI_TARS_REQUIRE_LIVE_GUARD=1 Require safe live target guard before live CDP export.
`;
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function parseArgs(argv) {
  let rendererCdpUrlExplicit = Boolean(process.env.UI_TARS_RENDERER_CDP_URL);
  const options = {
    experimentDir: DEFAULT_NATIVE_ACTION_EVIDENCE_EXPERIMENT_DIR,
    taskTitle: '',
    prompt: '',
    stateJson: '',
    finalCapture: '',
    benchmarkUrl: process.env.BENCHMARK_URL || '',
    cdpUrl: process.env.UI_TARS_CDP_URL || '',
    guardCdpUrl: process.env.UI_TARS_GUARD_CDP_URL || '',
    rendererCdpUrl: process.env.UI_TARS_RENDERER_CDP_URL || process.env.UI_TARS_CDP_URL || '',
    discoverLocalUitars: process.env.UI_TARS_DISCOVER_LOCAL === '1',
    requireLiveGuard: process.env.UI_TARS_REQUIRE_LIVE_GUARD === '1'
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
    } else if (arg === '--benchmark-url') {
      options.benchmarkUrl = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--benchmark-url=')) {
      options.benchmarkUrl = arg.slice('--benchmark-url='.length);
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
      if (!rendererCdpUrlExplicit) options.rendererCdpUrl = options.cdpUrl;
      index += 1;
    } else if (arg.startsWith('--cdp-url=')) {
      options.cdpUrl = arg.slice('--cdp-url='.length);
      if (!rendererCdpUrlExplicit) options.rendererCdpUrl = options.cdpUrl;
    } else if (arg === '--guard-cdp-url') {
      options.guardCdpUrl = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--guard-cdp-url=')) {
      options.guardCdpUrl = arg.slice('--guard-cdp-url='.length);
    } else if (arg === '--renderer-cdp-url') {
      options.rendererCdpUrl = readValue(argv, index, arg);
      rendererCdpUrlExplicit = true;
      index += 1;
    } else if (arg.startsWith('--renderer-cdp-url=')) {
      options.rendererCdpUrl = arg.slice('--renderer-cdp-url='.length);
      rendererCdpUrlExplicit = true;
    } else if (arg === '--discover-local-uitars') {
      options.discoverLocalUitars = true;
    } else if (arg === '--require-live-guard') {
      options.requireLiveGuard = true;
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
if (!options.stateJson && !options.rendererCdpUrl && !options.cdpUrl && !options.discoverLocalUitars) {
  throw new Error('--state-json, --renderer-cdp-url, --cdp-url, or --discover-local-uitars is required.');
}
if (options.stateJson && options.requireLiveGuard) {
  throw new Error('--require-live-guard only applies to live CDP export; remove --state-json or disable the guard.');
}

const finalCapture = options.finalCapture ? await readJsonFile(options.finalCapture) : null;
const prompt = options.promptFile ? await readFile(options.promptFile, 'utf8') : options.prompt;
const commonOptions = {
  taskId: options.taskId,
  taskTitle: options.taskTitle || options.taskId,
  experimentDir: options.experimentDir,
  prompt,
  finalCapture,
  benchmarkUrl: options.benchmarkUrl || finalCapture?.benchmarkUrl || '',
  requireLiveGuard: options.requireLiveGuard,
  guardCdpUrl: options.guardCdpUrl,
  rendererCdpUrl: options.rendererCdpUrl
};
const result = options.stateJson
  ? await exportUitarsNativeTranscriptFromState({
    ...commonOptions,
    state: await readJsonFile(options.stateJson)
  })
  : await exportUitarsNativeTranscriptFromLiveCdp({
    ...commonOptions,
    cdpUrl: options.cdpUrl,
    discoverLocalUitars: options.discoverLocalUitars
  });

console.log(`Wrote raw UI-TARS trace: ${result.rawTracePath}`);
