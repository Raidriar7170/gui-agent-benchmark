#!/usr/bin/env node
import {
  DEFAULT_NATIVE_ACTION_EVIDENCE_EXPERIMENT_DIR
} from '../src/native-action-evidence-gate.mjs';
import {
  P2_NATIVE_ACTION_EVIDENCE_TASK_IDS,
  analyzeNativeActionEvidencePack,
  writeNativeActionEvidencePack
} from '../src/native-action-evidence-pack.mjs';

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function parseTaskIds(value) {
  return value.split(',').map((taskId) => taskId.trim()).filter(Boolean);
}

function parseArgs(argv) {
  const options = {
    experimentDir: DEFAULT_NATIVE_ACTION_EVIDENCE_EXPERIMENT_DIR,
    expectedTaskIds: [...P2_NATIVE_ACTION_EVIDENCE_TASK_IDS]
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--experiment-dir') {
      options.experimentDir = readValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--experiment-dir=')) {
      options.experimentDir = arg.slice('--experiment-dir='.length);
    } else if (arg === '--expected-task-ids') {
      options.expectedTaskIds = parseTaskIds(readValue(argv, index, arg));
      index += 1;
    } else if (arg.startsWith('--expected-task-ids=')) {
      options.expectedTaskIds = parseTaskIds(arg.slice('--expected-task-ids='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const summary = await analyzeNativeActionEvidencePack(options);
const written = await writeNativeActionEvidencePack({
  summary,
  experimentDir: options.experimentDir
});

console.log(`Wrote P2 native action evidence summary: ${written.summaryPath}`);
console.log(`Wrote P2 native action evidence report: ${written.reportPath}`);
console.log(`Wrote P2 native action evidence run log: ${written.runLogPath}`);
