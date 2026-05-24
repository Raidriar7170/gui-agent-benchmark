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

## Benchmark Harness

The UI-TARS benchmark harness prepares one experiment directory per run. It
loads and validates `public/tasks.json`, writes a prompt for each selected task,
runs the local-browser preflight in dry-run mode, and emits a trace plus run
export that the existing Runs dashboard importer accepts.

Run all tasks with the default local benchmark base URL:

```sh
npm run uitars:harness
```

Run a focused task set into an explicit experiment directory:

```sh
npm run uitars:harness -- \
  --output experiments/2026-05-21-uitars-harness \
  --tasks onboarding-form,catalog-filter \
  --base-url http://127.0.0.1:4173 \
  --cdp-url http://127.0.0.1:9222
```

The default output path is `experiments/<timestamp>-uitars-harness`. Each
experiment contains:

```text
metadata.json
tasks/<task-id>/prompt.txt
tasks/<task-id>/target-prepare.json   # only when --prepare-target is set
tasks/<task-id>/preflight-dry-run.json
tasks/<task-id>/preflight-fix.json   # only when --preflight-fix is set
tasks/<task-id>/trace.json
tasks/<task-id>/run-export.json
```

`--tasks` defaults to `all`; otherwise pass comma-separated task ids. The
harness combines `--base-url` with each task's `startUrl`, so
`http://127.0.0.1:4173` becomes `http://127.0.0.1:4173/?task=<id>` for the
current task registry.

Preflight is dry-run by default. If CDP is unavailable, invalid, ambiguous, or
returns an error, the harness still writes the blocked/error preflight report,
records the task as `blocked` in `metadata.json`, and writes an active unjudged
run export. Use `--preflight-fix` to also write `preflight-fix.json` and allow
the same `Page.navigate` correction described above. Explicit CDP fix mode still
requires `--confirm-explicit-cdp-fix`; safe local discovery can be enabled with
`--discover-local-uitars`.

Use `--prepare-target` for the next round when UI-TARS already has the benchmark
app open but the tab is still on a previous `?task=<id>` URL. Target preparation
runs before dry-run preflight, writes `tasks/<task-id>/target-prepare.json`, and
adds a non-step `target_prepare` trace event. It is deliberately conservative:
an exact task URL with no open search target is reported as `ready` without
navigation, same-origin and same-path benchmark app tabs with the wrong query
may be navigated to the current task URL, and supported Google/Bing/Baidu search
tabs may be navigated to the current task URL. By default, multiple exact
benchmark page targets are reported as `ambiguous` because real run capture
requires exactly one exact target. If preparation leaves more than one exact
target, it remains `ambiguous`; it is never promoted to `fixed` or `ready`.
By default, mixed wrong-task benchmark app and search candidates also remain
`ambiguous`; use `--isolate-target` when you want target preparation to
explicitly converge them.
When the CDP endpoint is explicit, navigation still requires
`--confirm-explicit-cdp-fix` or `UI_TARS_CONFIRM_EXPLICIT_CDP_FIX=1`; discovery
with a UI-TARS app parent chain can prepare without that extra confirmation.

Round4 target isolation is explicit opt-in. Add `--isolate-target` or
`UI_TARS_ISOLATE_TARGET=1` together with `--prepare-target` when several
benchmark app/search candidates are open and you want the harness to converge
them before dry-run preflight. Isolation chooses one keeper and navigates it to
the current benchmark URL, then navigates extra benchmark/search candidates to
the safe holding URL `about:blank`. It does not close tabs, kill processes, read
UI-TARS storage, inspect logs, or collect secrets. Real run capture still keeps
its strict safety rule: capture proceeds only when `/json/list` shows exactly
one exact benchmark target for the requested task URL.

Round2-style local run:

```sh
npm run uitars:harness -- \
  --output experiments/round2-uitars-harness \
  --tasks all \
  --base-url http://127.0.0.1:4173 \
  --discover-local-uitars \
  --prepare-target
```

Round4-style isolated local run:

```sh
npm run uitars:harness -- \
  --output experiments/round4-uitars-harness \
  --tasks all \
  --base-url http://127.0.0.1:4173 \
  --discover-local-uitars \
  --prepare-target \
  --isolate-target
```

Remote endpoints are refused by default. Use `--allow-remote-cdp` only for an
intentional non-local CDP endpoint, and `--allow-remote-benchmark` only when the
benchmark app is intentionally hosted away from localhost. Output JSON is
sanitized before writing and excludes debugger websocket URLs, request headers,
browser cookies, local storage, inline image payloads, API keys, tokens, and
passwords.

To inspect a harness run in the dashboard, open the benchmark app, choose the
Runs import control, and import any `tasks/<task-id>/run-export.json` file. For
agent traces captured later, import `trace.json` or a `{ "traces": [...] }`
wrapper through the same control.

