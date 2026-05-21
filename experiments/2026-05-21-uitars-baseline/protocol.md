# UI-TARS Baseline Protocol

Experiment: `2026-05-21-uitars-baseline`

## Goal

Run the first real UI-TARS baseline against the local GUI Agent Benchmark and
record task outcomes without synthetic or backfilled results.

This round is limited to **4 tasks x 1 attempt**. Each task is attempted once
with UI-TARS Local Browser Operator against the local benchmark app.

## Environment

- Benchmark app: GUI Agent Benchmark in this repository.
- Target URL: `http://127.0.0.1:4173`
- Operator: UI-TARS Local Browser Operator.
- Node runtime: Node 18 or newer.
- Run date: 2026-05-21.

Before starting the real run, verify local prerequisites:

```sh
node scripts/check-local.mjs
node scripts/check-tunnel.mjs
```

`check-local` may report readable UI-TARS config candidates, but it must not
print config file contents, API keys, tokens, or passwords. `check-tunnel`
verifies the local model endpoint through the configured tunnel.

## Model Configuration Summary

Record only non-secret operational settings for the baseline run:

- UI-TARS runtime: Local Browser Operator.
- Model endpoint: local tunnel endpoint checked by `node scripts/check-tunnel.mjs`.
- Browser target: `http://127.0.0.1:4173`.
- Attempt policy: one attempt per task, no retries.

Do not write API keys, bearer tokens, passwords, cookies, private config file
contents, or other credentials into this experiment directory.

## Task List

The task prompts are defined in `prompts.json`.

1. `onboarding-form`
2. `catalog-filter`
3. `settings-toggle`
4. `ticket-review`

Each task uses the absolute `startUrl` under `http://127.0.0.1:4173` and
`maxAttempts: 1`.

## Run Rules

1. Start the benchmark server with `npm start` if it is not already running.
2. Run the local and tunnel checks before the first attempt.
3. Open each task from its `startUrl` in UI-TARS Local Browser Operator.
4. Allow exactly one attempt for each task.
5. Do not manually correct, retry, or complete a task after UI-TARS stops.
6. Capture the benchmark judge output after each attempt.
7. Record real outcomes in `results-template.json` or a copied run log.

The result fields `startedAt`, `endedAt`, `success`, `score`, and
`failureReason` must remain `null` until a real run produces them.

## Failure Classification

Separate infrastructure failures from model task failures.

Infrastructure failures include:

- benchmark server unavailable at `http://127.0.0.1:4173`;
- `node scripts/check-local.mjs` failure that blocks running UI-TARS;
- `node scripts/check-tunnel.mjs` failure that blocks model access;
- UI-TARS Local Browser Operator launch failure;
- browser crash, network outage, or trace export failure.

Model task failures include:

- UI-TARS completes the attempt but the judge reports `success: false`;
- wrong field values, wrong selected item, missed toggle, or missing review
  state according to the benchmark judge;
- UI-TARS stops before satisfying the task while the app, tunnel, and operator
  remain available.

If an infrastructure failure prevents a task attempt, leave task result fields
as `null` and record the issue under the infrastructure section of the result
template.

## Privacy Boundary

Do not inspect or copy UI-TARS IndexedDB, browser Local Storage, raw private
logs, or secret-bearing config files. The benchmark may import neutral trace
JSON/JSONL only.

Screenshots and large visual artifacts must be stored as file paths, URLs, or
short summaries. Do not place base64 screenshot payloads in Markdown or JSON
experiment records.

Do not record:

- API keys;
- bearer tokens;
- passwords;
- cookies;
- private config contents;
- raw UI-TARS IndexedDB contents;
- unredacted secret-bearing logs.

## Export and Import Flow

Preferred benchmark flow:

1. Reset or open the task at its `startUrl`.
2. Let UI-TARS Local Browser Operator perform the task.
3. Export a neutral trace object, `{ "traces": [...] }`, or JSONL where each
   line is a complete trace object.
4. Include high-level actions, timestamps, target/path metadata, and screenshot
   references when useful.
5. Include either `finalState` from `window.__BENCH__.snapshot()` or the judge
   `evaluation` from `window.__BENCH__.evaluate(taskId)`.
6. Import the trace through the benchmark Runs dashboard when reviewing or
   aggregating results.

Follow `docs/ui-tars.md` and `docs/judge-protocol.md` for the trace boundary
and run schema. This protocol does not authorize reading UI-TARS private
storage or secret-bearing files directly.

## Result Recording

Use `results-template.json` as the starting record. It intentionally contains
no completed results. After real runs, fill only observed values and artifact
references from the actual execution.

Do not invent timestamps, scores, success values, failure reasons, notes, or
artifact paths.
