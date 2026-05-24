# Repeated Baseline

Repeated baseline summarizes at least three real UI-TARS rounds over the same
task set. It reports stability rather than only a single-run score.

## Current 2026-05-24 Baseline

Current artifact:
`experiments/2026-05-24-uitars-repeated-baseline/summary.json`.

Inputs:

- Round 1: `experiments/2026-05-23-uitars-real-e2e/real-run-summary.json`
- Round 2:
  `experiments/2026-05-24-uitars-repeated-baseline/round-2/real-run-summary.json`
- Round 3:
  `experiments/2026-05-24-uitars-repeated-baseline/round-3/real-run-summary.json`

Headline results:

| Metric | Value |
| --- | ---: |
| Rounds | 3 |
| Task attempts | 12 |
| Captured attempts | 12 |
| Successful attempts | 2 |
| Overall success rate | 0.1667 |
| Overall average score | 0.3892 |
| Overall score variance | 0.1437 |

Per-task stability:

| Task | Scores | Pass rate | Mean score | Interpretation |
| --- | --- | ---: | ---: | --- |
| `catalog-filter` | 0, 1, 1 | 0.6667 | 0.6667 | Most recoverable after target preparation; selection can succeed. |
| `settings-toggle` | 0.75, 0.75, 0.5 | 0 | 0.6667 | Toggle controls are reliable, timezone dropdown remains the blocker. |
| `onboarding-form` | 0.17, 0, 0.17 | 0 | 0.1133 | Text entry and form completion remain unstable. |
| `ticket-review` | 0, 0, 0.33 | 0 | 0.11 | Search/query can partially succeed, but row selection and review commit fail. |

The repeated baseline improves the project from a one-off demo into a
stability measurement: `catalog-filter` shows recoverable success, while
`settings-toggle`, `onboarding-form`, and `ticket-review` expose persistent
primitive failures across runs.

## Inputs

Each input is a `real-run-summary.json` produced by:

```sh
npm run uitars:real-round -- \
  --output experiments/<round-dir> \
  --tasks all \
  --base-url http://127.0.0.1:4173 \
  --discover-local-uitars
```

## Summary Command

```sh
npm run uitars:repeated-baseline -- \
  --rounds experiments/round-1/real-run-summary.json,experiments/round-2/real-run-summary.json,experiments/round-3/real-run-summary.json \
  --output experiments/repeated-baseline/summary.json \
  --output-dir experiments/repeated-baseline
```

The summary includes:

- `roundCount`
- `totalTaskAttempts`
- overall average score
- overall score variance
- overall success rate
- per-task mean score
- per-task score variance
- per-task pass rate
- failed criteria distribution

Validation:

```sh
npm run validate:repeated-baseline
```

The aggregator requires at least three rounds. It does not fabricate missing
captures or task attempts.
