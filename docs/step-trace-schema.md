# UI-TARS Step Trace Schema

Step traces describe a real UI-TARS task attempt as an ordered timeline. They
sit between raw UI-TARS output and final benchmark capture: enough structure to
explain failures step by step, without reading UI-TARS private storage or logs.

## File Location

For the 2026-05-23 real E2E round:

```text
experiments/2026-05-23-uitars-real-e2e/step-traces/<task-id>.json
```

Each trace is linked from
`experiments/2026-05-23-uitars-real-e2e/failure-taxonomy.json`.

For the expanded 2026-05-25 evidence-chain round:

```text
experiments/2026-05-24-uitars-expanded-real-round/step-traces/<task-id>.json
```

Each expanded trace is linked from
`experiments/2026-05-24-uitars-expanded-real-round/failure-taxonomy.json`.

## Top-Level Shape

```json
{
  "schemaVersion": 1,
  "source": "ui-tars-step-trace",
  "taskId": "settings-toggle",
  "taskTitle": "Update workspace settings",
  "artifactBase": "experiments/2026-05-23-uitars-real-e2e",
  "evidenceLimitations": [
    "Only final benchmark state is machine-captured."
  ],
  "steps": [],
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

## Step Shape

```json
{
  "id": "settings-s07-timezone-unchanged",
  "index": 7,
  "phase": "observation",
  "actor": "ui-tars",
  "type": "dropdown_value_not_changed",
  "summary": "Timezone remained UTC rather than America/New_York.",
  "evidence": {
    "kind": "capture_final_state",
    "references": [
      "experiments/2026-05-23-uitars-real-e2e/tasks/settings-toggle/real-run/capture.json"
    ]
  },
  "stateEvidence": {
    "settings.timezone": "UTC",
    "expected": "America/New_York"
  },
  "relatedStepIds": [
    "settings-s06-toggles-complete"
  ]
}
```

Required fields:

- `id`: stable unique id inside the trace.
- `index`: 1-based contiguous ordering.
- `phase`: one of `environment`, `prompt`, `preflight`, `observation`,
  `action`, `capture`, `evaluation`, or `failure`.
- `actor`: one of `operator`, `ui-tars`, `benchmark`, `preflight`, `capture`,
  `analysis`, or `environment`.
- `type`: specific event type inside the phase.
- `summary`: human-readable step explanation.
- `evidence.kind`: one of `artifact`, `capture_final_state`, `operator_note`,
  `transcript_observation`, `preflight_report`, `finish_gate`, or `derived`.
- `evidence.references`: artifact paths or step ids supporting the step.

Failure attribution steps additionally require `failureCode`.

## Evidence Policy

Step traces must label evidence strength explicitly:

- Use `capture_final_state` only for data found in `capture.json`.
- Use `preflight_report` only for target preparation or preflight artifacts.
- Use `finish_gate` only for finish gate reports.
- Use `operator_note` for observations made during the live run but not
  machine-captured as structured UI-TARS events.
- Use `derived` only when a step explains how earlier evidence supports a
  failure code.

This prevents a reconstructed timeline from pretending to be a raw UI-TARS
event log.

## Validation

Run:

```sh
npm run validate:step-traces
```

The validator checks:

- schema version and source
- ordered, contiguous step indexes
- valid phases, actors, and evidence kinds
- at least one failure attribution step per trace
- one trace for each real task
- taxonomy `timelineAttribution` links point to real step ids
- taxonomy primary failure codes match the trace final failure codes
