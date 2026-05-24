# UI-TARS Repeated Baseline Report

Date: 2026-05-24  
Experiment: `experiments/2026-05-24-uitars-repeated-baseline`  
Model endpoint: `http://127.0.0.1:18001/v1` via remote proxy port `8001`  
Model: `ByteDance-Seed/UI-TARS-1.5-7B`  
Operator: UI-TARS Local Browser Operator

## Executive Summary

The project now has a three-round repeated baseline over the original four
UI-TARS tasks. All 12 task attempts were captured. Two attempts fully
succeeded, for an overall success rate of 0.1667 and an average score of
0.3892.

The main project gap is no longer basic environment reachability. The repeated
baseline shows that the benchmark can capture real UI-TARS behavior across
rounds, and that the remaining failures are concentrated in GUI primitives:
text-entry continuation, dropdown value selection, row selection/commit, and
active browser target binding.

## Inputs

| Round | Summary | Captured | Success | Average score |
| --- | --- | ---: | ---: | ---: |
| 1 | `experiments/2026-05-23-uitars-real-e2e/real-run-summary.json` | 4/4 | 0 | 0.23 |
| 2 | `experiments/2026-05-24-uitars-repeated-baseline/round-2/real-run-summary.json` | 4/4 | 1 | 0.4375 |
| 3 | `experiments/2026-05-24-uitars-repeated-baseline/round-3/real-run-summary.json` | 4/4 | 1 | 0.5 |

Aggregate artifact:
`experiments/2026-05-24-uitars-repeated-baseline/summary.json`.

## Aggregate Results

| Metric | Value |
| --- | ---: |
| Rounds | 3 |
| Task attempts | 12 |
| Captured attempts | 12 |
| Successful attempts | 2 |
| Success rate | 0.1667 |
| Average score | 0.3892 |
| Score variance | 0.1437 |

Finish gate:
`artifacts/finish-gate/2026-05-24-repeated-baseline.json` reports
`localReady = true`, `integrationReady = true`, and `ready = true` using the
Volcano remote SSH configuration and the local `18001 -> remote 8001` model
tunnel.

| Task | Scores | Pass rate | Mean score | Primary repeated failure |
| --- | --- | ---: | ---: | --- |
| `catalog-filter` | 0, 1, 1 | 0.6667 | 0.6667 | First-round selection commit miss, then stable success. |
| `settings-toggle` | 0.75, 0.75, 0.5 | 0 | 0.6667 | Dropdown value miss on timezone. |
| `onboarding-form` | 0.17, 0, 0.17 | 0 | 0.1133 | Text entry stalls before full form completion. |
| `ticket-review` | 0, 0, 0.33 | 0 | 0.11 | Table search/selection commit miss. |

## Failure Findings

`catalog-filter` is the strongest sign that the environment and benchmark are
usable: it failed in round 1 but succeeded in rounds 2 and 3 after the
preflight-assisted workflow was standardized.

`settings-toggle` is the most stable partial success. Boolean controls are
usually completed, but the timezone select remains at `UTC` or another
incorrect value. This makes `ACT-DROPDOWN-VALUE-MISS` the clearest primitive
failure.

`onboarding-form` remains weak across all rounds. The model can sometimes enter
the first field, but it does not reliably continue through email, role, date,
notes, submit, and evaluation. This supports `ACT-TEXT-ENTRY-STALL` plus
`TASK-PARTIAL-PLAN`.

`ticket-review` improved slightly in round 3: the final state included
`query = "INC-2048"`, so the model identified the right row, but
`selectedTicketId` stayed empty and `INC-2048.reviewed` stayed false. This
separates target recognition from committed UI state changes.

## Operator Binding Findings

The repeated run exposed two binding problems that are now part of the
taxonomy:

- `BIND-EMPTY-TARGET`: the UI-TARS child Chrome CDP endpoint can be alive while
  `/json/list` returns no page targets.
- `BIND-ACTIVE-TARGET-MISMATCH`: a correct benchmark target can exist while the
  operator still observes an older Google target.

These are not task successes or failures by themselves, but they affect run
quality and should be handled by preflight before future model comparisons.

## Project Completion Impact

Completed since the first report:

- Raw UI-TARS action/observation trace ingestion and validation.
- Three-round repeated baseline with 12 captured real attempts.
- Expanded task catalog to 10 tasks covering modal, pagination, sort,
  multi-select, validation error, and file upload scenarios.
- Failure taxonomy and step-trace docs.
- Repeated baseline aggregation script and validation.

Remaining before calling the project complete:

- Harden preflight for empty target lists, stale targets, and active target
  mismatch.
- Add at least one real round over the expanded 8-12 task set.
- Commit the evidence chain and publish a reviewable PR.

## Reproduction

Generate the repeated summary:

```sh
npm run uitars:repeated-baseline -- \
  --rounds experiments/2026-05-23-uitars-real-e2e/real-run-summary.json,experiments/2026-05-24-uitars-repeated-baseline/round-2/real-run-summary.json,experiments/2026-05-24-uitars-repeated-baseline/round-3/real-run-summary.json \
  --output experiments/2026-05-24-uitars-repeated-baseline/summary.json \
  --output-dir experiments/2026-05-24-uitars-repeated-baseline
```

Validate repeated baseline tooling:

```sh
npm run validate:repeated-baseline
```
