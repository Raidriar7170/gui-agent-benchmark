# UI-TARS Harness Round 1

Date: 2026-05-21

Command:

```sh
npm run uitars:harness -- --output experiments/2026-05-21-uitars-harness-round1 --tasks all --base-url http://127.0.0.1:4173 --discover-local-uitars
```

This round used the benchmark harness in dry-run preflight mode. It did not enable
`--preflight-fix`, so the run records target-binding readiness without navigating
UI-TARS browser targets.

## Results

| Task | Status | Reason |
| --- | --- | --- |
| `onboarding-form` | `ready` | Benchmark target was already present. |
| `catalog-filter` | `blocked` | No matching benchmark target or supported search target was found. |
| `settings-toggle` | `blocked` | No matching benchmark target or supported search target was found. |
| `ticket-review` | `blocked` | No matching benchmark target or supported search target was found. |

## Interpretation

The harness correctly avoided treating the open `onboarding-form` benchmark page
as ready for other tasks. The next experiment should explicitly prepare or
navigate the UI-TARS browser target for each task before asking UI-TARS to act.

## Validation

- `npm run validate`
- `npm run smoke`
- Harness output schema check for all preflight reports and run exports
