#!/usr/bin/env node
import { join } from 'node:path';

import {
  DEFAULT_CAPTURE_BASE_URL,
  runUitarsCapture
} from '../src/uitars-capture.mjs';

function printHelp() {
  console.log(`UI-TARS Real Run Capture

Usage:
  node scripts/uitars-capture-run.mjs --task <id> --cdp-url http://127.0.0.1:9222 [options]

Options:
  --task <id>                  Benchmark task id to capture. Required.
  --output <dir>               Directory for capture.json, trace.json, and run-export.json.
  --base-url <url>             Benchmark base URL. Default: ${DEFAULT_CAPTURE_BASE_URL}
  --cdp-url <url>              Explicit Chrome DevTools Protocol endpoint.
  --discover-local-uitars      Safely discover a UI-TARS child Chrome endpoint from DevToolsActivePort.
  --allow-remote-cdp           Allow fixed benchmark Runtime.evaluate against a non-localhost browser target.
  --allow-remote-benchmark     Allow a non-localhost benchmark URL.
  --help                       Show this help.

Environment:
  UI_TARS_CDP_URL              CDP endpoint when --cdp-url is omitted.
  BENCHMARK_BASE_URL           Benchmark base URL when --base-url is omitted.
  UI_TARS_DISCOVER_LOCAL=1     Enable safe local UI-TARS discovery.
`);
}

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function parseArgs(argv) {
  const options = {
    taskId: '',
    outputDir: '',
    baseUrl: process.env.BENCHMARK_BASE_URL || DEFAULT_CAPTURE_BASE_URL,
    cdpUrl: process.env.UI_TARS_CDP_URL,
    discoverLocalUitars: process.env.UI_TARS_DISCOVER_LOCAL === '1',
    allowRemoteCdp: false,
    allowRemoteBenchmark: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--discover-local-uitars') {
      options.discoverLocalUitars = true;
    } else if (arg === '--allow-remote-cdp') {
      options.allowRemoteCdp = true;
    } else if (arg === '--allow-remote-benchmark') {
      options.allowRemoteBenchmark = true;
    } else if (arg === '--task') {
      options.taskId = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--task=')) {
      options.taskId = arg.slice('--task='.length);
    } else if (arg === '--output') {
      options.outputDir = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--output=')) {
      options.outputDir = arg.slice('--output='.length);
    } else if (arg === '--base-url') {
      options.baseUrl = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--base-url=')) {
      options.baseUrl = arg.slice('--base-url='.length);
    } else if (arg === '--cdp-url') {
      options.cdpUrl = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--cdp-url=')) {
      options.cdpUrl = arg.slice('--cdp-url='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }
  if (!options.taskId) throw new Error('--task <id> is required.');
  if (!options.outputDir) options.outputDir = join('artifacts', 'uitars-capture', options.taskId);

  const result = await runUitarsCapture(options);
  console.log(`Wrote UI-TARS capture artifacts to ${result.outputDir}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
