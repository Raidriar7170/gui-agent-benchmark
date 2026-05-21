# UI-TARS Baseline Run Log

Experiment: `2026-05-21-uitars-baseline`

## Preflight

- `node scripts/check-local.mjs`: passed this round.
- `node scripts/check-tunnel.mjs`: initially failed; the main thread rebuilt
  the SSH tunnel, then the check passed before the task attempt.
- The tunnel was healthy during and after the recorded attempt.

## Attempt: onboarding-form / attempt 1

Prompt sent to UI-TARS:

```text
Open http://127.0.0.1:4173/?task=onboarding-form. Create an onboarding request for Maya Ortiz using maya.ortiz@example.com, role Designer, start date 2026-06-15, and notes that include Figma access. Submit the request, then evaluate the task.
```

Exact prompt submission timestamp was not captured.

Observed behavior:

- UI-TARS saw or assumed the Google homepage.
- It repeatedly clicked near the top-right/top area.
- Observed action examples included
  `click (start_box: [0.6503139717425431,0.03508771929824561,...])` and repeated
  `click (start_box: [0.7488226059654631,0.017543859649122806,...])`.
- It never opened `http://127.0.0.1:4173/?task=onboarding-form`.
- It never reached the benchmark page.
- No benchmark judge result was produced.
- The main thread stopped the attempt after repeated identical wrong actions.
- Local timestamp observed after stopping: `2026-05-21T10:29:46+0800`.

Classification:

- `failureType`: `model_task_failure`
- `failureReason`: `navigation_or_visual_grounding_failure`
- Not classified as infrastructure failure because `node scripts/check-tunnel.mjs`
  passed after tunnel restoration and the tunnel was healthy during/after the
  run.

## Observation 2: preloaded-page pilot

Before the prompt, the main thread opened Chrome to
`http://127.0.0.1:4173/?task=onboarding-form`. Chrome accessibility confirmed
the benchmark page was visible.

Prompt sent to UI-TARS:

```text
The browser is already open on the benchmark task page. Fill the onboarding request for Maya Ortiz using maya.ortiz@example.com, role Designer, start date 2026-06-15, and notes that include Figma access. Submit the request, then click Evaluate.
```

Observed behavior:

- Despite the preloaded benchmark page existing, UI-TARS acted on or observed a
  Google homepage.
- It tried address bar or new tab behavior.
- It never filled the benchmark form.
- No benchmark judge result was produced.

Classification:

- `failureType`: `model_or_operator_observation_failure`
- `failureReason`: `browser_target_binding_failure`
- Not classified as benchmark server failure; the tunnel remained healthy.

## Observation 3: single-tab controlled pilot

The main thread closed or removed distractor Chrome tabs and ensured the Chrome
front window had a single tab at
`http://127.0.0.1:4173/?task=onboarding-form`. Chrome accessibility confirmed
only the GUI Agent Benchmark tab was selected and visible.

Prompt sent to UI-TARS:

```text
Use the currently open benchmark page. Fill the onboarding request fields: full name Maya Ortiz, email maya.ortiz@example.com, role Designer, start date 2026-06-15, notes include Figma access. Click Submit Request, then click Evaluate.
```

Observed behavior:

- UI-TARS still reported or acted as if the current page were the Google search
  homepage.
- It repeatedly clicked around the address/search bar area.
- Observed action example:
  `click (start_box: [0.41601255886970173,0.44298245614035087,...])`.
- It never interacted with the benchmark form.
- No benchmark judge result was produced.
- Local timestamp after stopping/observing: `2026-05-21T10:40:27+0800`.

Classification:

- `failureType`: `operator_target_binding_blocker`
- `failureReason`:
  `systematic_ui_tars_local_browser_operator_observation_or_target_binding_failure`
- Remaining baseline tasks should be stopped until this is fixed.

The remaining planned baseline tasks, `catalog-filter`, `settings-toggle`, and
`ticket-review`, were not run because this experiment-level operator
observation/target-binding blocker invalidated further baseline attempts.

No API keys, tokens, passwords, UI-TARS IndexedDB contents, raw private logs, or
base64 screenshots were recorded.
