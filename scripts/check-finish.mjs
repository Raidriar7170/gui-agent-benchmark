#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatFinishGateSummary, runFinishGate } from '../src/finish-gate.mjs';

const rootDir = fileURLToPath(new URL('..', import.meta.url));

function printHelp() {
  console.log(`Usage: node scripts/check-finish.mjs [options]

Options:
  --local-only      Run only local completion gates.
  --json            Print the full JSON report instead of a text summary.
  --output <path>   Write the full JSON report to a file.
  --help            Show this help text.
`);
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function parseArgs(argv) {
  const options = {
    localOnly: false,
    json: false,
    output: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') {
      options.help = true;
    } else if (arg === '--local-only') {
      options.localOnly = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--output') {
      options.output = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error('Run with --help for usage.');
  process.exit(1);
}

if (options.help) {
  printHelp();
  process.exit(0);
}

const report = await runFinishGate({
  localOnly: options.localOnly,
  cwd: rootDir
});

const json = `${JSON.stringify(report, null, 2)}\n`;
if (options.output) {
  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, json, 'utf8');
}

if (options.json) {
  process.stdout.write(json);
} else {
  console.log(formatFinishGateSummary(report));
  if (options.output) {
    console.log(`\nWrote JSON report to ${options.output}`);
  }
}

if (!report.ready) {
  process.exitCode = 1;
}
