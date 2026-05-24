#!/usr/bin/env node
import { ingestRawUitarsTraceFile } from '../src/uitars-raw-trace.mjs';

function printHelp() {
  console.log(`UI-TARS raw trace ingestion

Usage:
  node scripts/ingest-uitars-raw-trace.mjs --input raw.json --output step-trace.json

Options:
  --input <path>    Structured raw UI-TARS transcript JSON.
  --output <path>   Output step trace JSON path.
  --help            Show this help.
`);
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function parseArgs(argv) {
  const options = {
    inputPath: '',
    outputPath: '',
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--input') {
      options.inputPath = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--input=')) {
      options.inputPath = arg.slice('--input='.length);
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
  if (!options.inputPath) throw new Error('--input is required.');
  if (!options.outputPath) throw new Error('--output is required.');

  const result = await ingestRawUitarsTraceFile(options);
  console.log(`Wrote step trace to ${result.outputPath}`);
  console.log(`Raw events: ${result.summary.eventCount}; step count: ${result.stepCount}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
