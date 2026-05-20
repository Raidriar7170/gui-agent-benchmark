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
- `importRuns(payload)` imports a JSON string, array, or `{ runs }` object.

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
