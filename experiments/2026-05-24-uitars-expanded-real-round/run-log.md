# UI-TARS Real E2E Round

Generated: 2026-05-25T02:58:35.335Z
Output: `experiments/2026-05-24-uitars-expanded-real-round`

## Required Tunnel

- Local model endpoint must be `http://127.0.0.1:18001`.
- Tunnel binding must be `18001 -> remote 8001`; remote `8000` is direct vLLM and fails UI-TARS high `max_tokens` requests.
- Example: `ssh -L 18001:127.0.0.1:8001 <remote-host>`

## Start Checks

```sh
npm run check:tunnel
npm run check:remote
npm run uitars:harness -- --output experiments/2026-05-24-uitars-expanded-real-round --tasks 'onboarding-form,catalog-filter,settings-toggle,ticket-review,modal-confirmation,pagination-review,sortable-inventory,multi-select-approvals,validation-error-recovery,file-upload-request' --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
```

## Per-Task Loop

For each task, send `initialPrompt`, wait for `call_user()` when UI-TARS lands on a search page, run `preflightFix` and `prepareAfterCallUser`, send `continuePrompt`, then run `prepareBeforeCapture` and `capture`.

## Results

| Task | Capture | Success | Score | Failed criteria |
| --- | --- | --- | ---: | --- |
| onboarding-form | real-run | no | 0.33 | form is submitted; role is Designer; start date is 2026-06-15; notes mention Figma access |
| catalog-filter | real-run | no | 0 | selected SKU is ERGO-27; selected product is in stock; selected product category is office; selected product rating is at least 4.5 |
| settings-toggle | real-run | no | 0.75 | timezone is America/New_York |
| ticket-review | real-run | no | 0 | table query identifies Priya Shah or INC-2048; INC-2048 is selected; INC-2048 is marked reviewed |
| modal-confirmation | real-run | no | 0 | request REQ-77 is selected; confirmation dialog was opened; request is confirmed |
| pagination-review | real-run | no | 0.33 | pagination is on page 2; invoice INV-203 is reviewed |
| sortable-inventory | real-run | no | 0 | inventory is sorted by risk; risk sort is descending; selected SKU is BATT-88; selected item has risk 9 |
| multi-select-approvals | real-run | no | 0 | APR-102 is selected; APR-205 is selected; only requested approvals are selected; approvals are submitted |
| validation-error-recovery | real-run | no | 0.4 | owner is Morgan Lee; due date is 2026-06-30; validation form is submitted |
| file-upload-request | real-run | no | 0.25 | category is Compliance; description mentions Q2 security audit evidence; upload request is submitted |

