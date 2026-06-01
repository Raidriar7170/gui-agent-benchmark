# UI-TARS Real E2E Benchmark Report

Date: 2026-05-23  
Experiment: `experiments/2026-05-23-uitars-real-e2e`  
Model endpoint: `http://127.0.0.1:18001/v1` via remote proxy port `8001`  
Model: `ByteDance-Seed/UI-TARS-1.5-7B`  
Operator: UI-TARS Local Browser Operator

## Executive Summary

This round proves the benchmark can run a real UI-TARS browser/model loop and
produce reproducible capture artifacts. It does not yet prove task competence:
all 4 tasks were captured, 0 tasks fully succeeded, and the average score was
0.23.

The current blocker is not remote server availability. The full finish gate
passed after the local SSH tunnel was corrected to point at the remote guard
proxy on port `8001`. The remaining gap is UI-TARS interaction reliability on
basic GUI primitives: text input continuation, product/ticket selection commit,
dropdown value changes, and table/list search.

## Methodology

The round used a preflight-assisted real UI-TARS workflow:

1. Start the local benchmark server at `http://127.0.0.1:4173`.
2. Bind the model tunnel to the remote proxy: `18001 -> remote 8001`.
3. Run `npm run check:tunnel` and the full finish gate.
4. For each task, start a UI-TARS Local Browser Operator chat.
5. Send a guard prompt that forces `call_user()` if UI-TARS lands on Google or
   any non-benchmark page.
6. Use the benchmark preflight to rebind the UI-TARS-owned browser target to the
   exact task URL.
7. Let UI-TARS continue without manual task help.
8. Capture final benchmark state with `npm run uitars:capture`.

The benchmark scripts did not click inside UI-TARS, inspect UI-TARS private
storage, read UI-TARS IndexedDB, complete task actions for the model, or modify
remote project files.

## Environment Readiness

| Gate | Result | Evidence |
| --- | --- | --- |
| Local validation | Passed | `npm run validate` |
| Static smoke | Passed | `npm run smoke` |
| UI-TARS config check | Passed | `node scripts/check-local.mjs` |
| Model tunnel | Passed | `/v1/models` plus non-stream high `max_tokens` chat probe |
| Remote read-only health | Passed | `node scripts/check-remote.mjs` |

Finish gate report:
`artifacts/finish-gate/2026-05-23-real-e2e.json`.

Important resolved issue: a tunnel to remote `8000` can pass `/v1/models` but
fails UI-TARS chat requests with a context-length error. This round uses remote
`8001`, the proxy expected by the benchmark finish gate.

## Results

| Task | Success | Score | Primary failure | Capture |
| --- | --- | ---: | --- | --- |
| `onboarding-form` | No | 0.17 | `ACT-TEXT-ENTRY-STALL` | `tasks/onboarding-form/real-run-attempt2/capture.json` |
| `catalog-filter` | No | 0.00 | `ACT-SELECTION-COMMIT-MISS` | `tasks/catalog-filter/real-run/capture.json` |
| `settings-toggle` | No | 0.75 | `ACT-DROPDOWN-VALUE-MISS` | `tasks/settings-toggle/real-run/capture.json` |
| `ticket-review` | No | 0.00 | `ACT-TABLE-SEARCH-LOOP` | `tasks/ticket-review/real-run/capture.json` |

Aggregate:

- Captured tasks: 4/4
- Successful tasks: 0/4
- Average score: 0.23
- Best task: `settings-toggle`, score 0.75
- Worst tasks: `catalog-filter` and `ticket-review`, score 0.00

## Task Findings

### onboarding-form

Final score was 0.17. The model reached the benchmark page and filled
`fullName = "Maya Ortiz"`, but left `email`, `role`, `startDate`, and `notes`
blank and did not submit the form.

Classification:

- Primary: `ACT-TEXT-ENTRY-STALL`
- Secondary: `TASK-PARTIAL-PLAN`

This is a high-value failure because it isolates a basic text-entry continuation
problem after the environment and target binding had already been repaired.

### catalog-filter

Final score was 0. The model changed catalog state to `search = "office"` and
`inStockOnly = true`, but `selectedSku` remained empty.

Classification:

- Primary: `ACT-SELECTION-COMMIT-MISS`
- Secondary: `TASK-PARTIAL-PLAN`

The task did not fail because the benchmark could not load. It failed because
the model did not commit the expected product selection.

### settings-toggle

Final score was 0.75. The model enabled weekly digest, kept autosave enabled,
and disabled product analytics sharing, but left `timezone = "UTC"` instead of
`America/New_York`.

