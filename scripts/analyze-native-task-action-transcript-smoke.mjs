#!/usr/bin/env node
import {
  DEFAULT_EXPERIMENT_DIR,
  analyzeNativeTaskActionTranscriptSmoke,
  writeNativeTaskActionTranscriptSmoke
} from '../src/native-task-action-transcript-smoke.mjs';

function readArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

const experimentDir = readArg('--experiment-dir', DEFAULT_EXPERIMENT_DIR);
const summary = await analyzeNativeTaskActionTranscriptSmoke({ experimentDir });
const written = await writeNativeTaskActionTranscriptSmoke({ summary, experimentDir });

console.log(`Wrote native task-action transcript summary: ${written.summaryPath}`);
console.log(`Wrote native task-action transcript report: ${written.reportPath}`);
console.log(`Wrote native task-action transcript run log: ${written.runLogPath}`);
