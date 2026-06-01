#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { evaluateLiveTargetGuard } from '../src/uitars-live-target-guard.mjs';

function usage() {
  return `Usage:
  node scripts/uitars-live-target-guard.mjs --task <id> --benchmark-url <url> (--cdp-url <url> | --discover-local-uitars) [options]

Options:
  --task <id>                  Benchmark task id.
  --benchmark-url <url>        Exact local benchmark URL expected in Chrome.
  --cdp-url <url>              Local Chrome DevTools Protocol endpoint.
  --renderer-cdp-url <url>     Optional renderer CDP endpoint for UI-TARS state checks.
  --discover-local-uitars      Discover a local UI-TARS child Chrome CDP endpoint.
  --output <path>              Write the sanitized guard report to a file.
  --no-require-renderer-state  Skip the UI-TARS renderer state availability check.
  --allow-remote-cdp           Allow a non-localhost CDP endpoint.
  --allow-remote-benchmark     Allow a non-localhost benchmark URL.
  --help                       Show this help.

Environment:
  UI_TARS_CDP_URL              CDP endpoint when --cdp-url is omitted.
  UI_TARS_RENDERER_CDP_URL     Renderer CDP endpoint when --renderer-cdp-url is omitted.
  BENCHMARK_URL                Benchmark URL when --benchmark-url is omitted.
  UI_TARS_DISCOVER_LOCAL=1     Enable safe local UI-TARS discovery.
  UI_TARS_ALLOW_REMOTE_BENCHMARK=1
                               Allow a non-localhost benchmark URL.
`;
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function parseArgs(argv) {
  const options = {
    cdpUrl: process.env.UI_TARS_CDP_URL || '',
    rendererCdpUrl: process.env.UI_TARS_RENDERER_CDP_URL || '',
    benchmarkUrl: process.env.BENCHMARK_URL || '',
    taskId: '',
    output: '',
    requireRendererState: true,
    discoverLocalUitars: process.env.UI_TARS_DISCOVER_LOCAL === '1',
    allowRemoteCdp: false,
    allowRemoteBenchmark: process.env.UI_TARS_ALLOW_REMOTE_BENCHMARK === '1'
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--cdp-url') {
      options.cdpUrl = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--cdp-url=')) {
      options.cdpUrl = arg.slice('--cdp-url='.length);
    } else if (arg === '--renderer-cdp-url') {
      options.rendererCdpUrl = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--renderer-cdp-url=')) {
      options.rendererCdpUrl = arg.slice('--renderer-cdp-url='.length);
    } else if (arg === '--benchmark-url') {
      options.benchmarkUrl = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--benchmark-url=')) {
      options.benchmarkUrl = arg.slice('--benchmark-url='.length);
    } else if (arg === '--task') {
      options.taskId = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--task=')) {
      options.taskId = arg.slice('--task='.length);
    } else if (arg === '--output') {
      options.output = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length);
    } else if (arg === '--discover-local-uitars') {
      options.discoverLocalUitars = true;
    } else if (arg === '--allow-remote-cdp') {
      options.allowRemoteCdp = true;
    } else if (arg === '--allow-remote-benchmark') {
      options.allowRemoteBenchmark = true;
    } else if (arg === '--no-require-renderer-state') {
      options.requireRendererState = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.help) return options;
  if (!options.cdpUrl && !options.discoverLocalUitars) {
    throw new Error('--cdp-url, UI_TARS_CDP_URL, --discover-local-uitars, or UI_TARS_DISCOVER_LOCAL=1 is required.');
  }
  if (!options.benchmarkUrl) throw new Error('--benchmark-url or BENCHMARK_URL is required.');
  if (!options.taskId) throw new Error('--task is required.');
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    process.exit(0);
  }
  const report = await evaluateLiveTargetGuard(options);
  const body = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) {
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, body, 'utf8');
  }
  process.stdout.write(body);
  if (report.verdict !== 'safe_to_prompt') process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
