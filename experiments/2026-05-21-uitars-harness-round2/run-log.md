# UI-TARS Harness Round 2

Date: 2026-05-21

Command:

```sh
npm run uitars:harness -- --output experiments/2026-05-21-uitars-harness-round2 --tasks all --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target
```

This round enabled target preparation before dry-run preflight. The harness used
safe local UI-TARS CDP discovery, navigated benchmark targets to the requested
task URL, then verified each task with dry-run preflight.

## Results

| Task | Target prepare | Dry-run preflight | Reason |
| --- | --- | --- | --- |
| `onboarding-form` | `fixed` | `ready` | Benchmark target was present after preparation. |
| `catalog-filter` | `fixed` | `ready` | Benchmark target was present after preparation. |
| `settings-toggle` | `fixed` | `ready` | Benchmark target was present after preparation. |
| `ticket-review` | `fixed` | `ready` | Benchmark target was present after preparation. |

## Round 1 Comparison

| Metric | Round 1 | Round 2 |
| --- | ---: | ---: |
| Total tasks | 4 | 4 |
| Ready after dry-run preflight | 1 | 4 |
| Blocked after dry-run preflight | 3 | 0 |

## Interpretation

Target preparation resolved the task-URL readiness blocker observed in round 1.
The benchmark can now prepare UI-TARS for each task before asking the agent to
act. The next project step is real execution capture: run UI-TARS on each ready
task, record actions and timing, then evaluate final benchmark state.

## Validation

- `npm run validate`
- `npm run smoke`
- Harness output schema check for all target-preparation reports, preflight
  reports, and run exports
