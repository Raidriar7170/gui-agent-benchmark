# Prioritized Evidence Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a P0 scripted oracle baseline and update the public-facing project narrative so the expanded 10-task evidence is framed as diagnostic, not leaderboard-style.

**Architecture:** Keep the oracle baseline local and deterministic. A pure oracle scenario module describes UI-level actions for each task; a validation runner loads the benchmark app through the same browser-facing app module, dispatches the scripted UI events, then evaluates through `window.__BENCH__.evaluate(taskId)`.

**Tech Stack:** Node.js ESM, existing zero-dependency benchmark app, existing `window.__BENCH__` API, existing `src/runs.mjs` run schema validators, npm validation scripts.

---

## Priority Roadmap

| Priority | Outcome | Implementation Surface |
| --- | --- | --- |
| P0 | Prove all deterministic tasks are solvable through the app UI and judge path. | `src/oracle-baseline.mjs`, `scripts/validate-oracle-baseline.mjs`, `README.md`, `docs/judge-protocol.md`, `package.json` |
| P1 | Preserve raw UI-TARS action traces and referenced screenshots for future real runs. | `src/uitars-raw-trace.mjs`, `src/uitars-capture.mjs`, `docs/raw-uitars-trace-schema.md`, validators |
| P2 | Repeat the expanded 10-task round and report variance across runs. | `src/repeated-baseline.mjs`, `scripts/uitars-repeated-baseline.mjs`, report docs |
| P3 | Generate dashboard/GIF artifacts from existing evidence. | `experiments/*`, docs/reporting scripts |

## File Structure

- Create: `src/oracle-baseline.mjs`
  - Owns the deterministic oracle scenario definitions and result summary helpers.
  - Exports `ORACLE_BASELINE_SCHEMA_VERSION`, `oracleScenarios`, `validateOracleScenarios()`, and `summarizeOracleResults()`.
- Create: `scripts/validate-oracle-baseline.mjs`
  - Loads `public/app.mjs` in the existing lightweight Node browser harness style.
  - Dispatches UI-style input, change, click, and submit events against app handlers.
  - Asserts every task evaluates with `success: true` and `score: 1`.
- Modify: `package.json`
  - Add `validate:oracle-baseline`.
  - Add it to the aggregate `validate` script before real-round validation.
- Modify: `README.md`
  - Add a short `TL;DR`.
  - Explain why `0/10` full successes is meaningful after capture completeness is closed.
  - Change evidence placeholders from `<task-id>` to `{task-id}`.
  - Convert Next Steps to P0-P3 priority labels.
- Modify: `docs/judge-protocol.md`
  - Document the scripted oracle baseline and validation command.

---

### Task 1: Add P0 Plan-Visible README Framing

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README top section**

Add this section after the introductory bilingual project description:

```markdown
## TL;DR

This project builds a deterministic benchmark and evidence-chain harness for GUI agents. The current expanded round captured all 10 planned UI-TARS-style browser tasks, with 0 full successes and an average score of 0.206. That result is diagnostic rather than leaderboard-style: it shows capture and environment readiness are closed, while failures concentrate in GUI interaction primitives.
```

- [ ] **Step 2: Clarify the 0/10 result**

Add this paragraph after the Current Results metric table:

```markdown
The 0/10 full-success result is not presented as a leaderboard conclusion. It is meaningful for diagnosing primitive-level failures because the expanded round now has complete capture coverage, so missing evidence is no longer the primary explanation for task failure.
```

- [ ] **Step 3: Normalize evidence placeholders**

Replace:

```text
experiments/2026-05-24-uitars-expanded-real-round/step-traces/<task-id>.json
experiments/2026-05-24-uitars-expanded-real-round/tasks/<task-id>/real-run/
```

With:

```text
experiments/2026-05-24-uitars-expanded-real-round/step-traces/{task-id}.json
experiments/2026-05-24-uitars-expanded-real-round/tasks/{task-id}/real-run/
```

