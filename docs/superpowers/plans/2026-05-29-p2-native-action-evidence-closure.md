# P2 Native Action Evidence Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the current one-task P2 native action sample into a strict three-task evidence pack that proves native UI-TARS task actions, final capture, judge output, and failure taxonomy are aligned.

**Architecture:** Keep the normal repository validation green with the existing `--allow-missing` gate, but add a strict closure path that requires `settings-toggle`, `onboarding-form`, and `ticket-review` to have valid native raw transcripts. Add a small exporter for UI-TARS renderer state, a P2 pack analyzer that writes `summary.json`, `report.md`, and `run-log.md`, and a stricter gate that verifies expected task coverage and per-task native action counts.

**Tech Stack:** Node.js ESM, existing CDP helpers in `src/uitars-preflight.mjs`, existing raw trace validators in `src/uitars-raw-trace.mjs`, existing capture runner in `src/uitars-capture.mjs`, npm validation scripts.

---

## Current State

- Existing untracked sample: `experiments/2026-05-29-p2-native-action-evidence/`.
- Existing P2 sample task: `settings-toggle`.
- Existing sample result: `score=0.75`, `success=false`, primary failure `ACT-DROPDOWN-VALUE-MISS`.
- Existing sample native actions: 27 actions with names `click` and `type`.
- Existing stricter sample command already passes locally:

```bash
node scripts/validate-native-action-evidence-gate.mjs --require-sample
```

The closure target is not a higher UI-TARS success rate. The closure target is a verified evidence pack for three representative primitive failures:

```text
settings-toggle   -> dropdown value commit
onboarding-form   -> text entry / form continuation
ticket-review     -> table search / selection / review commit
```

## File Structure

- Create: `src/uitars-native-transcript-export.mjs`
  - Exports sanitized UI-TARS renderer state from `window.zustandBridge.getState()`.
  - Converts UI-TARS messages and `predictionParsed` actions into raw trace events.
  - Writes per-action external JSON artifacts under `tasks/{taskId}/raw/`.
  - Omits inline screenshots/base64 payloads and records only screenshot presence metadata.

- Create: `scripts/export-uitars-native-transcript.mjs`
  - CLI wrapper around `src/uitars-native-transcript-export.mjs`.
  - Inputs: task id, prompt text, output experiment dir, final capture path.
  - Output: `tasks/{taskId}/raw-trace.json` plus raw message artifacts.

- Create: `src/native-action-evidence-pack.mjs`
  - Reads expected P2 task directories.
  - Validates raw trace schema and raw bundle references.
  - Compares raw trace final result with capture evaluation.
  - Renders P2 `summary.json`, `report.md`, and `run-log.md`.

- Create: `scripts/analyze-native-action-evidence-pack.mjs`
  - CLI wrapper around `src/native-action-evidence-pack.mjs`.

- Create: `scripts/validate-native-action-evidence-pack.mjs`
  - Synthetic validation for the P2 pack analyzer and report renderer.

- Modify: `src/native-action-evidence-gate.mjs`
  - Add strict expected task id validation.
  - Add per-task native action minimum validation.
  - Keep the existing default missing-experiment behavior available for aggregate repo validation.

- Modify: `scripts/validate-native-action-evidence-gate.mjs`
  - Add CLI flags:
    - `--expected-task-ids settings-toggle,onboarding-form,ticket-review`
    - `--min-native-task-actions-per-task 1`

- Modify: `package.json`
  - Add:
    - `analyze:p2-native-action-evidence`
    - `validate:native-action-evidence-pack`
    - `validate:p2-native-action-evidence`
  - Add `validate:native-action-evidence-pack` to aggregate `validate`.
  - Keep aggregate `validate:native-action-evidence-gate` in `--allow-missing` mode.

- Modify: `docs/raw-uitars-trace-schema.md`
  - Document the P2 closure commands and the three-task evidence contract.

- Modify or create artifacts under:
  - `experiments/2026-05-29-p2-native-action-evidence/`

---

### Task 1: Add Strict P2 Gate Coverage Options

