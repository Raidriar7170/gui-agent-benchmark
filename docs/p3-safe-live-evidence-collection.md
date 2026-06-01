# P3 Safe Live Evidence Collection

> Superseded status note (2026-05-31): split-CDP export plus run-scoped P2
> native action-event validation now exists. This page remains useful as a
> historical diagnosis of visible-target drift, but its "no final P2 evidence"
> and "do not proceed to ticket-review" statements describe the earlier blocked
> run, not the latest P2 closure pack.

This phase exists because the remaining P2 native evidence must come from live UI-TARS renderer state, but prior local attempts showed unsafe target drift: UI-TARS could be ready to act while a normal Chrome sign-in or other non-benchmark page was visible. P3 adds a stop-first guard around local live collection before more prompts are sent.

The live guard protects local runs by requiring exactly one exact local benchmark task target and readable UI-TARS renderer state. It blocks sign-in, login, auth, search, Volcengine, arbitrary non-local `http` or `https`, and ambiguous duplicate benchmark targets. `Waiting for user to take control` on a non-benchmark page remains a human/operator hard stop before prompt handoff unless a future code guard implements that state check directly. A non-zero guard exit means no prompt handoff, no capture, and no transcript export.

Reviewer-facing command sequence:

```sh
npm run uitars:harness -- --output artifacts/p2-native-evidence-live/<task>-prepare --tasks <task> --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target --require-live-guard
npm run uitars:live-guard -- --task <task> --benchmark-url "http://127.0.0.1:4173/?task=<task>" --discover-local-uitars --no-require-renderer-state --output artifacts/p2-native-evidence-live/<task>-live-guard.json
npm run uitars:capture -- --task <task> --output experiments/2026-05-29-p2-native-action-evidence/tasks/<task>/capture --base-url http://127.0.0.1:4173 --discover-local-uitars --require-live-guard
npm run uitars:export-native-transcript -- --task <task> --task-title "<task title>" --experiment-dir experiments/2026-05-29-p2-native-action-evidence --final-capture experiments/2026-05-29-p2-native-action-evidence/tasks/<task>/capture/capture.json --benchmark-url "http://127.0.0.1:4173/?task=<task>" --prompt "<exact prompt>" --guard-cdp-url "$UI_TARS_GUARD_CDP_URL" --renderer-cdp-url "$UI_TARS_RENDERER_CDP_URL" --require-live-guard
```

The target-only pre-prompt guard may use `--discover-local-uitars --no-require-renderer-state` because that discovery finds the child Chrome endpoint used for benchmark target safety. It is not renderer discovery. Final transcript export must use explicit split endpoints: `$UI_TARS_GUARD_CDP_URL` for the child Chrome guard target list and `$UI_TARS_RENDERER_CDP_URL` for the UI-TARS Electron renderer state.

`--state-json` cannot be combined with `--require-live-guard` because offline state export has no live CDP target list or renderer to guard. GitHub publishing remains postponed, and task success must not be claimed unless the produced artifacts prove native actions, final capture, and judge state align.

## 2026-05-30 Task 4 Live Run Result

Task 4 attempted guarded live collection for `onboarding-form` first, before moving to `ticket-review`. It did not produce a valid P2 evidence sample, so the final P2 experiment directory was not updated.

What worked:

- `npm run check:local` passed against `http://127.0.0.1:4173`.
- `npm run check:tunnel` passed after restoring the model tunnel through the local SSH alias.
- The target guard correctly blocked prompt handoff whenever UI-TARS created or retained a Google target.
- After closing the hidden benchmark target and preparing the currently visible Google target as the keeper, `prepare-target --isolate-target --require-live-guard` left exactly one local `onboarding-form` target and no blocked targets.
- A same-session continuation kept the run on the local benchmark target for 18 guard polls.

What blocked completion:

