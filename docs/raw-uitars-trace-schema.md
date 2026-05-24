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
