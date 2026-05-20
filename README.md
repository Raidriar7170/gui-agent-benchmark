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
```

The tunnel check defaults to
`http://127.0.0.1:18001/v1/models`. Remote checks are read-only and default to
the `/mnt/data/minghongsun/ui-tars-vllm` project path. Configure remote access
with environment variables documented in `docs/environment.md`.
