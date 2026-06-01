# P2 Native Action Evidence Pack

Generated: 2026-05-31T13:50:32.595Z

## Scope

P2 native action evidence closure for run-scoped preserved UI-TARS action-event transcripts; not automated model scoring or task success proof.

Expected tasks: settings-toggle, onboarding-form, ticket-review

## Metrics

- native_task_actions_captured: 3
- visible_transcript_only: 0
- invalid_native_transcript: 0
- missing_native_transcript: 0

## Tasks

| Task | Transcript status | Native action events | Action names | Action timestamp range | Raw trace |
| --- | --- | ---: | --- | --- | --- |
| settings-toggle | native_task_actions_captured | 23 | click, type | 2026-05-29T10:18:25.465Z to 2026-05-29T10:21:52.353Z | experiments/2026-05-29-p2-native-action-evidence/tasks/settings-toggle/raw-trace.json |
| onboarding-form | native_task_actions_captured | 1 | press | 2026-05-31T12:32:57.011Z to 2026-05-31T12:32:57.011Z | experiments/2026-05-29-p2-native-action-evidence/tasks/onboarding-form/raw-trace.json |
| ticket-review | native_task_actions_captured | 3 | press, click | 2026-05-31T12:35:43.455Z to 2026-05-31T12:35:57.248Z | experiments/2026-05-29-p2-native-action-evidence/tasks/ticket-review/raw-trace.json |

## Evidence Policy

Only preserved raw UI-TARS transcript bundles can satisfy native action evidence. Missing tasks remain missing; they are not filled from step traces, captures, screenshots, run exports, or final state.