Validate the harness without requiring UI-TARS or CDP:

```sh
npm run validate:harness
node scripts/uitars-benchmark-harness.mjs --help
```

## Real Run Capture

Real Run Capture is the conservative path for turning a UI-TARS/user-executed
benchmark attempt into importable artifacts. It assumes the benchmark target has
already been prepared by target preparation and that the agent or user has
completed the task in that exact tab. Capture does not navigate pages, close
tabs, read UI-TARS storage/config/logs, inspect IndexedDB or Local Storage, or
operate the UI-TARS GUI.

Run capture after the task is ready:

```sh
npm run uitars:capture -- \
  --task onboarding-form \
  --output artifacts/uitars-capture/onboarding-form \
  --base-url http://127.0.0.1:4173 \
  --cdp-url http://127.0.0.1:9222
```

`--cdp-url` can also be provided with `UI_TARS_CDP_URL`, `--base-url` with
`BENCHMARK_BASE_URL`, and safe local discovery with
`UI_TARS_DISCOVER_LOCAL=1` or `--discover-local-uitars`. CDP and benchmark URLs
must be local by default; use `--allow-remote-cdp` and
`--allow-remote-benchmark` only for intentional remote endpoints.

Capture reads `/json/version` and `/json/list`, requires exactly one exact
benchmark target for the requested task URL, then sends a fixed
`Runtime.evaluate` expression to that target. The expression calls only
`window.__BENCH__.snapshot()` and `window.__BENCH__.evaluate(taskId)`, with the
task id JSON-encoded into the expression. It rejects zero exact targets as
blocked, multiple exact targets as ambiguous, runtime exceptions, non-JSON-safe
return values, and sensitive-looking artifact content.

Output contains three independent files:

```text
capture.json      # captured finalState and evaluation
trace.json        # traceVersion 1, source ui-tars-real-run-capture
run-export.json   # generated from tracesToRuns() and validateRun()
```

The trace always includes a non-step `real_run_capture` event whose value keeps
only lightweight metadata such as sanitized `benchmarkUrl` and `captureStatus`.
The run export is generated locally from `trace.json`; it does not depend on
the page's `window.__BENCH__.exportRuns()`.

Important side effect: `window.__BENCH__.evaluate(taskId)` finalizes the page's
current run storage for that benchmark app tab. Capture does not read or export
that storage directly.

Validate the capture path with synthetic local CDP fixtures:

```sh
npm run validate:capture
node scripts/uitars-capture-run.mjs --help
```

## Real E2E Round

The real-round helper records the repeatable workflow for a UI-TARS Local
Browser Operator run. It does not click in UI-TARS, read UI-TARS storage, inspect
private logs, or complete benchmark tasks for the model. Instead, it writes the
prompts, target repair commands, isolate-before-capture commands, and capture
commands that an operator should use for each task.

```sh
npm run uitars:real-round -- \
  --output experiments/2026-05-23-uitars-real-e2e \
  --tasks all \
  --base-url http://127.0.0.1:4173 \
  --discover-local-uitars
```

Generated files:

```text
round-plan.json         # prompts, paths, commands, required tunnel shape
real-run-summary.json   # score/success/failure summary from capture artifacts
run-log.md              # human-readable protocol plus task result table
```

Recommended task loop:

1. Start a new UI-TARS Local Browser Operator chat.
2. Send the task's `initialPrompt`.
3. If UI-TARS lands on Google/search, wait for `call_user()`.
4. Run the task's `preflightFix` and `prepareAfterCallUser` commands.
5. Send the task's `continuePrompt` and let UI-TARS operate without manual task
   help.
6. After a visible judge result or the run budget, run `prepareBeforeCapture`
   and `capture`.

## Tunnel

The default model endpoint assumes a local SSH tunnel:

```text
http://127.0.0.1:18001/v1/models
```

For this deployment, `18001` must forward to remote proxy port `8001`:

```sh
ssh -L 18001:127.0.0.1:8001 <remote-host>
```

Remote port `8000` is the direct vLLM endpoint. It can pass `/v1/models`, but it
does not rewrite UI-TARS' high `max_tokens` chat request and can fail with a
context-length error. The proxy on `8001` is the compatibility boundary used by
the finish gate.

Verify it with:

```sh
node scripts/check-tunnel.mjs
```

The check verifies both `/v1/models` and a non-stream
`/v1/chat/completions` compatibility probe. Override with `TUNNEL_MODELS_URL`,
`TUNNEL_CHAT_URL`, `TUNNEL_MODEL`, `TUNNEL_TIMEOUT_MS`, or
`TUNNEL_COMPATIBILITY_MAX_TOKENS` when needed. Use
`TUNNEL_SKIP_COMPATIBILITY=1` only when you intentionally want to check
`/v1/models` without proving UI-TARS chat compatibility.

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