- [ ] **Step 4: Reprioritize Next Steps**

Replace the Next Steps list with:

```markdown
1. P0: Add a scripted browser oracle baseline to prove all deterministic tasks are solvable through the same UI and judge path.
2. P1: Preserve raw UI-TARS action traces and referenced screenshots for real runs.
3. P2: Repeat the expanded 10-task round and report variance.
4. P3: Generate a visual dashboard or GIF from existing evidence artifacts.
```

- [ ] **Step 5: Run documentation grep**

Run:

```bash
rg -n "<task-id>|\\{task-id\\}|0/10|P0|TL;DR" README.md
```

Expected:

```text
README.md includes TL;DR, the diagnostic 0/10 wording, P0-P3 next steps, and only {task-id} placeholders.
```

---

### Task 2: Write the Failing Oracle Baseline Validation

**Files:**
- Create: `scripts/validate-oracle-baseline.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add the validation script command before implementation exists**

Modify `package.json`:

```json
"validate:oracle-baseline": "node scripts/validate-oracle-baseline.mjs"
```

Insert `npm run validate:oracle-baseline` into the aggregate `validate` script before `npm run validate:real-round`.

- [ ] **Step 2: Create the failing validation script**

Create `scripts/validate-oracle-baseline.mjs` with an import that will fail until Task 3 exists:

```js
#!/usr/bin/env node
import { oracleScenarios } from '../src/oracle-baseline.mjs';

if (!Array.isArray(oracleScenarios) || oracleScenarios.length !== 10) {
  throw new Error('Oracle baseline must define 10 scenarios.');
}

console.log('Oracle baseline validation passed.');
```

- [ ] **Step 3: Verify RED**

Run:

```bash
npm run validate:oracle-baseline
```

Expected:

```text
FAIL with ERR_MODULE_NOT_FOUND for ../src/oracle-baseline.mjs.
```

---

### Task 3: Implement Oracle Scenario Definitions

**Files:**
- Create: `src/oracle-baseline.mjs`
- Modify: `scripts/validate-oracle-baseline.mjs`

- [ ] **Step 1: Implement the scenario module**

Create `src/oracle-baseline.mjs` with:

```js
export const ORACLE_BASELINE_SCHEMA_VERSION = 1;

export const oracleScenarios = [
  {
    taskId: 'onboarding-form',
    actions: [
      { type: 'input', selector: '[data-state-path="form.fullName"]', path: 'form.fullName', value: 'Maya Ortiz' },
      { type: 'input', selector: '[data-state-path="form.email"]', path: 'form.email', value: 'maya.ortiz@example.com' },
      { type: 'change', selector: '[data-state-path="form.role"]', path: 'form.role', value: 'Designer' },
      { type: 'input', selector: '[data-state-path="form.startDate"]', path: 'form.startDate', value: '2026-06-15' },
      { type: 'input', selector: '[data-state-path="form.notes"]', path: 'form.notes', value: 'Needs Figma access for design onboarding.' },
      { type: 'submit', selector: '#onboarding-form' }
    ]
  }
];
```

Add the remaining nine scenarios with UI action selectors that match `public/app.mjs`.

- [ ] **Step 2: Add scenario validators**

Add `validateOracleScenarios(tasks, scenarios)` that checks:

```js
const taskIds = new Set(tasks.map((task) => task.id));
const scenarioIds = new Set(scenarios.map((scenario) => scenario.taskId));
```

Rules:
- each scenario task id exists in `public/tasks.json`
- every task has exactly one scenario
- every scenario has at least one action
- every action has a supported `type`
- input/change actions include `path` and `value`
- click/submit actions include `selector`

- [ ] **Step 3: Extend validation script**

Update `scripts/validate-oracle-baseline.mjs` to load `public/tasks.json`, call `validateOracleScenarios()`, and fail with joined errors.

- [ ] **Step 4: Verify GREEN for scenario validation**

Run:

```bash
npm run validate:oracle-baseline
```

Expected:

```text
Oracle baseline validation passed.
```

---

### Task 4: Execute Oracle Through the App UI Path

**Files:**
- Modify: `scripts/validate-oracle-baseline.mjs`

- [ ] **Step 1: Add a lightweight app harness**

Use the existing `scripts/smoke.mjs` pattern:

```js
const previous = {
  document: globalThis.document,
  fetch: globalThis.fetch,
  localStorage: globalThis.localStorage,
  window: globalThis.window
};
```

The harness must:
- provide `document.querySelector()`
- store event listeners registered on `#task-workspace`
- keep `workspace.innerHTML` so rendered selectors can be checked
- expose memory-backed `localStorage`
- rewrite `/src/*.mjs` imports to local file URLs before importing `public/app.mjs`

