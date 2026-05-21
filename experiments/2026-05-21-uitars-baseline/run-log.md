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

## 2026-05-21 11:02-11:17 diagnosis and preflight-assisted observation

### 11:02 diagnosis: fresh Local Browser run opens search target

Observed setup:

- CDP initially exposed only the Benchmark target.
- Starting a non-`call_user` UI-TARS Local Browser run created a new Google
  target.
- The model reported seeing Google rather than the Benchmark page.

Source evidence from
`/Applications/UI TARS.app/Contents/Resources/app.asar`:

- `DefaultBrowserOperator.getInstance` calls `createPage`, which navigates the
  new page to a search-engine URL: Google, Bing, or Baidu.
- `BaseBrowser.setupPageListener` updates `activePage` through
  `targetcreated` and `targetchanged`.
- `BrowserOperator` action space includes `navigate(content='xxx')`, but when
  the natural-language task asked the model to use navigation, the model still
  chose to click the address bar.

Conclusion:

- The delay was not caused by a slow remote model response.
- The blocker was the Local Browser start page and `activePage` binding
  mechanism.

### 11:10 diagnosis: CDP targetchanged can repair active page binding

While UI-TARS was in `call_user`, the main thread used CDP `Page.navigate` to
send the UI-TARS-hosted Chrome Google targets to
`http://127.0.0.1:4173/?task=onboarding-form`.

Observed behavior after continuing:

- UI-TARS saw the GUI Agent Workspace and onboarding form.
- It finished with `finished(content='Benchmark visible')`.

Conclusion:

- Navigating the UI-TARS-owned target through CDP can trigger the target change
  path and repair `activePage` for the Local Browser Operator.

### 11:13-11:17 preflight-assisted diagnostic run

Prompting strategy:

- Let the model enter `call_user` while it was on the Google page.
- Use CDP to navigate UI-TARS-hosted Chrome targets to the onboarding benchmark
  page.
- Continue the onboarding task as a diagnostic observation.

Baseline status:

- This was not `onboarding-form` baseline attempt 2.
- The baseline protocol remained one attempt per task with no human correction or
  retry.
- The earlier baseline invalidation still holds because CDP `Page.navigate` was
  required to repair the UI-TARS target binding before the benchmark page became
  visible.

Observed behavior:

- UI-TARS successfully entered the benchmark page.
- It entered `Full name` as `Maya Ortiz`.
- On the `Work email` field, it repeatedly clicked instead of typing
  `maya.ortiz@example.com`.
- The main thread manually stopped the run at `loopCnt=10`.
- Target URL navigation was CDP-assisted through `Page.navigate`, not opened
  autonomously by UI-TARS.
- Timing observations used different clocks: the wall-clock observation window
  was `2026-05-21 11:13-11:17 Asia/Shanghai`, UI-TARS logged
  `totalTime=97515ms`, and `runAgent total cost=175.326s`.

Final form state:

- `name`: `Maya Ortiz`
- `email`: blank
- `role`: blank
- `start date`: blank
- `notes`: blank

Judge result:

- Not completed.

Classification:

- `classification`: `preflight-assisted diagnostic run / non-baseline`
- `failureType`: `diagnostic_model_task_failure_after_preflight_assist`
- `failureReason`:
  `target_binding_preflight_required + repeated_email_field_click/focus_or_type_failure`

The remaining planned baseline tasks, `catalog-filter`, `settings-toggle`, and
`ticket-review`, remain stopped until the target-binding preflight is made
explicit and repeatable.

No API keys, tokens, passwords, UI-TARS IndexedDB contents, raw private logs, or
base64 screenshots were recorded.
