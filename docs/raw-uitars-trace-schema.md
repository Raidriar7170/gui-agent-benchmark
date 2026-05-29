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

Historical derived step traces cannot be backfilled into this raw transcript
schema unless the original raw UI-TARS transcript and referenced screenshots or
artifacts exist. The expanded round step traces remain derived timeline
attributions, not raw UI-TARS action logs.

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
