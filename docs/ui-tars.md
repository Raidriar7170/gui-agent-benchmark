# UI-TARS Notes

## Trace Import Boundary

This benchmark does not parse UI-TARS IndexedDB, Local Storage, private logs,
or config files. UI-TARS integrations should export a neutral trace JSON/JSONL
file and import that file through the Runs dashboard. This keeps credentials,
raw prompts, browser storage internals, and large screenshots outside the
benchmark storage model.

Recommended hook flow:

1. Start a benchmark task with `window.__BENCH__.reset(taskId)`.
2. Record high-level UI-TARS actions in your runner hook as trace `events[]`.
3. Capture lightweight metadata such as selectors, target paths, and screenshot
   references. Prefer `screenshotUrl`, `screenshotPath`, or `screenshotRef`
   over base64 image payloads.
4. At the end of the attempt, export `window.__BENCH__.snapshot()` as
   `finalState`, or export an explicit `evaluation` object if the runner has
   already called `window.__BENCH__.evaluate(taskId)`.
5. Write either one trace object, `{ "traces": [ ... ] }`, or JSONL where each
   non-empty line is one complete trace object.

Minimal trace shape:

```json
{
  "traceVersion": 1,
  "source": "ui-tars",
  "taskId": "onboarding-form",
  "startedAt": "2026-05-20T00:00:00.000Z",
  "events": [
    {
      "timestamp": "2026-05-20T00:00:01.000Z",
      "type": "input",
      "label": "Set full name",
      "path": "form.fullName",
      "value": "Maya Ortiz"
    }
  ]
}
```

Event-stream JSONL is not part of the MVP importer. If a runner emits one event
per line, aggregate those events into a complete trace object before import.

## Config

Local config discovery is handled by:

```sh
node scripts/check-local.mjs
```

Set `UI_TARS_CONFIG` to the exact config path, or provide several paths with
`UI_TARS_CONFIG_PATHS`. The check only verifies readability and never prints
secret-bearing file contents.

## Tunnel

The default model endpoint assumes a local SSH tunnel:

```text
http://127.0.0.1:18001/v1/models
```

Verify it with:

```sh
node scripts/check-tunnel.mjs
```

Override the URL with `TUNNEL_MODELS_URL` when the tunnel binds a different
local port.

## Remote Scope

Remote operations for this benchmark are limited to read-only health checks.
The expected remote project path is:

```text
/mnt/data/minghongsun/ui-tars-vllm
```

Do not inspect, modify, kill processes for, or write into colleague directories.
The check script refuses a remote root outside `/mnt/data/minghongsun/*`.

When starting vLLM manually outside this benchmark, use:

```sh
start_vllm_cu12.sh
```

Do not use the old `start_vllm.sh`.