**Files:**
- Modify: `src/native-action-evidence-gate.mjs`
- Modify: `scripts/validate-native-action-evidence-gate.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add failing synthetic coverage checks to the validation script**

In `scripts/validate-native-action-evidence-gate.mjs`, add one synthetic experiment where `summary.tasks` includes only `settings-toggle`, then validate it with expected task ids `settings-toggle,onboarding-form,ticket-review`.

Use this assertion shape in the existing temp-dir test block:

```js
const missingExpectedTaskDir = join(tempDir, 'missing-expected-task');
await writeSyntheticExperiment({
  experimentDir: missingExpectedTaskDir,
  includeReferencedFiles: true
});
const missingExpectedTaskGate = await validateNativeActionEvidenceGate({
  experimentDir: missingExpectedTaskDir,
  expectedTaskIds: ['settings-toggle', 'onboarding-form', 'ticket-review'],
  minNativeTaskActions: 1,
  minNativeTaskActionsPerTask: 1
});
assert(missingExpectedTaskGate.ok === false, 'gate should fail when expected P2 tasks are missing');
assert(
  missingExpectedTaskGate.errors.some((error) => error.includes('onboarding-form') && error.includes('missing expected task')),
  'gate should report missing expected onboarding-form task'
);
assert(
  missingExpectedTaskGate.errors.some((error) => error.includes('ticket-review') && error.includes('missing expected task')),
  'gate should report missing expected ticket-review task'
);
```

- [ ] **Step 2: Run the gate validation and confirm RED**

Run:

```bash
node scripts/validate-native-action-evidence-gate.mjs --require-sample
```

Expected: FAIL because `expectedTaskIds` and `minNativeTaskActionsPerTask` are not implemented yet.

- [ ] **Step 3: Add expected task options to the gate module**

In `src/native-action-evidence-gate.mjs`, add this helper near `countTranscriptStatuses()`:

```js
function normalizeExpectedTaskIds(value) {
  if (!value) return [];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}
```

Inside `validateNativeActionEvidenceGate(options = {})`, add:

```js
const expectedTaskIds = normalizeExpectedTaskIds(options.expectedTaskIds);
const minNativeTaskActionsPerTask = Number.isFinite(options.minNativeTaskActionsPerTask)
  ? options.minNativeTaskActionsPerTask
  : 0;
```

After `validateSummaryMetadata(summary, errors);`, add:

```js
const summaryTasks = Array.isArray(summary?.tasks) ? summary.tasks : [];
const taskById = new Map(summaryTasks
  .filter(isPlainObject)
  .map((task) => [task.taskId, task]));

