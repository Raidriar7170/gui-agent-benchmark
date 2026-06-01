# Raw UI-TARS Trace Ingestion

Raw UI-TARS ingestion converts a structured transcript into the project step
trace format. It is the bridge from model/browser telemetry to failure
taxonomy, without reading UI-TARS private storage directly.

## Input Shape

```json
{
  "schemaVersion": 1,
  "source": "ui-tars-raw-transcript",
  "taskId": "settings-toggle",
  "taskTitle": "Update workspace settings",
  "artifactBase": "experiments/example-round",
  "createdAt": "2026-05-23T00:00:00.000Z",
  "events": [
    {
      "id": "raw-1",
      "type": "observation",
      "role": "assistant",
      "timestamp": "2026-05-23T00:00:01.000Z",
      "text": "I can see the settings page."
    },
    {
      "id": "raw-2",
      "type": "action",
      "role": "assistant",
      "timestamp": "2026-05-23T00:00:02.000Z",
      "artifactRefs": [
        "tasks/settings-toggle/raw/action-raw-2.json"
      ],
      "screenshotRef": "tasks/settings-toggle/screenshots/action-raw-2.png",
      "action": {
        "name": "click",
        "args": {
          "target": "Weekly email digest"
        }
      }
    }
  ],
  "final": {
    "success": false,
    "score": 0.75,
    "primaryFailureCode": "ACT-DROPDOWN-VALUE-MISS",
    "failedCriteria": [
      "timezone is America/New_York"
    ]
  }
}
```

Supported event types:

- `prompt`
- `observation`
- `thought`
- `action`
- `tool_result`
- `call_user`
- `preflight`
- `capture`
- `judge_result`

Supported roles:

- `operator`
- `assistant`
- `tool`
- `system`
- `benchmark`
- `preflight`
- `capture`

Inline base64 screenshots are rejected. Use artifact references such as
`screenshotRef` or `artifactRefs` instead.

## P1 Raw Transcript Bundle Contract

For future real runs, the raw transcript bundle is the raw trace JSON plus
external screenshot/artifact files referenced from that JSON. `action`,
`tool_result`, and `capture` events must include at least one external
reference: either `artifactRefs` or `screenshotRef`.

`artifactRefs` must be a non-empty array of non-empty strings when present.
`screenshotRef` must be a non-empty string when present. Both fields are
bundle-relative references, not arbitrary filesystem paths or URLs.

Allowed refs use normal relative path segments such as
`tasks/settings-toggle/raw/action-raw-4.json` or
`tasks/settings-toggle/screenshots/action-raw-4.png`. Refs must not contain path
traversal (`..`), absolute paths, URL schemes, URL credentials, control
characters, inline `data:image/...` payloads, or base64-looking image payloads.
Inline base64 screenshots or image payloads are rejected so the JSON remains
reviewable and portable.

`validateRawUitarsTraceBundle(rawTrace, { bundleRoot })` adds entity checks on
top of schema validation. Every `artifactRefs` and `screenshotRef` entry must
resolve to an existing regular file under the bundle root. Screenshot refs must
use `.png`, `.jpg`, `.jpeg`, or `.webp` file names. Duplicate external refs are
rejected across the whole trace so stale or collapsed evidence does not
silently pass as a preserved bundle. Symlinks and parent-directory symlink
escapes are rejected by resolving referenced files against the real bundle root.

Historical derived step traces cannot be backfilled into this raw transcript
schema unless the original raw UI-TARS transcript and referenced screenshots or
artifacts exist. The expanded round step traces remain derived timeline
attributions, not raw UI-TARS action logs.

## P1.5 Native Task-Action Transcript Smoke

`npm run validate:native-task-action-transcript` validates the P1.5 preservation
smoke under `experiments/2026-05-29-p1-native-action-transcript-smoke/`.

This smoke distinguishes four states:

- `native_task_actions_captured`: a preserved native raw UI-TARS transcript
  passes schema validation and contains at least one task-execution action such
  as `click`, `type`, `fill`, `select`, `press`, `submit`, `drag`, `check`, or
  `uncheck`.
- `visible_transcript_only`: a preserved transcript exists, but it does not
  contain native task-execution actions.
- `invalid_native_transcript`: a candidate native transcript exists but does
  not satisfy the raw UI-TARS transcript schema.
- `missing_native_transcript`: no native task-action transcript was preserved
  for the task.

The P1.5 smoke is a preservation and honesty check, not automated model
scoring. It must not reconstruct native task-action events from capture,
run-export, trace, screenshots, or final-state artifacts.

## P2 Native Action Evidence Gate

`npm run validate:native-action-evidence-gate` runs the P2 gate in
`--allow-missing` mode. This keeps repository validation green before a fresh P2
sample exists, while still reporting `missing_experiment` clearly.

Use the stricter command when a new raw transcript sample is expected:

```sh
npm run validate:p2-native-action-evidence
```

The P2 gate reads
`experiments/2026-05-29-p2-native-action-evidence/summary.json`, follows each
`native_task_actions_captured` task's `rawTracePath`, validates the raw trace
schema, validates the raw bundle's referenced files, and requires at least one
native task-execution action. A missing P2 experiment is not evidence closure;
it is only allowed during the default repo health check.

