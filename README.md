# GUI Agent Benchmark

Zero-dependency local benchmark workspace for GUI agents. It serves a small
controlled web app with deterministic tasks and a pure judge protocol.

## Quick Start

```sh
npm run validate
npm run smoke
npm start
```

The app defaults to `http://127.0.0.1:4173`.

## Project Layout

- `server.mjs` - Node built-in HTTP static server.
- `public/` - Browser UI, styles, and task definitions.
- `src/` - Shared task state and judge logic.
- `scripts/` - Validation and environment health checks.
- `docs/` - Environment, UI-TARS, and judge protocol notes.

## Run Recorder

The browser app records task attempts in `localStorage` through `src/runs.mjs`.
Each run captures task metadata, timing, action/input traces, state snapshots,
final judge output, score, success, and a deterministic failure reason.
Successful runs store `failureReason: null`; failed runs use the first unmet
judge criterion.

The right panel includes a compact Runs dashboard with aggregate metrics,
failure reason distribution, per-task stats, a run list, replay timeline,
final judge details, and JSON export/import controls.

## Trace Importer

The same Import control accepts existing run exports plus standard external
trace payloads through `src/trace-importer.mjs`.

```json
{
  "traceVersion": 1,
  "source": "ui-tars",
  "taskId": "onboarding-form",
  "taskTitle": "Submit onboarding request",
  "startedAt": "2026-05-20T00:00:00.000Z",
  "events": [
    {
      "timestamp": "2026-05-20T00:00:01.000Z",
      "type": "input",
      "path": "form.fullName",
      "value": "Maya Ortiz"
    }
  ]
}
```

You can import one trace object, `{ "traces": [ ... ] }`, or JSONL where each
non-empty line is one complete trace object. Event-stream JSONL is intentionally
not parsed in this MVP. Trace events become run `actions[]`; input-like events
also become `inputs[]`. If a trace includes `finalState` but no explicit
`evaluation`, the dashboard runs the existing judge for that `taskId`. Traces
without `finalState` or `evaluation` import as active, unjudged runs.

## Benchmark API

The page exposes:

```js
window.__BENCH__ = {
  reset(taskId),
  snapshot(),
  evaluate(taskId),
  listTasks(),
  runs(),
  getRun(id),
  clearRuns(),
  exportRuns(),
  importRuns(payload)
}
```

- `runs()` returns recorded runs from local storage.
- `getRun(id)` returns one recorded run.
- `clearRuns()` removes recorded runs.
- `exportRuns()` returns a JSON string with run records.
- `importRuns(payload)` imports a JSON string, array, `{ runs }` object, trace
  object, `{ traces }` object, or JSONL trace file.

`evaluate(taskId)` returns:

```js
{ success, score, details, state }
```

See `docs/judge-protocol.md` for the full schema.

## Health Checks

```sh
node scripts/check-local.mjs
node scripts/check-tunnel.mjs
node scripts/check-remote.mjs
npm run check:finish -- --local-only
npm run check:finish
```

The tunnel check defaults to `http://127.0.0.1:18001/v1/models` and also sends a
UI-TARS-style `/v1/chat/completions` probe with high `max_tokens`. For the
Volcano deployment, the local tunnel must bind to the remote proxy port `8001`,
not direct vLLM port `8000`:

```sh
ssh -L 18001:127.0.0.1:8001 <remote-host>
```

Remote checks are read-only and default to the
`/mnt/data/minghongsun/ui-tars-vllm` project path. Configure remote access with
environment variables documented in `docs/environment.md`.

## Finish Gate

Use the finish gate when deciding whether the project is actually ready rather
than only locally valid.

```sh
npm run check:finish -- --local-only
npm run check:finish -- --json --output artifacts/finish-gate/report.json
```

`--local-only` runs the required local closure checks: `npm run validate`,
`npm run smoke`, and `node scripts/check-local.mjs`. The full finish gate also
runs `node scripts/check-tunnel.mjs` and `node scripts/check-remote.mjs`, so it
will report `not ready` until the model tunnel and remote UI-TARS health checks
are reachable. The JSON report separates `localReady` from `integrationReady`
to make that distinction explicit.

## Real UI-TARS E2E Round

Use the real-round helper to make a UI-TARS benchmark round reproducible without
letting the benchmark scripts operate the UI-TARS GUI directly:

```sh
npm run uitars:real-round -- \
  --output experiments/<date>-uitars-real-e2e \
  --tasks all \
  --base-url http://127.0.0.1:4173 \
  --discover-local-uitars
```

It writes `round-plan.json`, `real-run-summary.json`, and `run-log.md`. The plan
contains the standard prompts, target preflight repair commands,
isolate-before-capture commands, and capture commands for each task. The summary
is generated from `tasks/<task-id>/real-run*/capture.json` artifacts.

Current report artifacts:

- `docs/benchmark-report-2026-05-23.md`
- `docs/benchmark-report-2026-05-24-repeated-baseline.md`
- `docs/failure-taxonomy.md`
- `docs/raw-uitars-trace-schema.md`
- `docs/repeated-baseline.md`
- `docs/step-trace-schema.md`
- `experiments/2026-05-23-uitars-real-e2e/failure-taxonomy.json`
- `experiments/2026-05-24-uitars-repeated-baseline/summary.json`
- `experiments/2026-05-23-uitars-real-e2e/step-traces/<task-id>.json`