for (const taskId of expectedTaskIds) {
  const task = taskById.get(taskId);
  if (!task) {
    errors.push(`${taskId}: missing expected task in P2 native action evidence summary`);
    continue;
  }
  if (task.transcriptStatus !== 'native_task_actions_captured') {
    errors.push(`${taskId}: expected task must have native_task_actions_captured status`);
  }
  if (typeof task.taskActionCount !== 'number' || task.taskActionCount < minNativeTaskActionsPerTask) {
    errors.push(`${taskId}: taskActionCount must be at least ${minNativeTaskActionsPerTask}`);
  }
}
```

- [ ] **Step 4: Add CLI parsing for strict expected tasks**

In `scripts/validate-native-action-evidence-gate.mjs`, extend `parseArgs()` defaults:

```js
expectedTaskIds: [],
minNativeTaskActionsPerTask: 0
```

Add these branches inside the argv loop:

```js
} else if (arg === '--expected-task-ids') {
  options.expectedTaskIds = readValue(argv, index, arg).split(',').map((item) => item.trim()).filter(Boolean);
  index += 1;
} else if (arg.startsWith('--expected-task-ids=')) {
  options.expectedTaskIds = arg.slice('--expected-task-ids='.length).split(',').map((item) => item.trim()).filter(Boolean);
} else if (arg === '--min-native-task-actions-per-task') {
  options.minNativeTaskActionsPerTask = Number(readValue(argv, index, arg));
  index += 1;
} else if (arg.startsWith('--min-native-task-actions-per-task=')) {
  options.minNativeTaskActionsPerTask = Number(arg.slice('--min-native-task-actions-per-task='.length));
```

After the existing `minNativeTaskActions` check, add:

```js
if (!Number.isInteger(options.minNativeTaskActionsPerTask) || options.minNativeTaskActionsPerTask < 0) {
  throw new Error('--min-native-task-actions-per-task must be a non-negative integer.');
}
```

- [ ] **Step 5: Add package scripts**

Modify `package.json` scripts:

```json
"validate:p2-native-action-evidence": "node scripts/validate-native-action-evidence-gate.mjs --require-sample --expected-task-ids settings-toggle,onboarding-form,ticket-review --min-native-task-actions-per-task 1"
```

Do not add `validate:p2-native-action-evidence` to aggregate `validate` until the three-task pack exists. Keep `validate:native-action-evidence-gate` in `--allow-missing` mode in the aggregate validation path.

- [ ] **Step 6: Verify GREEN for normal validation and RED for strict closure**

Run:

```bash
npm run validate:native-action-evidence-gate
```

Expected: PASS.

Run:

```bash
npm run validate:p2-native-action-evidence
```

Expected at this point: FAIL, because only `settings-toggle` exists in the current P2 sample.

Commit:

```bash
git add src/native-action-evidence-gate.mjs scripts/validate-native-action-evidence-gate.mjs package.json
git commit -m "test: add strict P2 native action evidence gate"
```

---

### Task 2: Add UI-TARS Native Transcript Exporter

**Files:**
- Create: `src/uitars-native-transcript-export.mjs`
- Create: `scripts/export-uitars-native-transcript.mjs`
- Create: `scripts/validate-uitars-native-transcript-export.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write synthetic exporter validation**

Create `scripts/validate-uitars-native-transcript-export.mjs` with a temp-dir test that calls pure conversion helpers from `src/uitars-native-transcript-export.mjs`.

The fixture should include one prompt, one screenshot observation, and two native actions:

```js
const stateFixture = {
  status: 'user_stopped',
  thinking: false,
  errorMsg: '',
  messages: [
    {
      from: 'human',
      value: 'Complete settings-toggle.',
      timing: { start: 1780049899987, end: 1780049899987, cost: 0 },
      screenshotBase64: '',
      screenshotBase64WithElementMarker: '',
      predictionParsed: []
    },
    {
      from: 'human',
      value: '<image>',
      timing: { start: 1780049900000, end: 1780049900001, cost: 1 },
      screenshotBase64: 'base64-omitted-by-helper',
      screenshotBase64WithElementMarker: '',
      predictionParsed: []
    },
    {
      from: 'gpt',
      value: 'Thought: toggle digest. Action: click(start_box=\"(1,2)\")',
      timing: { start: 1780049901000, end: 1780049902000, cost: 1000 },
      screenshotBase64: '',
      screenshotBase64WithElementMarker: 'base64-omitted-by-helper',
      predictionParsed: [
        {
          action_type: 'click',
          action_inputs: { start_box: '[0.1,0.2,0.1,0.2]' },
          thought: 'toggle digest',
          reflection: null
        }
      ]
    },
    {
      from: 'gpt',
      value: 'Thought: type timezone. Action: type(content=\"America/New_York\")',
      timing: { start: 1780049903000, end: 1780049904000, cost: 1000 },
      screenshotBase64: '',
      screenshotBase64WithElementMarker: '',
      predictionParsed: [
        {
          action_type: 'type',
          action_inputs: { content: 'America/New_York' },
          thought: 'type timezone',
          reflection: null
        }
      ]
    }
  ]
};
```

Assert that:

- `raw-trace.json` passes `validateRawUitarsTrace()`.
- The raw trace contains two task action events.
- The exported raw message files exist.
- No exported JSON contains inline base64 strings.

- [ ] **Step 2: Run exporter validation and confirm RED**

Run:

```bash
node scripts/validate-uitars-native-transcript-export.mjs
```

Expected: FAIL with module not found for `src/uitars-native-transcript-export.mjs`.

- [ ] **Step 3: Implement pure conversion helpers**

Create `src/uitars-native-transcript-export.mjs` with these exports:

```js
export const NATIVE_TRANSCRIPT_EXPORT_SCHEMA_VERSION = 1;

export function uiTarsMessageToRawEvents({ message, messageIndex, taskId, artifactBase }) {
  // Convert human image messages to observation events.
  // Convert gpt predictionParsed entries to action events.
  // Do not include screenshot base64 content in returned events.
}

export async function exportNativeTranscriptFromState({
  state,
  taskId,
  taskTitle,
  promptText,
  artifactBase,
  outputDir,
  final
}) {
  // Write tasks/{taskId}/raw/source-state-metadata.json.
  // Write one tasks/{taskId}/raw/message-XXX-action-YY.json file per parsed action.
  // Write tasks/{taskId}/raw-trace.json.
}
```

Use the existing raw trace source:

```js
source: 'ui-tars-raw-transcript'
```

Map action names like this:

```js
const actionName = String(prediction.action_type || '').toLowerCase();
```

Store action args like this:

```js
action: {
  name: actionName,
  args: prediction.action_inputs || {}
}
```

For artifact refs, use:

```js
`tasks/${taskId}/raw/message-${String(messageIndex).padStart(3, '0')}-action-${String(predictionIndex + 1).padStart(2, '0')}.json`
```

- [ ] **Step 4: Implement the CDP CLI wrapper**

Create `scripts/export-uitars-native-transcript.mjs` with flags:

```text
--task <id>
--task-title <title>
--prompt <text>
--output <experiment-dir>
--capture <capture.json>
--cdp-url <http://127.0.0.1:9333>
```

The first implementation may accept `--state-json <path>` as an offline mode for tests and debugging. The live mode should evaluate:

```js
window.zustandBridge && window.zustandBridge.getState
  ? window.zustandBridge.getState()
  : null
```

If the bridge is missing, fail with:

```text
UI-TARS renderer state bridge window.zustandBridge.getState() was not found.
```

- [ ] **Step 5: Add package script and validate**

Modify `package.json`:

```json
"validate:uitars-native-transcript-export": "node scripts/validate-uitars-native-transcript-export.mjs",
"uitars:export-native-transcript": "node scripts/export-uitars-native-transcript.mjs"
```

Add `npm run validate:uitars-native-transcript-export` to the aggregate `validate` script before `validate:raw-uitars-trace`.

Run:

```bash
npm run validate:uitars-native-transcript-export
npm run validate
```

Expected: both PASS.

Commit:

```bash
git add src/uitars-native-transcript-export.mjs scripts/export-uitars-native-transcript.mjs scripts/validate-uitars-native-transcript-export.mjs package.json
git commit -m "feat: add UI-TARS native transcript exporter"
```

---

### Task 3: Add P2 Evidence Pack Analyzer

**Files:**
- Create: `src/native-action-evidence-pack.mjs`
- Create: `scripts/analyze-native-action-evidence-pack.mjs`
- Create: `scripts/validate-native-action-evidence-pack.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write synthetic pack validation**

Create `scripts/validate-native-action-evidence-pack.mjs`. In a temp directory, create synthetic raw traces and captures for:

```js
const expectedTaskIds = ['settings-toggle', 'onboarding-form', 'ticket-review'];
```

Each synthetic task should have:

- `tasks/{taskId}/raw-trace.json`
- `tasks/{taskId}/raw/action-raw-1.json`
- `tasks/{taskId}/capture/capture.json`
- `tasks/{taskId}/capture/trace.json`
- `tasks/{taskId}/capture/run-export.json`

Use `validateRawUitarsTraceBundle(rawTrace, { bundleRoot: experimentDir })` to verify the test fixture itself is valid before calling the analyzer.

- [ ] **Step 2: Confirm RED**

Run:

```bash
node scripts/validate-native-action-evidence-pack.mjs
```

Expected: FAIL with module not found for `src/native-action-evidence-pack.mjs`.

- [ ] **Step 3: Implement the analyzer module**

Create `src/native-action-evidence-pack.mjs` with:

```js
export const P2_NATIVE_ACTION_EVIDENCE_PACK_SCHEMA_VERSION = 1;
export const DEFAULT_P2_NATIVE_ACTION_EVIDENCE_DIR = 'experiments/2026-05-29-p2-native-action-evidence';
export const DEFAULT_P2_TASK_IDS = Object.freeze(['settings-toggle', 'onboarding-form', 'ticket-review']);
```

Export:

```js
export async function analyzeNativeActionEvidencePack({
  experimentDir = DEFAULT_P2_NATIVE_ACTION_EVIDENCE_DIR,
  taskIds = DEFAULT_P2_TASK_IDS,
  createdAt = new Date().toISOString()
} = {}) {
  // Read each task raw trace and final capture.
  // Validate raw trace schema and bundle refs.
  // Count native task action names.
  // Compare rawTrace.final.success/score with capture.evaluation.success/score.
  // Return summary object.
}
```

For each task summary, include:

```js
{
  taskId,
  transcriptStatus: 'native_task_actions_captured',
  rawTracePath,
  capturePath,
  taskActionCount,
  taskActionNames,
  final: {
    success,
    score,
    primaryFailureCode,
    failedCriteria
  },
  evidence: [
    rawTracePath,
    capturePath,
    `tasks/${taskId}/capture/trace.json`,
    `tasks/${taskId}/capture/run-export.json`
  ],
  limitations: [
    'Actions are not reconstructed from capture, run-export, step trace, screenshots, or final state.',
    'Inline screenshots and base64 payloads are omitted from portable text artifacts.'
  ]
}
```

- [ ] **Step 4: Implement report rendering and writing**

In `src/native-action-evidence-pack.mjs`, add:

```js
export function renderNativeActionEvidencePackReport(summary) {
  const rows = summary.tasks.map((task) => (
    `| ${task.taskId} | ${task.transcriptStatus} | ${task.taskActionCount} | ${task.taskActionNames.join(', ')} | ${task.final.score} | ${task.final.primaryFailureCode} |`
  )).join('\n');

  return `# P2 Native Action Evidence Pack

Generated: ${summary.createdAt}

## Scope

${summary.scope.measurement}

## Metrics

- task_count: ${summary.scope.taskCount}
- native_task_actions_captured: ${summary.metrics.native_task_actions_captured}
- total_native_task_actions: ${summary.metrics.total_native_task_actions}

## Tasks

| Task | Transcript status | Task actions | Action names | Score | Primary failure |
| --- | --- | ---: | --- | ---: | --- |
${rows}

## Evidence Policy

Native task-action evidence must come from preserved raw UI-TARS transcript events. Capture, run-export, step trace, screenshots, and final state are used for cross-checking, not for reconstructing native actions.
`;
}
```

Add:

```js
export async function writeNativeActionEvidencePack({ summary, experimentDir = DEFAULT_P2_NATIVE_ACTION_EVIDENCE_DIR }) {
  // Write summary.json, report.md, run-log.md.
}
```

- [ ] **Step 5: Add CLI wrapper**

Create `scripts/analyze-native-action-evidence-pack.mjs`:

```js
#!/usr/bin/env node
import {
  DEFAULT_P2_NATIVE_ACTION_EVIDENCE_DIR,
  DEFAULT_P2_TASK_IDS,
  analyzeNativeActionEvidencePack,
  writeNativeActionEvidencePack
} from '../src/native-action-evidence-pack.mjs';

function readArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

const experimentDir = readArg('--experiment-dir', DEFAULT_P2_NATIVE_ACTION_EVIDENCE_DIR);
const taskIds = readArg('--tasks', DEFAULT_P2_TASK_IDS.join(','))
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const summary = await analyzeNativeActionEvidencePack({ experimentDir, taskIds });
const written = await writeNativeActionEvidencePack({ summary, experimentDir });

console.log(`Wrote P2 native action evidence summary: ${written.summaryPath}`);
console.log(`Wrote P2 native action evidence report: ${written.reportPath}`);
console.log(`Wrote P2 native action evidence run log: ${written.runLogPath}`);
```

- [ ] **Step 6: Add package scripts and validate**

Modify `package.json`:

```json
"analyze:p2-native-action-evidence": "node scripts/analyze-native-action-evidence-pack.mjs",
"validate:native-action-evidence-pack": "node scripts/validate-native-action-evidence-pack.mjs"
```

Add `npm run validate:native-action-evidence-pack` to aggregate `validate`.

Run:

```bash
npm run validate:native-action-evidence-pack
npm run validate
```

Expected: both PASS.

Commit:

```bash
git add src/native-action-evidence-pack.mjs scripts/analyze-native-action-evidence-pack.mjs scripts/validate-native-action-evidence-pack.mjs package.json
git commit -m "feat: add P2 native action evidence pack analyzer"
```

---

### Task 4: Collect Three-Task P2 Native Action Evidence

**Files:**
- Modify/create under: `experiments/2026-05-29-p2-native-action-evidence/`

- [ ] **Step 1: Start the local benchmark app**

Run in a foreground terminal:

```bash
npm start
```

Expected:

```text
GUI Agent Benchmark listening at http://127.0.0.1:4173
```

- [ ] **Step 2: Verify local app and tunnel health**

Run:

```bash
npm run smoke
npm run check:tunnel
```

Expected:

```text
Smoke check passed
Tunnel health check passed
```

- [ ] **Step 3: Preserve the existing settings-toggle sample**

Before collecting more tasks, verify the current sample:

```bash
node scripts/validate-native-action-evidence-gate.mjs --require-sample --expected-task-ids settings-toggle --min-native-task-actions-per-task 1
```

Expected: PASS.

- [ ] **Step 4: Prepare onboarding-form target**

Run:

```bash
npm run uitars:harness -- \
  --output experiments/2026-05-29-p2-native-action-evidence/preflight-context/onboarding-form \
  --tasks onboarding-form \
  --base-url http://127.0.0.1:4173 \
  --discover-local-uitars \
  --prepare-target \
  --isolate-target \
  --preflight-fix
```

Expected: JSON output with `status` equal to `ready` or `fixed`.

- [ ] **Step 5: Run UI-TARS for onboarding-form**

Use this operator prompt:

```text
Benchmark task for a local test page. Open http://127.0.0.1:4173/?task=onboarding-form if it is not already visible. Complete the onboarding-form task: create an onboarding request for Maya Ortiz using maya.ortiz@example.com, role Designer, start date 2026-06-15, and notes that include Figma access. Submit the request. Click Evaluate and stop after the judge result is visible.
```

Stop the run after either:

- judge result is visible, or
- the model loops for repeated clicks/types without meaningful state change.

- [ ] **Step 6: Capture onboarding-form final benchmark state**

Run:

```bash
npm run uitars:capture -- \
  --task onboarding-form \
  --output experiments/2026-05-29-p2-native-action-evidence/tasks/onboarding-form/capture \
  --base-url http://127.0.0.1:4173 \
  --discover-local-uitars
```

Expected: writes:

```text
experiments/2026-05-29-p2-native-action-evidence/tasks/onboarding-form/capture/capture.json
experiments/2026-05-29-p2-native-action-evidence/tasks/onboarding-form/capture/trace.json
experiments/2026-05-29-p2-native-action-evidence/tasks/onboarding-form/capture/run-export.json
```

- [ ] **Step 7: Export onboarding-form native transcript**

Run:

```bash
npm run uitars:export-native-transcript -- \
  --task onboarding-form \
  --task-title "Submit onboarding request" \
  --prompt "Benchmark task for a local test page. Open http://127.0.0.1:4173/?task=onboarding-form if it is not already visible. Complete the onboarding-form task: create an onboarding request for Maya Ortiz using maya.ortiz@example.com, role Designer, start date 2026-06-15, and notes that include Figma access. Submit the request. Click Evaluate and stop after the judge result is visible." \
  --output experiments/2026-05-29-p2-native-action-evidence \
  --capture experiments/2026-05-29-p2-native-action-evidence/tasks/onboarding-form/capture/capture.json \
  --cdp-url http://127.0.0.1:9333
```

Expected: writes:

```text
experiments/2026-05-29-p2-native-action-evidence/tasks/onboarding-form/raw-trace.json
experiments/2026-05-29-p2-native-action-evidence/tasks/onboarding-form/raw/source-state-metadata.json
experiments/2026-05-29-p2-native-action-evidence/tasks/onboarding-form/raw/message-*.json
```

- [ ] **Step 8: Repeat target preparation, run, capture, and export for ticket-review**

Use this operator prompt:

```text
Benchmark task for a local test page. Open http://127.0.0.1:4173/?task=ticket-review if it is not already visible. Complete the ticket-review task: find the priority support ticket for Priya Shah or INC-2048, select INC-2048, mark it reviewed, click Evaluate, and stop after the judge result is visible.
```

Use the same command shapes as onboarding-form with `ticket-review` substituted for `onboarding-form`, and with task title:

```text
Review priority support ticket
```

- [ ] **Step 9: Regenerate the P2 pack summary**

Run:

```bash
npm run analyze:p2-native-action-evidence -- \
  --experiment-dir experiments/2026-05-29-p2-native-action-evidence \
  --tasks settings-toggle,onboarding-form,ticket-review
```

Expected: writes:

```text
experiments/2026-05-29-p2-native-action-evidence/summary.json
experiments/2026-05-29-p2-native-action-evidence/report.md
experiments/2026-05-29-p2-native-action-evidence/run-log.md
```

- [ ] **Step 10: Verify strict P2 closure**

Run:

```bash
npm run validate:p2-native-action-evidence
npm run validate
git diff --check
```

Expected:

- strict P2 gate PASS
- aggregate validate PASS
- diff whitespace check PASS

Commit:

```bash
git add experiments/2026-05-29-p2-native-action-evidence
git commit -m "data: add three-task P2 native action evidence pack"
```

---

### Task 5: Update Evidence Documentation

**Files:**
- Modify: `docs/raw-uitars-trace-schema.md`
- Modify: `README.md`
- Optionally modify: `docs/benchmark-report-2026-05-25-expanded-real-round.md`

- [ ] **Step 1: Document the strict P2 command**

In `docs/raw-uitars-trace-schema.md`, update the P2 section with:

````markdown
For the closure pack, use:

```sh
npm run validate:p2-native-action-evidence
```

This strict command requires preserved native raw transcript coverage for
`settings-toggle`, `onboarding-form`, and `ticket-review`. The default aggregate
validation still uses `--allow-missing` so historical checkouts remain
inspectable before a fresh P2 sample exists.
```
````

- [ ] **Step 2: Update README Next Steps after closure**

After the P2 pack is validated, change the README next steps from:

```markdown
2. P1: Preserve raw UI-TARS action traces and referenced screenshots for future
   real runs without backfilling historical derived step traces.
3. P2: Close the native action evidence gate with a fresh raw transcript bundle
   whose task-action events and external refs pass validation.
```

to:

```markdown
2. P1/P2: Preserve native UI-TARS task-action traces for representative real
   runs. The first closure pack covers dropdown commit, form continuation, and
   table-selection failures with raw transcript events plus capture/judge
   cross-checks.
3. P3: Repeat the expanded 10-task round with native transcript preservation
   enabled and report variance.
```

- [ ] **Step 3: Add report link to README evidence map**

Add this row to the README Evidence Map:

```markdown
| `experiments/2026-05-29-p2-native-action-evidence/report.md` | Three-task native action evidence pack linking raw UI-TARS task actions to final capture and judge failures |
```

- [ ] **Step 4: Verify docs and repo**

Run:

```bash
rg -n "validate:p2-native-action-evidence|native action evidence pack|settings-toggle,onboarding-form,ticket-review" README.md docs/raw-uitars-trace-schema.md
npm run validate
git diff --check
```

Expected:

- grep finds the new P2 closure wording
- aggregate validation PASS
- diff whitespace check PASS

Commit:

```bash
git add README.md docs/raw-uitars-trace-schema.md docs/benchmark-report-2026-05-25-expanded-real-round.md
git commit -m "docs: document P2 native action evidence closure"
```

---

## Final Verification Bundle

Run:

```bash
npm run validate:p2-native-action-evidence
npm run validate
npm run smoke
git diff --check
git status --short
```

Expected:

- `validate:p2-native-action-evidence`: PASS with all three expected tasks captured.
- `validate`: PASS.
- `smoke`: PASS.
- `git diff --check`: no output.
- `git status --short`: no unexpected untracked files; only intentional commits remain.

## Scope Boundaries

- Do not push to GitHub in this phase.
- Do not claim a new UI-TARS success rate from this phase.
- Do not backfill historical expanded-round derived traces into native raw transcript evidence.
- Do not reconstruct native actions from final capture, run-export, step trace, screenshots, or judge state.
- Do not store inline screenshots or base64 payloads in JSON artifacts.
- Do not include private IPs, SSH commands, private key paths, cookies, tokens, browser storage, or raw `webSocketDebuggerUrl` values in committed artifacts.

## Execution Choice

Recommended execution: subagent-driven, one worker for tool/gate code and one focused worker or main-thread loop for the real UI-TARS evidence collection, with a review pass before committing the artifact pack.