Strict closure expects these three tasks in the P2 summary:

- `settings-toggle`
- `onboarding-form`
- `ticket-review`

Each expected task must have `transcriptStatus:
native_task_actions_captured` and at least one native task-execution action.
Missing expected tasks fail with:

```text
<taskId>: missing expected task in P2 native action evidence summary
```

The strict gate also accepts explicit CLI flags for ad hoc checks:

```sh
node scripts/validate-native-action-evidence-gate.mjs \
  --require-sample \
  --expected-task-ids settings-toggle,onboarding-form,ticket-review \
  --min-native-task-actions-per-task 1
```

The default aggregate `npm run validate` intentionally does not include this
strict closure command. It validates the tooling and allows an absent P2 sample;
`validate:p2-native-action-evidence` is the evidence-closure gate for fresh
three-task native transcript samples.

For the live collection procedure, use [P2 Native Evidence Live
Collection](p2-native-evidence-live-collection.md). After the live collection
phase, `npm run validate:p2-native-action-evidence` is expected to pass because
all three expected P2 tasks have sanitized, run-scoped native action-event
transcripts.
The guarded live path uses split CDP endpoints: the child Chrome endpoint for
target safety checks and the UI-TARS Electron renderer endpoint for transcript
state export.

## P2 Native Transcript Export

Offline export converts a UI-TARS renderer state snapshot shaped like
`window.zustandBridge.getState()` into the raw trace bundle:

```sh
npm run uitars:export-native-transcript -- \
  --task settings-toggle \
  --task-title "Update workspace settings" \
  --experiment-dir experiments/2026-05-29-p2-native-action-evidence \
  --state-json /path/to/zustand-state.json \
  --final-capture experiments/2026-05-29-p2-native-action-evidence/tasks/settings-toggle/capture/capture.json \
  --prompt-file experiments/2026-05-29-p2-native-action-evidence/preflight-context/tasks/settings-toggle/prompt.txt
```

The exporter writes:

```text
tasks/{taskId}/raw-trace.json
tasks/{taskId}/raw/*.json
```

Artifact references inside `raw-trace.json` are relative to the experiment
directory and must satisfy `validateRawUitarsTraceBundle()`. The raw trace
source is `ui-tars-raw-transcript`, and the schema version is
`RAW_UITARS_TRACE_SCHEMA_VERSION`.

The exporter records screenshot presence and sanitized metadata only. It does
not write inline screenshot/base64 payloads, `webSocketDebuggerUrl`,
`ws://.../devtools` values, cookies, tokens, authorization headers, passwords,
SSH paths, or non-local IP/connection details.

`--final-capture` should point to the task's `capture.json`; its
`evaluation.success`, `evaluation.score`, and failed criteria become
`rawTrace.final`. When omitted, the exporter uses a conservative placeholder
(`FINAL_CAPTURE_NOT_PROVIDED`) so the bundle remains honest but not closed.

The CLI supports live renderer collection with `--renderer-cdp-url`,
`--cdp-url`, or `--discover-local-uitars` when `--state-json` is omitted. For
guarded collection, pass `--guard-cdp-url`, `--renderer-cdp-url`, and
`--require-live-guard` together so target safety and renderer transcript export
come from explicit endpoints. Live export requires the matching operator prompt
to be present in the UI-TARS renderer state and exports only messages at or
after that prompt boundary; unbounded stale renderer messages are rejected.
Live export also requires the UI-TARS renderer to be reachable and expose a
supported renderer state store such as `window.zustandBridge.getState()`; do
not paste or persist CDP websocket URLs in artifacts or docs.

For native action evidence gates, accepted action events must stay inside the
task run scope: at or after the operator prompt boundary, and before any final
`capture` or `judge_result` boundary when those final events are present.

## P2 Evidence Pack Analyzer

`npm run analyze:p2-native-action-evidence` reads
`tasks/<taskId>/raw-trace.json` for the three P2 tasks, validates each raw
bundle, compares raw final evaluation with `tasks/<taskId>/capture/capture.json`
when present, and writes:

```text
summary.json
report.md
run-log.md
```

The summary keeps the existing gate contract:

- `schemaVersion: 1`
- `source: ui-tars-native-task-action-transcript-smoke`
- status metrics for `native_task_actions_captured`,
  `visible_transcript_only`, `invalid_native_transcript`, and
  `missing_native_transcript`
- per-task `rawTracePath`, `taskActionCount`, and `taskActionNames`

If a task lacks a raw native transcript, the analyzer records
`missing_native_transcript`. It must not fabricate `onboarding-form` or
`ticket-review` action evidence from step traces, capture bundles, run exports,
screenshots, or final state.

## CLI

```sh
npm run uitars:ingest-raw-trace -- \
  --input experiments/raw/settings-toggle.json \
  --output experiments/round/step-traces/settings-toggle.json
```

Validation:

```sh
npm run validate:raw-uitars-trace
```

The output is a normal step trace and is validated by
`npm run validate:step-traces` once linked from the round taxonomy.