Average score: 0.206

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
npm run uitars:preflight -- --discover-local-uitars --url 'http://127.0.0.1:4173/?task=onboarding-form' --fix --output experiments/2026-05-24-uitars-expanded-real-round/tasks/onboarding-form/real-run/preflight-fix-after-call-user.json
npm run uitars:harness -- --output experiments/2026-05-24-uitars-expanded-real-round/task-prep/onboarding-form-after-call-user --tasks onboarding-form --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:harness -- --output experiments/2026-05-24-uitars-expanded-real-round/task-prep/onboarding-form-before-capture --tasks onboarding-form --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:capture -- --task onboarding-form --output experiments/2026-05-24-uitars-expanded-real-round/tasks/onboarding-form/real-run --base-url http://127.0.0.1:4173 --discover-local-uitars
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
npm run uitars:preflight -- --discover-local-uitars --url 'http://127.0.0.1:4173/?task=catalog-filter' --fix --output experiments/2026-05-24-uitars-expanded-real-round/tasks/catalog-filter/real-run/preflight-fix-after-call-user.json
npm run uitars:harness -- --output experiments/2026-05-24-uitars-expanded-real-round/task-prep/catalog-filter-after-call-user --tasks catalog-filter --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:harness -- --output experiments/2026-05-24-uitars-expanded-real-round/task-prep/catalog-filter-before-capture --tasks catalog-filter --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:capture -- --task catalog-filter --output experiments/2026-05-24-uitars-expanded-real-round/tasks/catalog-filter/real-run --base-url http://127.0.0.1:4173 --discover-local-uitars
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
npm run uitars:preflight -- --discover-local-uitars --url 'http://127.0.0.1:4173/?task=settings-toggle' --fix --output experiments/2026-05-24-uitars-expanded-real-round/tasks/settings-toggle/real-run/preflight-fix-after-call-user.json
npm run uitars:harness -- --output experiments/2026-05-24-uitars-expanded-real-round/task-prep/settings-toggle-after-call-user --tasks settings-toggle --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:harness -- --output experiments/2026-05-24-uitars-expanded-real-round/task-prep/settings-toggle-before-capture --tasks settings-toggle --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:capture -- --task settings-toggle --output experiments/2026-05-24-uitars-expanded-real-round/tasks/settings-toggle/real-run --base-url http://127.0.0.1:4173 --discover-local-uitars
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
npm run uitars:preflight -- --discover-local-uitars --url 'http://127.0.0.1:4173/?task=ticket-review' --fix --output experiments/2026-05-24-uitars-expanded-real-round/tasks/ticket-review/real-run/preflight-fix-after-call-user.json
npm run uitars:harness -- --output experiments/2026-05-24-uitars-expanded-real-round/task-prep/ticket-review-after-call-user --tasks ticket-review --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:harness -- --output experiments/2026-05-24-uitars-expanded-real-round/task-prep/ticket-review-before-capture --tasks ticket-review --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:capture -- --task ticket-review --output experiments/2026-05-24-uitars-expanded-real-round/tasks/ticket-review/real-run --base-url http://127.0.0.1:4173 --discover-local-uitars
```

### modal-confirmation

Initial prompt:

```text
Benchmark task. If the current page is Google or anything other than the GUI Agent Benchmark modal-confirmation task page, immediately use call_user() and do nothing else. If the modal-confirmation task page is visible, Open the confirmation dialog for request REQ-77 and confirm it. Click Evaluate and stop after the judge result is visible.
```

Continue prompt:

```text
Continue now. The browser is now on the GUI Agent Benchmark modal-confirmation task page. Complete the task: Open the confirmation dialog for request REQ-77 and confirm it. Click Evaluate and stop after the judge result is visible.
```

```sh
npm run uitars:preflight -- --discover-local-uitars --url 'http://127.0.0.1:4173/?task=modal-confirmation' --fix --output experiments/2026-05-24-uitars-expanded-real-round/tasks/modal-confirmation/real-run/preflight-fix-after-call-user.json
npm run uitars:harness -- --output experiments/2026-05-24-uitars-expanded-real-round/task-prep/modal-confirmation-after-call-user --tasks modal-confirmation --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:harness -- --output experiments/2026-05-24-uitars-expanded-real-round/task-prep/modal-confirmation-before-capture --tasks modal-confirmation --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:capture -- --task modal-confirmation --output experiments/2026-05-24-uitars-expanded-real-round/tasks/modal-confirmation/real-run --base-url http://127.0.0.1:4173 --discover-local-uitars
```

### pagination-review

Initial prompt:

```text
Benchmark task. If the current page is Google or anything other than the GUI Agent Benchmark pagination-review task page, immediately use call_user() and do nothing else. If the pagination-review task page is visible, Go to page 2 of the invoice queue and mark invoice INV-203 reviewed. Click Evaluate and stop after the judge result is visible.
```

Continue prompt:

```text
Continue now. The browser is now on the GUI Agent Benchmark pagination-review task page. Complete the task: Go to page 2 of the invoice queue and mark invoice INV-203 reviewed. Click Evaluate and stop after the judge result is visible.
```

```sh
npm run uitars:preflight -- --discover-local-uitars --url 'http://127.0.0.1:4173/?task=pagination-review' --fix --output experiments/2026-05-24-uitars-expanded-real-round/tasks/pagination-review/real-run/preflight-fix-after-call-user.json
npm run uitars:harness -- --output experiments/2026-05-24-uitars-expanded-real-round/task-prep/pagination-review-after-call-user --tasks pagination-review --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:harness -- --output experiments/2026-05-24-uitars-expanded-real-round/task-prep/pagination-review-before-capture --tasks pagination-review --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:capture -- --task pagination-review --output experiments/2026-05-24-uitars-expanded-real-round/tasks/pagination-review/real-run --base-url http://127.0.0.1:4173 --discover-local-uitars
```

### sortable-inventory

Initial prompt:

```text
Benchmark task. If the current page is Google or anything other than the GUI Agent Benchmark sortable-inventory task page, immediately use call_user() and do nothing else. If the sortable-inventory task page is visible, Sort the inventory table by risk descending, then select the Battery Pack Recall Kit. Click Evaluate and stop after the judge result is visible.
```

Continue prompt:

```text
Continue now. The browser is now on the GUI Agent Benchmark sortable-inventory task page. Complete the task: Sort the inventory table by risk descending, then select the Battery Pack Recall Kit. Click Evaluate and stop after the judge result is visible.
```

```sh
npm run uitars:preflight -- --discover-local-uitars --url 'http://127.0.0.1:4173/?task=sortable-inventory' --fix --output experiments/2026-05-24-uitars-expanded-real-round/tasks/sortable-inventory/real-run/preflight-fix-after-call-user.json
npm run uitars:harness -- --output experiments/2026-05-24-uitars-expanded-real-round/task-prep/sortable-inventory-after-call-user --tasks sortable-inventory --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:harness -- --output experiments/2026-05-24-uitars-expanded-real-round/task-prep/sortable-inventory-before-capture --tasks sortable-inventory --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:capture -- --task sortable-inventory --output experiments/2026-05-24-uitars-expanded-real-round/tasks/sortable-inventory/real-run --base-url http://127.0.0.1:4173 --discover-local-uitars
```

### multi-select-approvals

Initial prompt:

```text
Benchmark task. If the current page is Google or anything other than the GUI Agent Benchmark multi-select-approvals task page, immediately use call_user() and do nothing else. If the multi-select-approvals task page is visible, Select approvals APR-102 and APR-205 only, then submit the selected approvals. Click Evaluate and stop after the judge result is visible.
```

Continue prompt:

```text
Continue now. The browser is now on the GUI Agent Benchmark multi-select-approvals task page. Complete the task: Select approvals APR-102 and APR-205 only, then submit the selected approvals. Click Evaluate and stop after the judge result is visible.
```

```sh
npm run uitars:preflight -- --discover-local-uitars --url 'http://127.0.0.1:4173/?task=multi-select-approvals' --fix --output experiments/2026-05-24-uitars-expanded-real-round/tasks/multi-select-approvals/real-run/preflight-fix-after-call-user.json
npm run uitars:harness -- --output experiments/2026-05-24-uitars-expanded-real-round/task-prep/multi-select-approvals-after-call-user --tasks multi-select-approvals --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:harness -- --output experiments/2026-05-24-uitars-expanded-real-round/task-prep/multi-select-approvals-before-capture --tasks multi-select-approvals --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:capture -- --task multi-select-approvals --output experiments/2026-05-24-uitars-expanded-real-round/tasks/multi-select-approvals/real-run --base-url http://127.0.0.1:4173 --discover-local-uitars
```

### validation-error-recovery

Initial prompt:

```text
Benchmark task. If the current page is Google or anything other than the GUI Agent Benchmark validation-error-recovery task page, immediately use call_user() and do nothing else. If the validation-error-recovery task page is visible, Submit the empty access review form once to show validation, then enter title Quarterly access review, owner Morgan Lee, due date 2026-06-30, and submit successfully. Click Evaluate and stop after the judge result is visible.
```

Continue prompt:

```text
Continue now. The browser is now on the GUI Agent Benchmark validation-error-recovery task page. Complete the task: Submit the empty access review form once to show validation, then enter title Quarterly access review, owner Morgan Lee, due date 2026-06-30, and submit successfully. Click Evaluate and stop after the judge result is visible.
```

```sh
npm run uitars:preflight -- --discover-local-uitars --url 'http://127.0.0.1:4173/?task=validation-error-recovery' --fix --output experiments/2026-05-24-uitars-expanded-real-round/tasks/validation-error-recovery/real-run/preflight-fix-after-call-user.json
npm run uitars:harness -- --output experiments/2026-05-24-uitars-expanded-real-round/task-prep/validation-error-recovery-after-call-user --tasks validation-error-recovery --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:harness -- --output experiments/2026-05-24-uitars-expanded-real-round/task-prep/validation-error-recovery-before-capture --tasks validation-error-recovery --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:capture -- --task validation-error-recovery --output experiments/2026-05-24-uitars-expanded-real-round/tasks/validation-error-recovery/real-run --base-url http://127.0.0.1:4173 --discover-local-uitars
```

### file-upload-request

Initial prompt:

```text
Benchmark task. If the current page is Google or anything other than the GUI Agent Benchmark file-upload-request task page, immediately use call_user() and do nothing else. If the file-upload-request task page is visible, Attach security-audit.pdf, set category to Compliance, add description Q2 security audit evidence, and submit the upload request. Click Evaluate and stop after the judge result is visible.
```

Continue prompt:

```text
Continue now. The browser is now on the GUI Agent Benchmark file-upload-request task page. Complete the task: Attach security-audit.pdf, set category to Compliance, add description Q2 security audit evidence, and submit the upload request. Click Evaluate and stop after the judge result is visible.
```

```sh
npm run uitars:preflight -- --discover-local-uitars --url 'http://127.0.0.1:4173/?task=file-upload-request' --fix --output experiments/2026-05-24-uitars-expanded-real-round/tasks/file-upload-request/real-run/preflight-fix-after-call-user.json
npm run uitars:harness -- --output experiments/2026-05-24-uitars-expanded-real-round/task-prep/file-upload-request-after-call-user --tasks file-upload-request --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:harness -- --output experiments/2026-05-24-uitars-expanded-real-round/task-prep/file-upload-request-before-capture --tasks file-upload-request --base-url http://127.0.0.1:4173 --discover-local-uitars --prepare-target --isolate-target
npm run uitars:capture -- --task file-upload-request --output experiments/2026-05-24-uitars-expanded-real-round/tasks/file-upload-request/real-run --base-url http://127.0.0.1:4173 --discover-local-uitars
```

