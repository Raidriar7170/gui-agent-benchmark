#!/usr/bin/env node
import { writeRepeatedBaselineSummary } from '../src/repeated-baseline.mjs';

function printHelp() {
  console.log(`UI-TARS repeated baseline summary

Usage:
  node scripts/uitars-repeated-baseline.mjs --rounds r1.json,r2.json,r3.json --output summary.json

Options:
  --rounds <paths>   Comma-separated real-run summary JSON files.
  --output <path>    Output repeated baseline summary JSON.
  --output-dir <dir> Logical repeated baseline experiment directory.
  --help             Show this help.
`);
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function parseArgs(argv) {
  const options = {
    roundSummaryPaths: [],
    outputPath: '',
    outputDir: '',
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--rounds') {
      options.roundSummaryPaths = readValue(argv, index, arg).split(',').map((item) => item.trim()).filter(Boolean);
      index += 1;
    } else if (arg.startsWith('--rounds=')) {
      options.roundSummaryPaths = arg.slice('--rounds='.length).split(',').map((item) => item.trim()).filter(Boolean);
    } else if (arg === '--output') {
      options.outputPath = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--output=')) {
      options.outputPath = arg.slice('--output='.length);
    } else if (arg === '--output-dir') {
      options.outputDir = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--output-dir=')) {
      options.outputDir = arg.slice('--output-dir='.length);
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
  if (options.roundSummaryPaths.length === 0) throw new Error('--rounds is required.');
  if (!options.outputPath) throw new Error('--output is required.');

  const summary = await writeRepeatedBaselineSummary(options);
  console.log(`Wrote repeated baseline summary to ${options.outputPath}`);
  console.log(`Rounds: ${summary.roundCount}; attempts: ${summary.totalTaskAttempts}; average score: ${summary.overall.averageScore}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
