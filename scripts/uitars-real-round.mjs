#!/usr/bin/env node
import { loadTasks } from '../src/task-registry.mjs';
import {
  defaultRealRoundOutputDir,
  planRealRound,
  selectRealRoundTasks,
  summarizeRealRound,
  writeRealRoundArtifacts
} from '../src/uitars-real-round.mjs';
import { DEFAULT_HARNESS_BASE_URL } from '../src/benchmark-harness.mjs';

function printHelp() {
  console.log(`UI-TARS real E2E round

Usage:
  node scripts/uitars-real-round.mjs [options]

Options:
  --output <dir>              Experiment output directory.
                              Default: ${defaultRealRoundOutputDir()}
  --tasks <all|id,id>         Task ids to include. Default: all.
  --base-url <url>            Benchmark app base URL. Default: ${DEFAULT_HARNESS_BASE_URL}
  --discover-local-uitars     Use safe local UI-TARS CDP discovery in generated commands.
  --no-isolate-target         Omit --isolate-target from generated prepare commands.
  --plan-only                 Write only round-plan.json and run-log.md.
  --summary-only              Read captures and write summary/run-log without changing the plan shape.
  --help                      Show this help.

This command does not operate the UI-TARS GUI. It records the reproducible
manual loop, including prompts, target preflight commands, and capture commands.
`);
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function parseArgs(argv) {
  const options = {
    outputDir: '',
    tasks: 'all',
    baseUrl: process.env.BENCHMARK_BASE_URL || DEFAULT_HARNESS_BASE_URL,
    discoverLocalUitars: process.env.UI_TARS_DISCOVER_LOCAL === '1',
    isolateTarget: true,
    planOnly: false,
    summaryOnly: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--discover-local-uitars') {
      options.discoverLocalUitars = true;
    } else if (arg === '--no-isolate-target') {
      options.isolateTarget = false;
    } else if (arg === '--plan-only') {
      options.planOnly = true;
    } else if (arg === '--summary-only') {
      options.summaryOnly = true;
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
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.outputDir) options.outputDir = defaultRealRoundOutputDir();
  if (options.planOnly && options.summaryOnly) {
    throw new Error('--plan-only and --summary-only cannot be used together.');
  }
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const allTasks = await loadTasks();
  const tasks = selectRealRoundTasks(options.tasks, allTasks);
  const plan = planRealRound({
    tasks,
    outputDir: options.outputDir,
    baseUrl: options.baseUrl,
    discoverLocalUitars: options.discoverLocalUitars,
    isolateTarget: options.isolateTarget
  });
  const summary = options.planOnly ? null : await summarizeRealRound({
    outputDir: options.outputDir,
    tasks
  });

  await writeRealRoundArtifacts({
    outputDir: options.outputDir,
    plan,
    summary
  });

  console.log(`Wrote real round artifacts to ${options.outputDir}`);
  console.log(`Tasks: ${tasks.map((task) => task.id).join(', ')}`);
  if (summary) {
    console.log(`Captured: ${summary.capturedTasks}/${summary.totalTasks}; success: ${summary.successTasks}; average score: ${summary.averageScore ?? 'n/a'}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
