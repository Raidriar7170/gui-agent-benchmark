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

## Local Browser Preflight

The reproducible UI-TARS browser preflight checks the Chrome DevTools Protocol
targets exposed by the UI-TARS-managed browser. It reads only `/json/version`
and `/json/list`, writes sanitized target summaries, and defaults to dry-run
mode.

Use an explicit local CDP endpoint whenever possible:

```sh
npm run uitars:preflight -- \
  --cdp-url http://127.0.0.1:9222 \
  --url http://127.0.0.1:4173/?task=onboarding-form \
  --output artifacts/uitars-preflight/dry-run.json
```

`--cdp-url` can also be provided with `UI_TARS_CDP_URL`. The endpoint must be
`localhost`, `127.0.0.1`, or `::1` by default and must not contain URL
credentials. `--allow-remote-cdp` is required for any non-local CDP host.

The benchmark URL must use `http` or `https` and must also be local by default.
Use `--allow-remote-benchmark` or `UI_TARS_ALLOW_REMOTE_BENCHMARK=1` only when
the benchmark app is intentionally hosted away from localhost.

Optional safe local discovery is available when the exact endpoint is not known:

```sh
npm run uitars:preflight -- \
  --discover-local-uitars \
  --url http://127.0.0.1:4173/?task=onboarding-form
```

Discovery is intentionally narrow. It inspects the process tree for a Chrome
process whose parent chain includes the real macOS UI-TARS app executable, such
as `/Applications/UI TARS.app/Contents/MacOS/UI-TARS`, and whose Chrome command
line contains both `puppeteer_dev_chrome_profile` and
`--remote-debugging-port=0`. A process name or ancestor command merely
containing `ui-tars`/`uitars` is not enough. The discovery path avoids
browser-use, ordinary Puppeteer, and user Chrome profiles; it does not scan
ports, kill processes, or touch non-UI-TARS Chrome instances.

Dry-run reports use `status: "needs_fix"` when a supported Google, Bing, or
Baidu home/search page target is present and can be rebound. To make the change,
opt in explicitly:

```sh
npm run uitars:preflight -- \
  --cdp-url http://127.0.0.1:9222 \
  --url http://127.0.0.1:4173/?task=onboarding-form \
  --fix \
  --confirm-explicit-cdp-fix
```

`--fix` can also be enabled with `UI_TARS_PREFLIGHT_FIX=1`. When the CDP
endpoint is explicit (`--cdp-url` or `UI_TARS_CDP_URL`), fix mode additionally
requires `--confirm-explicit-cdp-fix` or
`UI_TARS_CONFIRM_EXPLICIT_CDP_FIX=1`. Discovery-based fix mode does not require
that extra confirmation after it identifies a UI-TARS app parent chain with
confidence. Fix mode sends CDP `Page.navigate` to matching search page targets
and never closes tabs.

Report fields include:

```json
{
  "schemaVersion": 1,
  "source": "explicit",
  "timestamp": "2026-05-21T00:00:00.000Z",
  "status": "needs_fix",
  "reason": "Found 1 supported search page target that can be navigated to the benchmark URL with --fix.",
  "mode": { "fix": false },
  "benchmark": {
    "url": "http://127.0.0.1:4173/?task=onboarding-form",
    "origin": "http://127.0.0.1:4173",
    "path": "/"
  },
  "cdp": { "endpoint": "http://127.0.0.1:9222/" },
  "actions": [],
  "targetsBefore": [
    { "id": "target-1", "type": "page", "title": "Google", "url": "https://www.google.com/" }
  ],
  "targetsAfter": [],
  "warnings": []
}
```

Allowed statuses are `ready`, `needs_fix`, `fixed`, `blocked`, `ambiguous`, and
`error`. Target output is limited to `id`, `type`, `title`, and sanitized `url`;
it does not include debugger websocket URLs, headers, cookies, local storage,
screenshots, base64 payloads, API keys, tokens, config, or full process command
lines.

Validate the preflight schema and sanitizer with:

```sh
npm run validate:uitars-preflight
node scripts/validate-uitars-preflight.mjs artifacts/uitars-preflight/dry-run.json
```

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