- New UI-TARS Local Browser sessions create a Google target on first screenshot, even when a benchmark target was pre-created through CDP. The safe workaround is to let that target exist, stop, navigate the visible Google target to the benchmark URL through guarded preparation, and then continue in the same session.
- The `onboarding-form` run entered the local page and typed `Maya Ortiz`, then repeatedly clicked the Work email input without typing the email. The final capture was partial only: `fullName` matched, but email, role, start date, notes, submit, and evaluation did not.
- Live transcript export with `--require-live-guard` failed because the discovered UI-TARS child Chrome CDP endpoint exposes the benchmark page, not the Electron renderer state containing UI-TARS messages.

Key evidence artifacts:

- `artifacts/p3-live-evidence/onboarding-form-clean-task/guard-1.json`: guard blocked the fresh prompt because a Google target appeared.
- `artifacts/p3-live-evidence/onboarding-form-continuation-prepare/tasks/onboarding-form/target-prepare.json`: visible Google target was safely navigated to the local benchmark page.
- `artifacts/p3-live-evidence/onboarding-form-continuation-task/guard-1.json` through `guard-18.json`: same-session continuation stayed on the exact local benchmark target with no blocked targets.
- `artifacts/p3-live-evidence/onboarding-form-partial/capture/capture.json`: partial final state, score `0.17`, unsuccessful.
- `artifacts/p3-live-evidence/onboarding-form-partial/native-transcript/tasks/onboarding-form/raw/live-guard.json`: native transcript export blocked on unavailable renderer state.

Recommended next step: fix native transcript export to read UI-TARS Electron renderer state or provide a sanctioned renderer-state export path, then rerun `onboarding-form` with the same-session visible-target preparation protocol. Do not proceed to `ticket-review` collection until `onboarding-form` can produce a complete native transcript and successful final capture.

## 2026-05-31 Task 5 Split-CDP Recovery Result

Task 5 fixed the code-side export blocker but did not produce final P2 evidence.

What changed:

- Live target safety and native transcript extraction now use split CDP endpoints.
- The guard endpoint is the UI-TARS child Chrome CDP endpoint and is used only for target safety.
- The renderer endpoint is the UI-TARS Electron renderer CDP endpoint and is used for UI-TARS messages/actions.
- Renderer state extraction now supports async `window.zustandBridge.getState()`.
- Guard and inspector reports redact non-local URLs/hosts/IPs, websocket URLs, inline images, and sensitive-looking token/cookie/auth fields.

What was verified:

- `npm run validate` passed.
- `npm run check:local` passed.
- `npm run check:tunnel` passed after restoring the local model tunnel through the SSH alias.
- `npm run uitars:renderer-state-inspect -- --cdp-url http://127.0.0.1:9333` could read UI-TARS Electron renderer state after launching UI-TARS with the local debugging port.
- Target-only guard reported `safe_to_prompt` for exactly one local `onboarding-form` target before the formal prompt.

What blocked the live task:

- The UI-TARS Local Browser screenshot still showed Google after the formal prompt.
- UI-TARS correctly stopped with `Waiting for user to take control`.
- The guard then blocked because the child Chrome target list contained both a Google page and the local `onboarding-form` benchmark page.
- Capture with `--require-live-guard` also blocked. No final P2 evidence was written.

Key evidence artifacts:

- `artifacts/p3-live-evidence/onboarding-form-next/renderer-state-inspect-after-bootstrap.json`: renderer state was readable after bootstrap.
- `artifacts/p3-live-evidence/onboarding-form-next/guard-before-prompt.json`: target-only guard was initially safe.
- `artifacts/p3-live-evidence/onboarding-form-next/guard-polls/guard-2.json`: guard blocked after Google target drift.
- `artifacts/p3-live-evidence/onboarding-form-next/blocked-capture/live-guard.json`: capture was blocked by the same target guard.

Recommended next step: do not proceed to `ticket-review`. First add or document a deterministic visible-target binding step for UI-TARS Local Browser so the model's fresh screenshot uses the prepared local benchmark target rather than a newly-created Google target.