- [ ] **Step 2: Dispatch each oracle action through app event listeners**

For input/change actions:

```js
target.value = action.value;
dispatchWorkspace(action.type, target);
```

For click actions:

```js
dispatchWorkspace('click', target);
```

For submit actions:

```js
dispatchWorkspace('submit', target, {
  preventDefault() {}
});
```

- [ ] **Step 3: Evaluate through `window.__BENCH__`**

For each scenario:

```js
bench.reset(scenario.taskId, { record: false });
for (const action of scenario.actions) {
  await dispatchOracleAction(action);
}
const evaluation = bench.evaluate(scenario.taskId);
```

Assert:
- `evaluation.success === true`
- `evaluation.score === 1`
- every `evaluation.details[]` item has `pass === true`
- exported runs validate with `validateRun()`

- [ ] **Step 4: Verify GREEN for browser-path oracle**

Run:

```bash
npm run validate:oracle-baseline
```

Expected:

```text
Oracle baseline validation passed: 10/10 tasks succeeded through scripted UI actions.
```

---

### Task 5: Document the Oracle Baseline

**Files:**
- Modify: `docs/judge-protocol.md`
- Modify: `README.md`

- [ ] **Step 1: Add judge protocol documentation**

Add a section:

```markdown
## Scripted Oracle Baseline

The scripted oracle baseline drives the browser app through UI-level actions and then evaluates each task through `window.__BENCH__.evaluate(taskId)`. It is a task-and-judge solvability check, not a GUI-agent score.

Validate it with:

```sh
npm run validate:oracle-baseline
```
```

- [ ] **Step 2: Add README Evidence Map row**

Add:

```markdown
| `src/oracle-baseline.mjs` and `scripts/validate-oracle-baseline.mjs` | Scripted P0 oracle baseline proving task and judge solvability through UI actions |
```

- [ ] **Step 3: Run docs grep**

Run:

```bash
rg -n "scripted oracle|oracle baseline|validate:oracle-baseline|same UI and judge path" README.md docs/judge-protocol.md
```

Expected:

```text
README.md and docs/judge-protocol.md both mention the oracle baseline and validation command.
```

---

### Task 6: Final Verification

**Files:**
- Validate repository-wide behavior.

- [ ] **Step 1: Run focused validation**

Run:

```bash
npm run validate:oracle-baseline
```

Expected:

```text
Oracle baseline validation passed: 10/10 tasks succeeded through scripted UI actions.
```

- [ ] **Step 2: Run full validation**

Run:

```bash
npm run validate
```

Expected:

```text
All existing validation scripts pass, including validate:oracle-baseline.
```

- [ ] **Step 3: Inspect git diff**

Run:

```bash
git diff -- README.md docs/judge-protocol.md package.json src/oracle-baseline.mjs scripts/validate-oracle-baseline.mjs docs/superpowers/plans/2026-05-25-prioritized-evidence-improvements.md
```

Expected:

```text
Diff is scoped to the P0 oracle baseline, README framing, judge docs, package validation, and this plan.
```
