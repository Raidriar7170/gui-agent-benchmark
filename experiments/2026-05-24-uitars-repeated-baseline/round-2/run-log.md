# UI-TARS Real E2E Round

Generated: 2026-05-24T04:29:43.400Z
Output: `experiments/2026-05-24-uitars-repeated-baseline/round-2`

## Required Tunnel

- Local model endpoint must be `http://127.0.0.1:18001`.
- Tunnel binding must be `18001 -> remote 8001`; remote `8000` is direct vLLM and fails UI-TARS high `max_tokens` requests.
- Example: `ssh -L 18001:127.0.0.1:8001 <remote-host>`

## Start Checks

```sh
npm run check:tunnel
npm run check:remote
npm run uitars:harness -- --output experiments/2026-05-24-uitars-repeated-baseline/round-2 --tasks 'onboarding-form,catalog-filter,settings-toggle,ticket-review' --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
```

## Per-Task Loop

For each task, send `initialPrompt`, wait for `call_user()` when UI-TARS lands on a search page, run `preflightFix` and `prepareAfterCallUser`, send `continuePrompt`, then run `prepareBeforeCapture` and `capture`.

## Results

| Task | Capture | Success | Score | Failed criteria |
| --- | --- | --- | ---: | --- |
| onboarding-form | real-run | no | 0 | form is submitted; full name is Maya Ortiz; email is maya.ortiz@example.com; role is Designer; start date is 2026-06-15; notes mention Figma access |
| catalog-filter | real-run | yes | 1 |  |
| settings-toggle | real-run | no | 0.75 | timezone is America/New_York |
| ticket-review | real-run | no | 0 | table query identifies Priya Shah or INC-2048; INC-2048 is selected; INC-2048 is marked reviewed |

Average score: 0.4375

## Task Commands

### onboarding-form

Initial prompt:

```text
Benchmark task. If the current page is Google or anything other than the GUI Agent Benchmark onboarding-form task page, immediately use call_user() and do nothing else. If the onboarding-form task page is visible, Create an onboarding request for Maya Ortiz using maya.ortiz@example.com, role Designer, start date 2026-06-15, and notes that include Figma access. Submit the request. Click Evaluate and stop after the judge result is visible.
```

Continue prompt:

```text
Continue now. The browser is now on the GUI Agent Benchmark onboarding-form task page. Complete the task: Create an onboarding request for Maya Ortiz using maya.ortiz@example.com, role Designer, start date 2026-06-15, and notes that include Figma access. Submit the request. Click Evaluate and stop after the judge result is visible.
```

```sh
npm run uitars:preflight -- --discover-local-uitars --url 'http://127.0.0.1:4173/?task=onboarding-form' --fix --output experiments/2026-05-24-uitars-repeated-baseline/round-2/tasks/onboarding-form/real-run/preflight-fix-after-call-user.json
npm run uitars:harness -- --output experiments/2026-05-24-uitars-repeated-baseline/round-2/task-prep/onboarding-form-after-call-user --tasks onboarding-form --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:harness -- --output experiments/2026-05-24-uitars-repeated-baseline/round-2/task-prep/onboarding-form-before-capture --tasks onboarding-form --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:capture -- --task onboarding-form --output experiments/2026-05-24-uitars-repeated-baseline/round-2/tasks/onboarding-form/real-run --base-url http://127.0.0.1:4173 --discover-local-uitars
```

### catalog-filter

Initial prompt:

```text
Benchmark task. If the current page is Google or anything other than the GUI Agent Benchmark catalog-filter task page, immediately use call_user() and do nothing else. If the catalog-filter task page is visible, Search or filter the catalog to find an in-stock Office item rated at least 4.5 stars, then select the Adjustable Laptop Stand. Click Evaluate and stop after the judge result is visible.
```

Continue prompt:

