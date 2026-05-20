# Judge Protocol

## Task Schema

Each item in `public/tasks.json` contains:

```json
{
  "id": "lowercase-task-id",
  "title": "Human readable title",
  "instruction": "Task instruction shown to the agent",
  "startUrl": "/?task=lowercase-task-id",
  "maxSteps": 10,
  "successCriteria": ["criterion text"]
}
```

Validate the task file with:

```sh
node scripts/validate-tasks.mjs
```

## Browser API

The app exposes a deterministic API on `window.__BENCH__`:

```js
window.__BENCH__.reset(taskId)
window.__BENCH__.snapshot()
window.__BENCH__.evaluate(taskId)
window.__BENCH__.listTasks()
window.__BENCH__.runs()
window.__BENCH__.getRun(id)
window.__BENCH__.clearRuns()
window.__BENCH__.exportRuns()
window.__BENCH__.importRuns(payload)
```

- `reset(taskId)` resets the workspace to a task's initial state.
- `snapshot()` returns the current app state.
- `evaluate(taskId)` runs the judge against the current state.
- `listTasks()` returns the loaded task definitions.
- `runs()` returns recorded runs from local storage.
- `getRun(id)` returns a single recorded run.
- `clearRuns()` removes all local run records.
- `exportRuns()` returns a JSON string with `{ schemaVersion, exportedAt, runs }`.
- `importRuns(payload)` accepts an exported JSON string, a run array, or an
  object with a `runs` array.

## Judge Result

Judges return:

```json
{
  "success": false,
  "score": 0.5,
  "details": [
    {
      "criterion": "form is submitted",
      "pass": true,
      "expected": true,
      "actual": true
    }
  ],
  "state": {}
}
```

`score` is the fraction of criteria met, rounded to two decimals. `success` is
true only when every criterion passes. The judge does not mutate the state.

## Run Schema

Recorded runs are stored under `gui-agent-benchmark:runs:v1` in browser
`localStorage` and have this shape:

```json
{
  "id": "run-20260520000000000-abc123",
  "taskId": "onboarding-form",
  "taskTitle": "Submit onboarding request",
  "startedAt": "2026-05-20T00:00:00.000Z",
  "endedAt": "2026-05-20T00:00:10.000Z",
  "durationMs": 10000,
  "steps": 4,
  "actions": [],
  "inputs": [],
  "stateTimeline": [],
  "evaluation": {},
  "success": false,
  "score": 0.5,
  "failureReason": "first unmet criterion"
}
```

`steps` is the count of recorded high-level actions. The recorder logs
reset/start, input changes, select/review clicks, submit, and evaluate/finalize
events. It avoids per-keystroke trace spam by recording form values on
`change`.

`failureReason` is deterministic:

- `null` before evaluation and for successful runs.
- For failed runs, the first `evaluation.details[]` item where `pass === false`.

Validate run schemas and import/export behavior with:

```sh
node scripts/validate-runs.mjs
```