Classification:

- Primary: `ACT-DROPDOWN-VALUE-MISS`
- Secondary: `TASK-PARTIAL-PLAN`

This is the clearest partial success in the round. It suggests checkbox/toggle
interactions are much more reliable than select/dropdown interactions.

### ticket-review

Final score was 0. The model reasoned about `Priya Shah` and `INC-2048` in the
UI-TARS transcript, but final benchmark state had `query = ""`,
`selectedTicketId = ""`, and `INC-2048.reviewed = false`.

Classification:

- Primary: `ACT-TABLE-SEARCH-LOOP`
- Secondary: `ACT-SELECTION-COMMIT-MISS`

This task highlights list/table grounding and commit failures. The model could
describe the right target but did not convert that recognition into benchmark
state changes.

## Failure Distribution

Primary failures:

| Failure code | Count | Tasks |
| --- | ---: | --- |
| `ACT-TEXT-ENTRY-STALL` | 1 | `onboarding-form` |
| `ACT-SELECTION-COMMIT-MISS` | 1 | `catalog-filter` |
| `ACT-DROPDOWN-VALUE-MISS` | 1 | `settings-toggle` |
| `ACT-TABLE-SEARCH-LOOP` | 1 | `ticket-review` |

Secondary failures:

| Failure code | Count | Meaning |
| --- | ---: | --- |
| `TASK-PARTIAL-PLAN` | 3 | Relevant actions occurred, but required completion criteria remained unmet. |
| `ACT-SELECTION-COMMIT-MISS` | 1 | Ticket target was never committed as selected/reviewed. |

See `docs/failure-taxonomy.md` for definitions,
`docs/step-trace-schema.md` for the timeline schema, and
`experiments/2026-05-23-uitars-real-e2e/failure-taxonomy.json` for the
machine-readable task mapping.

## Timeline Attribution

Each task now has a step-level reconstructed trace under
`experiments/2026-05-23-uitars-real-e2e/step-traces/`. These traces separate
machine-captured final state from operator observations and derived failure
attribution, so the report does not overclaim raw UI-TARS telemetry.

| Task | Key timeline evidence | Primary attribution |
| --- | --- | --- |
| `onboarding-form` | `onboarding-s06-name-entered` -> `onboarding-s07-email-stall` -> `onboarding-s10-failure` | UI-TARS entered `fullName` but stalled before email and later fields. |
| `catalog-filter` | `catalog-s06-filter-search` -> `catalog-s07-selection-missing` -> `catalog-s10-failure` | UI-TARS changed filters but left `selectedSku` empty. |
| `settings-toggle` | `settings-s06-toggles-complete` -> `settings-s07-timezone-unchanged` -> `settings-s10-failure` | UI-TARS completed boolean controls but left timezone at `UTC`. |
| `ticket-review` | `ticket-s06-target-reasoned` -> `ticket-s07-table-loop` -> `ticket-s10-failure` | UI-TARS reasoned about `INC-2048` but committed no query, selection, or reviewed state. |

This upgrades the failure taxonomy from final-state-only attribution to
timeline-backed attribution. The validation command checks that each taxonomy
entry links to real trace step ids:

```sh
npm run validate:step-traces
```

## Gap To A Complete Project

The project now has a real benchmark loop, reproducible target preparation,
capture artifacts, finish gate, and a reportable failure taxonomy. The remaining
work is to improve benchmark depth and diagnostic resolution:

1. Add action/observation trace ingestion from UI-TARS so failures can be
   explained step-by-step instead of only from final state.
2. Run 3-5 repeated rounds to report mean score, variance, and per-task pass
   rate.
3. Expand from 4 tasks to 8-12 tasks covering modal dialogs, pagination,
   sorting, multi-select, file upload, and validation errors.
4. Add a model comparison table once at least two model/operator configurations
   can run the same protocol.

## Reproduction

Generate or refresh the round artifacts:

```sh
npm run uitars:real-round -- \
  --output experiments/2026-05-23-uitars-real-e2e \
  --tasks all \
  --base-url http://127.0.0.1:4173 \
  --discover-local-uitars
```

Validate the project and environment:

```sh
npm run validate
UI_TARS_REMOTE_KEY=~/.ssh/your_remote_key \
UI_TARS_REMOTE_HOST=your-remote-host \
UI_TARS_REMOTE_PORT=22 \
UI_TARS_REMOTE_USER=your-remote-user \
npm run check:finish -- --json --output artifacts/finish-gate/2026-05-23-real-e2e.json
```
