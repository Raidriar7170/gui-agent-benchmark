# P2 Native Evidence Live Collection

This runbook collects native UI-TARS action transcripts for the strict P2 evidence pack. It is local-only, guarded before prompt handoff, and must not publish GitHub changes.

## Scope

Expected tasks:

- `settings-toggle`
- `onboarding-form`
- `ticket-review`

The existing `settings-toggle` sample is already present. This runbook collects the two missing tasks:

- `onboarding-form`
- `ticket-review`

## Safety Rules

- Do not commit credentials, tunnel hosts, private IPs, SSH commands with real hosts, browser storage, cookies, tokens, API keys, or screenshots.
- Do not reconstruct native actions from `capture.json`, `trace.json`, `run-export.json`, step traces, or screenshots.
- Do not send prompts if `npm run uitars:live-guard` exits non-zero.
- If live export fails because sensitive content is detected, stop and inspect the local renderer state before retrying.
- `--state-json` cannot be combined with `--require-live-guard`; the guard is live-CDP only and must read the active UI-TARS renderer state.
- `--discover-local-uitars` discovers the child Chrome CDP endpoint for target safety checks. It is not renderer discovery.
- Final transcript export must use split CDP endpoints: `$UI_TARS_GUARD_CDP_URL` for the child Chrome guard target list and `$UI_TARS_RENDERER_CDP_URL` for UI-TARS Electron renderer state.
- GitHub publishing remains postponed until after the local project is complete.
- Do not claim task success unless the artifacts prove it.

## Hard Stops

Stop immediately before prompt handoff, capture, or export if any of these are true:

- Any normal Chrome sign-in page is visible.
- Any CDP target URL contains `signin`, `login`, `auth`, `google.com/search`, `bing.com/search`, `baidu.com/s`, or `volcengine.com`.
- Any arbitrary non-local `http` or `https` page is present.
- More than one exact benchmark target exists.
- Final transcript export cannot read UI-TARS renderer state through the explicit `$UI_TARS_RENDERER_CDP_URL`.
- `$UI_TARS_GUARD_CDP_URL` or `$UI_TARS_RENDERER_CDP_URL` is unset before final transcript export.
- UI-TARS reports `Waiting for user to take control` on a non-benchmark page.

## Start Services

Terminal 1:

```sh
npm start
```

Terminal 2:

```sh
npm run check:local
npm run check:tunnel
```

If `npm run check:tunnel` fails, restore the local model tunnel first. The expected local model endpoint is:

```text
http://127.0.0.1:18001
```

## Guarded Flow

For each missing task:

1. Prepare and isolate the local benchmark target with `--require-live-guard`.
2. Run the explicit target-only pre-prompt live guard command. It must use `--task`, `--benchmark-url`, `--discover-local-uitars`, `--no-require-renderer-state`, and `--output`.
3. Send the UI-TARS prompt only when the guard exits zero and reports `safe_to_prompt`.
4. Capture the final benchmark state with `--require-live-guard`.
5. Export the live native transcript with `--guard-cdp-url "$UI_TARS_GUARD_CDP_URL"`, `--renderer-cdp-url "$UI_TARS_RENDERER_CDP_URL"`, `--require-live-guard`, and the same exact benchmark URL.
6. If any guarded command exits non-zero, stop. Do not retry by sending another prompt until the visible browser and CDP target list are clean.

## Task: onboarding-form

Benchmark URL:

```text
http://127.0.0.1:4173/?task=onboarding-form
```

Prompt for UI-TARS:

```text
Benchmark task. If the current page is Google or anything other than the GUI Agent Benchmark onboarding-form task page, immediately use call_user() and do nothing else. If the onboarding-form task page is visible, Create an onboarding request for Maya Ortiz using maya.ortiz@example.com, role Designer, start date 2026-06-15, and notes that include Figma access. Submit the request. Click Evaluate and stop after the judge result is visible.
```

Prepare target:

```sh
npm run uitars:harness -- --output artifacts/p2-native-evidence-live/onboarding-form-prepare --tasks onboarding-form --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target --require-live-guard
```

