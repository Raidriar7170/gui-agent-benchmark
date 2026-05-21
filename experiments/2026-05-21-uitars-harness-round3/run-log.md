# UI-TARS Harness Round 3 Run Log

## Time

- Run date: 2026-05-21
- Log written: 2026-05-21 17:16:51 CST (+0800)
- Harness metadata `createdAt`: 2026-05-21T09:14:33.353Z

## Required start checks

```console
$ pwd
/Users/raidriar/Documents/agent-worktrees/round3-experiment

$ git status --short

$ git branch --show-current
codex/round3-experiment
```

`git status --short` was empty at start.

## Environment assumptions

- Worktree: `/Users/raidriar/Documents/agent-worktrees/round3-experiment`
- Branch: `codex/round3-experiment`
- Benchmark server: `http://127.0.0.1:4173`
- No UI-TARS storage/config/logs/IndexedDB/localStorage were read.
- No UI-TARS GUI operations were performed.
- No Chrome/UI-TARS processes were killed.
- No development-machine GPU operations were performed.
- CDP access was limited to the project scripts' safe local discovery and designed harness/capture behavior.

## Commands

```console
$ npm run uitars:harness -- --output experiments/2026-05-21-uitars-harness-round3 --tasks all --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target
```

Result: exit 0. Generated `metadata.json` plus per-task `target-prepare.json`, `preflight-dry-run.json`, `trace.json`, `run-export.json`, and `prompt.txt`.

```console
$ npm run uitars:capture -- --task onboarding-form --output experiments/2026-05-21-uitars-harness-round3/capture-probe --base-url http://127.0.0.1:4173 --discover-local-uitars
```

Result: exit 1. Probe failed safely with:

```text
blocked: No exact benchmark target was found for the requested benchmark URL.
```

No files were written under `experiments/2026-05-21-uitars-harness-round3/capture-probe`.

## Harness summary

`metadata.json` reported 4 total tasks and 0 blocked tasks. All tasks were `ready` at metadata level, with `targetPrepareStatus: fixed` and `dryRunStatus: ready`.

| Task | Metadata | Target prepare | Dry run | Prepare targets before | Prepare targets after | Exact targets after prepare | Preflight targets before | Warnings |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| onboarding-form | ready | fixed | ready | 4 | 4 | 4 | 4 | target prepare: 4 navigation responses failed, but exact benchmark target became visible; preflight: found 4 benchmark page targets |
| catalog-filter | ready | fixed | ready | 4 | 4 | 4 | 4 | target prepare: 4 navigation responses failed, but exact benchmark target became visible; preflight: found 4 benchmark page targets |
| settings-toggle | ready | fixed | ready | 4 | 4 | 4 | 4 | target prepare: 4 navigation responses failed, but exact benchmark target became visible; preflight: found 4 benchmark page targets |
| ticket-review | ready | fixed | ready | 4 | 4 | 4 | 4 | target prepare: 4 navigation responses failed, but exact benchmark target became visible; preflight: found 4 benchmark page targets |

## Capture decision

Real capture was not attempted because each task had 4 exact benchmark targets after target preparation, not a single exact benchmark target. Automatically choosing among those targets would violate the round3 strategy.

A single safe capture probe was attempted with `npm run uitars:capture` for `onboarding-form`. It failed before artifact creation with `blocked: No exact benchmark target was found for the requested benchmark URL.` This is consistent with the post-harness browser state no longer presenting a single usable exact target for that task.

The capture probe does not corroborate the 4-target ambiguity reported by the harness. The capture code would report an ambiguity if it observed multiple exact targets, and the probe did not save a target list. The probe result only proves that, at probe time, capture observed zero exact targets. The browser/CDP target state either changed after the harness run or was not captured by the probe artifacts.

## Validation

```console
$ npm run validate
Task validation passed: 4 tasks, 17 criteria.
Run validation passed: 2 synthetic runs, 1 failure reason bucket.
UI-TARS preflight validation passed for synthetic report.
Benchmark harness validation passed with synthetic no-CDP output.
UI-TARS capture validation passed for synthetic CDP fixtures.
```

Result: exit 0.

```console
$ npm run smoke
Loaded benchmark products 5
Smoke check passed at http://127.0.0.1:55040.
```

Result: exit 0.

```console
$ node scripts/uitars-benchmark-harness.mjs --help
```

Result: exit 0. Help text printed successfully.

```console
$ node scripts/uitars-capture-run.mjs --help
```

Result: exit 0. Help text printed successfully.

```console
$ git diff --check
```

Result: exit 0 with no output.

```console
$ node scripts/validate-uitars-preflight.mjs experiments/2026-05-21-uitars-harness-round3/tasks/onboarding-form/preflight-dry-run.json
UI-TARS preflight validation passed for experiments/2026-05-21-uitars-harness-round3/tasks/onboarding-form/preflight-dry-run.json.
```

Result: exit 0.

```console
$ node scripts/validate-uitars-preflight.mjs experiments/2026-05-21-uitars-harness-round3/tasks/catalog-filter/preflight-dry-run.json
UI-TARS preflight validation passed for experiments/2026-05-21-uitars-harness-round3/tasks/catalog-filter/preflight-dry-run.json.
```

Result: exit 0.

```console
$ node scripts/validate-uitars-preflight.mjs experiments/2026-05-21-uitars-harness-round3/tasks/settings-toggle/preflight-dry-run.json
UI-TARS preflight validation passed for experiments/2026-05-21-uitars-harness-round3/tasks/settings-toggle/preflight-dry-run.json.
```

Result: exit 0.

```console
$ node scripts/validate-uitars-preflight.mjs experiments/2026-05-21-uitars-harness-round3/tasks/ticket-review/preflight-dry-run.json
UI-TARS preflight validation passed for experiments/2026-05-21-uitars-harness-round3/tasks/ticket-review/preflight-dry-run.json.
```

Result: exit 0.

## Next steps

1. Reduce the live UI-TARS/Chrome benchmark target set to exactly one matching page before attempting real capture.
2. Re-run harness with `--prepare-target` and confirm each task has exactly one exact benchmark target.
3. Only then run real capture for task runs; do not select an arbitrary target while multiple exact targets are visible.