```text
Continue now. The browser is now on the GUI Agent Benchmark catalog-filter task page. Complete the task: Search or filter the catalog to find an in-stock Office item rated at least 4.5 stars, then select the Adjustable Laptop Stand. Click Evaluate and stop after the judge result is visible.
```

```sh
npm run uitars:preflight -- --discover-local-uitars --url 'http://127.0.0.1:4173/?task=catalog-filter' --fix --output experiments/2026-05-24-uitars-repeated-baseline/round-2/tasks/catalog-filter/real-run/preflight-fix-after-call-user.json
npm run uitars:harness -- --output experiments/2026-05-24-uitars-repeated-baseline/round-2/task-prep/catalog-filter-after-call-user --tasks catalog-filter --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:harness -- --output experiments/2026-05-24-uitars-repeated-baseline/round-2/task-prep/catalog-filter-before-capture --tasks catalog-filter --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:capture -- --task catalog-filter --output experiments/2026-05-24-uitars-repeated-baseline/round-2/tasks/catalog-filter/real-run --base-url http://127.0.0.1:4173 --discover-local-uitars
```

### settings-toggle

Initial prompt:

```text
Benchmark task. If the current page is Google or anything other than the GUI Agent Benchmark settings-toggle task page, immediately use call_user() and do nothing else. If the settings-toggle task page is visible, Enable the weekly email digest, keep autosave enabled, turn off product analytics sharing, and set the timezone to America/New_York. Click Evaluate and stop after the judge result is visible.
```

Continue prompt:

```text
Continue now. The browser is now on the GUI Agent Benchmark settings-toggle task page. Complete the task: Enable the weekly email digest, keep autosave enabled, turn off product analytics sharing, and set the timezone to America/New_York. Click Evaluate and stop after the judge result is visible.
```

```sh
npm run uitars:preflight -- --discover-local-uitars --url 'http://127.0.0.1:4173/?task=settings-toggle' --fix --output experiments/2026-05-24-uitars-repeated-baseline/round-2/tasks/settings-toggle/real-run/preflight-fix-after-call-user.json
npm run uitars:harness -- --output experiments/2026-05-24-uitars-repeated-baseline/round-2/task-prep/settings-toggle-after-call-user --tasks settings-toggle --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:harness -- --output experiments/2026-05-24-uitars-repeated-baseline/round-2/task-prep/settings-toggle-before-capture --tasks settings-toggle --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:capture -- --task settings-toggle --output experiments/2026-05-24-uitars-repeated-baseline/round-2/tasks/settings-toggle/real-run --base-url http://127.0.0.1:4173 --discover-local-uitars
```

### ticket-review

Initial prompt:

```text
Benchmark task. If the current page is Google or anything other than the GUI Agent Benchmark ticket-review task page, immediately use call_user() and do nothing else. If the ticket-review task page is visible, Find Priya Shah's INC-2048 support ticket in the review queue and mark it reviewed. Click Evaluate and stop after the judge result is visible.
```

Continue prompt:

```text
Continue now. The browser is now on the GUI Agent Benchmark ticket-review task page. Complete the task: Find Priya Shah's INC-2048 support ticket in the review queue and mark it reviewed. Click Evaluate and stop after the judge result is visible.
```

```sh
npm run uitars:preflight -- --discover-local-uitars --url 'http://127.0.0.1:4173/?task=ticket-review' --fix --output experiments/2026-05-24-uitars-repeated-baseline/round-2/tasks/ticket-review/real-run/preflight-fix-after-call-user.json
npm run uitars:harness -- --output experiments/2026-05-24-uitars-repeated-baseline/round-2/task-prep/ticket-review-after-call-user --tasks ticket-review --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:harness -- --output experiments/2026-05-24-uitars-repeated-baseline/round-2/task-prep/ticket-review-before-capture --tasks ticket-review --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:capture -- --task ticket-review --output experiments/2026-05-24-uitars-repeated-baseline/round-2/tasks/ticket-review/real-run --base-url http://127.0.0.1:4173 --discover-local-uitars
```

