# P1.5 Native Task-Action Transcript Smoke

Generated: 2026-05-29T03:41:45.930Z

## Scope

Measures native task-action transcript preservation for three prepared UI-TARS tasks; this is not automated model scoring.

Preflight context: experiments/2026-05-29-p1-native-action-transcript-smoke/preflight-context/metadata.json

## Metrics

- native_task_actions_captured: 0
- visible_transcript_only: 0
- invalid_native_transcript: 0
- missing_native_transcript: 3

## Tasks

| Task | Preflight | Transcript status | Task actions | Native raw trace |
| --- | --- | --- | ---: | --- |
| onboarding-form | ready | missing_native_transcript | 0 | none |
| settings-toggle | ready | missing_native_transcript | 0 | none |
| pagination-review | ready | missing_native_transcript | 0 | none |

## Policy

Native task-action coverage requires a preserved native raw UI-TARS transcript that passes schema validation and contains at least one task-execution action: click, type, fill, select, press, submit, drag, check, uncheck.

Capture, run-export, trace, screenshots, and final-state artifacts are not used to reconstruct native action events.
