#!/usr/bin/env node
import {
  DEFAULT_HARNESS_BASE_URL,
  defaultBenchmarkHarnessOutputDir,
  runBenchmarkHarness
} from '../src/benchmark-harness.mjs';

function printHelp() {
  console.log(`UI-TARS benchmark harness

Usage:
  node scripts/uitars-benchmark-harness.mjs [options]

Options:
  --output <dir>                 Experiment output directory.
                                 Default: ${defaultBenchmarkHarnessOutputDir()}
  --tasks <all|id,id>            Task ids to prepare. Default: all.
  --base-url <url>               Benchmark app base URL. Default: ${DEFAULT_HARNESS_BASE_URL}
  --cdp-url <url>                Explicit Chrome DevTools Protocol endpoint.
  --discover-local-uitars        Safely discover a UI-TARS child Chrome endpoint.
  --preflight-fix                Also write preflight-fix.json by navigating matched search targets.
  --confirm-explicit-cdp-fix     Allow fix mode when the CDP endpoint is explicit.
  --allow-remote-cdp             Allow a non-localhost CDP endpoint.
  --allow-remote-benchmark       Allow a non-localhost benchmark URL.
  --help                         Show this help.

Environment:
  UI_TARS_CDP_URL                CDP endpoint when --cdp-url is omitted.
  BENCHMARK_BASE_URL             Benchmark base URL when --base-url is omitted.
  UI_TARS_DISCOVER_LOCAL=1       Enable safe local UI-TARS discovery.
  UI_TARS_PREFLIGHT_FIX=1        Enable preflight fix mode.
  UI_TARS_CONFIRM_EXPLICIT_CDP_FIX=1
                                 Confirm fix mode for explicit CDP endpoints.
  UI_TARS_ALLOW_REMOTE_BENCHMARK=1
                                 Allow a non-localhost benchmark URL.
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
    outputDir: '',
    tasks: 'all',
    baseUrl: process.env.BENCHMARK_BASE_URL || DEFAULT_HARNESS_BASE_URL,
    cdpUrl: process.env.UI_TARS_CDP_URL || '',
    discoverLocalUitars: process.env.UI_TARS_DISCOVER_LOCAL === '1',
    preflightFix: process.env.UI_TARS_PREFLIGHT_FIX === '1',
    confirmExplicitCdpFix: process.env.UI_TARS_CONFIRM_EXPLICIT_CDP_FIX === '1',
    allowRemoteCdp: false,
    allowRemoteBenchmark: process.env.UI_TARS_ALLOW_REMOTE_BENCHMARK === '1',
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--discover-local-uitars') {
      options.discoverLocalUitars = true;
    } else if (arg === '--preflight-fix') {
      options.preflightFix = true;
    } else if (arg === '--confirm-explicit-cdp-fix') {
      options.confirmExplicitCdpFix = true;
    } else if (arg === '--allow-remote-cdp') {
      options.allowRemoteCdp = true;
    } else if (arg === '--allow-remote-benchmark') {
      options.allowRemoteBenchmark = true;
    } else if (arg === '--output') {
      options.outputDir = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--output=')) {
      options.outputDir = arg.slice('--output='.length);
    } else if (arg === '--tasks') {
      options.tasks = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--tasks=')) {
      options.tasks = arg.slice('--tasks='.length);
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

  if (!options.outputDir) options.outputDir = defaultBenchmarkHarnessOutputDir();
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const result = await runBenchmarkHarness(options);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
