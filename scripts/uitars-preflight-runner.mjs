#!/usr/bin/env node
import {
  DEFAULT_BENCHMARK_URL,
  runUitarsPreflight,
  writePreflightReport
} from '../src/uitars-preflight.mjs';

function printHelp() {
  console.log(`UI-TARS Local Browser preflight

Usage:
  node scripts/uitars-preflight-runner.mjs --cdp-url http://127.0.0.1:9222 [options]

Options:
  --cdp-url <url>              Explicit Chrome DevTools Protocol endpoint.
  --url <url>                  Benchmark URL. Default: ${DEFAULT_BENCHMARK_URL}
  --output <path>              Write the JSON report to a file instead of stdout.
  --fix                       Navigate matched Google/Bing/Baidu search page targets to the benchmark URL.
  --confirm-explicit-cdp-fix   Allow --fix when --cdp-url or UI_TARS_CDP_URL provides the endpoint.
  --allow-remote-cdp           Allow a non-localhost CDP endpoint.
  --allow-remote-benchmark     Allow a non-localhost benchmark URL.
  --discover-local-uitars      Safely discover a UI-TARS child Chrome endpoint from DevToolsActivePort.
  --help                       Show this help.

Environment:
  UI_TARS_CDP_URL              CDP endpoint when --cdp-url is omitted.
  BENCHMARK_URL                Benchmark URL when --url is omitted.
  UI_TARS_PREFLIGHT_FIX=1      Enable fix mode.
  UI_TARS_CONFIRM_EXPLICIT_CDP_FIX=1
                               Confirm fix mode for explicit CDP endpoints.
  UI_TARS_ALLOW_REMOTE_BENCHMARK=1
                               Allow a non-localhost benchmark URL.
  UI_TARS_DISCOVER_LOCAL=1     Enable safe local UI-TARS discovery.
`);
}

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    cdpUrl: process.env.UI_TARS_CDP_URL,
    benchmarkUrl: process.env.BENCHMARK_URL || DEFAULT_BENCHMARK_URL,
    outputPath: '',
    fix: process.env.UI_TARS_PREFLIGHT_FIX === '1',
    confirmExplicitCdpFix: process.env.UI_TARS_CONFIRM_EXPLICIT_CDP_FIX === '1',
    discoverLocalUitars: process.env.UI_TARS_DISCOVER_LOCAL === '1',
    allowRemoteCdp: false,
    allowRemoteBenchmark: process.env.UI_TARS_ALLOW_REMOTE_BENCHMARK === '1',
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--fix') {
      options.fix = true;
    } else if (arg === '--confirm-explicit-cdp-fix') {
      options.confirmExplicitCdpFix = true;
    } else if (arg === '--allow-remote-cdp') {
      options.allowRemoteCdp = true;
    } else if (arg === '--allow-remote-benchmark') {
      options.allowRemoteBenchmark = true;
    } else if (arg === '--discover-local-uitars') {
      options.discoverLocalUitars = true;
    } else if (arg === '--cdp-url') {
      options.cdpUrl = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--cdp-url=')) {
      options.cdpUrl = arg.slice('--cdp-url='.length);
    } else if (arg === '--url') {
      options.benchmarkUrl = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--url=')) {
      options.benchmarkUrl = arg.slice('--url='.length);
    } else if (arg === '--output') {
      options.outputPath = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--output=')) {
      options.outputPath = arg.slice('--output='.length);
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

  const report = await runUitarsPreflight(options);
  const body = await writePreflightReport(report, options.outputPath);
  if (!options.outputPath) process.stdout.write(body);
  if (['blocked', 'ambiguous', 'error'].includes(report.status)) {
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
