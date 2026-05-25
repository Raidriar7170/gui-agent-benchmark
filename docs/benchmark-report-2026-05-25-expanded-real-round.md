# UI-TARS Expanded Real Round Report

Date: 2026-05-25  
Experiment: `experiments/2026-05-24-uitars-expanded-real-round`  
Model endpoint: `http://127.0.0.1:18001/v1` via remote proxy port `8001`  
Model: `ByteDance-Seed/UI-TARS-1.5-7B`  
Operator: UI-TARS Local Browser Operator  
Status: complete expanded real round

## Executive Summary

The expanded round captured all 10 planned task attempts. The run had 0 full
successes and an average score of 0.2060. This is strong evidence that the
original four-task failures generalize to richer GUI primitives.

The strongest project finding is that environment reachability and target
binding are separable from model interaction quality. The target-binding layer
has been hardened to create, activate, and isolate the benchmark tab, while the
captured task failures are concentrated in interaction primitives: dropdown
value commit, row selection, modal confirmation, pagination, table sorting,
multi-select submission, validation recovery, and upload form completion.

## Current Evidence

Summary artifact:
`experiments/2026-05-24-uitars-expanded-real-round/real-run-summary.json`.

Evidence-chain artifacts:

- Expanded failure taxonomy:
  `experiments/2026-05-24-uitars-expanded-real-round/failure-taxonomy.json`.
- Expanded step traces:
  `experiments/2026-05-24-uitars-expanded-real-round/step-traces/<task-id>.json`.
- Per-task capture bundles:
  `experiments/2026-05-24-uitars-expanded-real-round/tasks/<task-id>/real-run/{capture.json,trace.json,run-export.json}`.
- Full finish gate:
  `artifacts/finish-gate/2026-05-25-expanded-real-round.json`.

| Metric | Value |
| --- | ---: |
| Planned tasks | 10 |
| Captured tasks | 10 |
| Missing captures | 0 |
| Successful captures | 0 |
| Average score across captured tasks | 0.2060 |

| Task | Status | Score | Main failed primitive |
| --- | --- | ---: | --- |
| `onboarding-form` | captured | 0.33 | Text-entry continuation and submit |
| `catalog-filter` | captured | 0 | Filter/search to selected item commit |
| `settings-toggle` | captured | 0.75 | Dropdown value commit |
| `ticket-review` | captured | 0 | Table search/selection/review commit |
| `modal-confirmation` | captured | 0 | Modal open and confirm sequence |
| `pagination-review` | captured | 0.33 | Page navigation and row action |
| `sortable-inventory` | captured | 0 | Sort commit and row selection |
| `multi-select-approvals` | captured | 0 | Multi-select and submit |
| `validation-error-recovery` | captured | 0.4 | Validation recovery after error |
| `file-upload-request` | captured | 0.25 | Upload form dropdown and submit |

## Primitive Difficulty

Hardest primitives in this round:

- Table/list commit primitives: `catalog-filter`, `ticket-review`, and
  `sortable-inventory` all failed to leave the requested row/item selected.
- State-changing compound controls: modal confirmation, pagination, sorting,
  and multi-select all scored 0 or near 0, suggesting the model does not
  reliably translate a visible target into committed application state.
- Dropdowns: `settings-toggle` completed the boolean toggles but left timezone
  at `UTC`; `file-upload-request` attached the file but got stuck on the
  category dropdown. Dropdown value commit is the clearest repeated primitive
  failure.
- Multi-step form flows: `onboarding-form` and `validation-error-recovery`
  show partial text entry, but the model stops before full field coverage and
  final submit.

Easiest primitive in this round:

- Simple boolean toggles. `settings-toggle` correctly set weekly digest,
  autosave, and analytics sharing, scoring 0.75 before failing on the timezone
  dropdown.

## Continuity With Original Four Tasks

The original four-task repeated baseline already showed failures in text-entry
continuation, dropdown commit, search/table selection, and active browser
target binding. The expanded round preserves those patterns:

- `onboarding-form` remains a text-entry continuation failure.
- `settings-toggle` remains a dropdown value failure.
- `catalog-filter` and `ticket-review` remain search/selection commit failures.

The expanded tasks add stronger evidence that these are not task-specific
quirks:

- `modal-confirmation` extends selection failures into dialog workflows.
- `pagination-review` extends row-action failures across paginated state.
- `sortable-inventory` separates sorting the table from selecting the target
  item.
- `multi-select-approvals` adds set selection and bulk-submit state.
- `validation-error-recovery` adds deliberate error creation followed by form
  recovery and successful submit.
- `file-upload-request` adds upload-like state and shows that attach can
  succeed while the following dropdown/description/submit sequence still fails.

## Target Binding Impact

The preflight layer now addresses the target-binding problems that previously
required manual recovery:

- Empty target lists can be fixed by creating a new benchmark page target.
- Correct benchmark targets are activated after creation or isolation.
- Stale UI-TARS child Chrome processes are filtered by probing `/json/version`.
- Chrome error pages are not treated as valid benchmark targets.
- Search-page and wrong-task targets can be isolated away from the keeper tab.

This means the remaining captured failures should be interpreted primarily as
operator/model interaction failures when the preflight report is ready or
fixed. The `file-upload-request` run also demonstrates the value of the
binding fix: UI-TARS initially observed Google, preflight navigated the search
target to the benchmark URL, and the real capture proceeded from the correct
task page.

## Evidence Limitations

The expanded step traces are derived timeline attributions. They link
preflight reports, operator prompts, final capture state, benchmark evaluation,
and the finish gate, but they are not raw UI-TARS action transcripts. The
project should preserve raw UI-TARS action-level logs in future repeated rounds
before making timing, action-count, or low-level policy claims.

## Coverage Assessment

For a project demo, the expanded set is now strong enough to demonstrate a
reusable GUI-agent benchmark harness. It covers forms, filters, settings,
tables, modal dialogs, pagination, sorting, multi-select, validation recovery,
and upload-like state.

For a paper-style narrative, the current evidence supports a qualitative case
study and failure taxonomy, but not a leaderboard-style conclusion. The next
evidence upgrades are:

- Repeat the expanded 10-task round across at least three seeds/runs.
- Preserve raw UI-TARS action traces for every expanded task, not only final
  benchmark state.
- Report confidence intervals or per-task variance after repeated runs.