Pre-prompt guard:

```sh
npm run uitars:live-guard -- --task onboarding-form --benchmark-url "http://127.0.0.1:4173/?task=onboarding-form" --discover-local-uitars --no-require-renderer-state --output artifacts/p2-native-evidence-live/onboarding-form-live-guard.json
```

If the guard exits non-zero, do not send the prompt.

Capture final benchmark state:

```sh
npm run uitars:capture -- --task onboarding-form --output experiments/2026-05-29-p2-native-action-evidence/tasks/onboarding-form/capture --base-url http://127.0.0.1:4173 --discover-local-uitars --require-live-guard
```

Export live native transcript:

```sh
npm run uitars:export-native-transcript -- --task onboarding-form --task-title "Submit onboarding request" --experiment-dir experiments/2026-05-29-p2-native-action-evidence --final-capture experiments/2026-05-29-p2-native-action-evidence/tasks/onboarding-form/capture/capture.json --benchmark-url "http://127.0.0.1:4173/?task=onboarding-form" --prompt "Benchmark task. If the current page is Google or anything other than the GUI Agent Benchmark onboarding-form task page, immediately use call_user() and do nothing else. If the onboarding-form task page is visible, Create an onboarding request for Maya Ortiz using maya.ortiz@example.com, role Designer, start date 2026-06-15, and notes that include Figma access. Submit the request. Click Evaluate and stop after the judge result is visible." --guard-cdp-url "$UI_TARS_GUARD_CDP_URL" --renderer-cdp-url "$UI_TARS_RENDERER_CDP_URL" --require-live-guard
```

## Task: ticket-review

Benchmark URL:

```text
http://127.0.0.1:4173/?task=ticket-review
```

Prompt for UI-TARS:

```text
Benchmark task. If the current page is Google or anything other than the GUI Agent Benchmark ticket-review task page, immediately use call_user() and do nothing else. If the ticket-review task page is visible, Find Priya Shah's INC-2048 support ticket in the review queue and mark it reviewed. Click Evaluate and stop after the judge result is visible.
```

Prepare target:

```sh
npm run uitars:harness -- --output artifacts/p2-native-evidence-live/ticket-review-prepare --tasks ticket-review --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target --require-live-guard
```

Pre-prompt guard:

```sh
npm run uitars:live-guard -- --task ticket-review --benchmark-url "http://127.0.0.1:4173/?task=ticket-review" --discover-local-uitars --no-require-renderer-state --output artifacts/p2-native-evidence-live/ticket-review-live-guard.json
```

If the guard exits non-zero, do not send the prompt.

Capture final benchmark state:

```sh
npm run uitars:capture -- --task ticket-review --output experiments/2026-05-29-p2-native-action-evidence/tasks/ticket-review/capture --base-url http://127.0.0.1:4173 --discover-local-uitars --require-live-guard
```

Export live native transcript:

```sh
npm run uitars:export-native-transcript -- --task ticket-review --task-title "Review priority support ticket" --experiment-dir experiments/2026-05-29-p2-native-action-evidence --final-capture experiments/2026-05-29-p2-native-action-evidence/tasks/ticket-review/capture/capture.json --benchmark-url "http://127.0.0.1:4173/?task=ticket-review" --prompt "Benchmark task. If the current page is Google or anything other than the GUI Agent Benchmark ticket-review task page, immediately use call_user() and do nothing else. If the ticket-review task page is visible, Find Priya Shah's INC-2048 support ticket in the review queue and mark it reviewed. Click Evaluate and stop after the judge result is visible." --guard-cdp-url "$UI_TARS_GUARD_CDP_URL" --renderer-cdp-url "$UI_TARS_RENDERER_CDP_URL" --require-live-guard
```

## Rebuild P2 Pack

```sh
npm run analyze:p2-native-action-evidence -- --experiment-dir experiments/2026-05-29-p2-native-action-evidence --expected-task-ids settings-toggle,onboarding-form,ticket-review
npm run validate:p2-native-action-evidence
```

Expected final result:

```text
Native action evidence gate validation passed: passed.
```
