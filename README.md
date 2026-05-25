# GUI Agent Benchmark / UI-TARS Evidence Chain

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-blue.svg)](https://nodejs.org/)
[![Validation](https://img.shields.io/badge/validation-passing-brightgreen.svg)](#verification)
[![Expanded Round](https://img.shields.io/badge/expanded%20round-10%2F10%20captured-purple.svg)](#key-results)
[![Finish Gate](https://img.shields.io/badge/full%20finish%20gate-ready-success.svg)](#finish-gate)

**A deterministic GUI-agent benchmark and evidence-chain workspace for studying
UI-TARS browser-agent failures under reproducible, verification-gated
conditions.**

一个面向 GUI Agent / UI-TARS 的本地评测与证据链项目：它提供可控网页任务、纯
judge 协议、真实 UI-TARS capture 流程、preflight target-binding 修复、step
trace 归因、failure taxonomy 和 full finish gate，用来回答“Agent 到底失败在
哪些 GUI primitive 上”。

---

## Motivation / 为什么需要这个项目

GUI-agent demos often stop at a final success/failure label. That is not enough
when an agent misses a task because the browser target was wrong, the model
tunnel was misrouted, the UI-TARS child Chrome was stale, or the model simply
failed to commit a GUI action.

这个项目把“跑一次 GUI Agent”拆成可验证的 evidence chain：环境是否 ready、目标
tab 是否正确、capture 是否完整、summary 是否和 artifacts 一致、失败是否能追溯
到具体 GUI primitive。

| Problem | Naive Benchmark | This Workspace |
|---|:-:|:-:|
| Wrong browser target | Blends into task failure | Preflight creates, activates, and isolates the benchmark tab |
| Missing capture | Hidden behind aggregate metrics | Requires `10/10 captured` before expanded-round closure |
| UI-TARS action opacity | Hard to audit | Adds derived step traces and explicit evidence limitations |
| Local-only readiness | Easy to overclaim | Separates `localReady` from `integrationReady` in finish gate |
| Primitive-level analysis | Often anecdotal | Links failure taxonomy to per-task capture and timeline evidence |

---

## Key Results / 核心结果

The latest expanded real round is:

`experiments/2026-05-24-uitars-expanded-real-round/`

| Metric | Value |
|---|---:|
| Planned tasks | 10 |
| Captured tasks | 10 |
| Missing captures | 0 |
| Full task successes | 0 |
| Average score | 0.206 |
| Step traces | 10 expanded traces |
| Finish gate | `ready=true`, `localReady=true`, `integrationReady=true` |

Primary finding: **capture completeness and environment readiness can be
closed, while task success remains blocked by GUI interaction primitives.**

The expanded run shows that failures from the original 4-task round generalize
to a broader 10-task set. The hardest primitives were:

- **Dropdown value commit:** toggles worked, but timezone/category dropdowns
  stayed unchanged.
- **Table/list selection commit:** search or visible target reasoning did not
  turn into selected row/item state.
- **Compound state changes:** modal confirmation, pagination, sorting, and
  multi-select flows scored 0 or near 0.
- **Multi-step form completion:** partial text entry happened, but required
  fields and submit actions were left incomplete.

The easiest primitive in the current evidence is simple boolean toggling:
`settings-toggle` completed the checkbox-like controls before failing on the
timezone dropdown.

---

## Expanded Round Task Matrix

| Task | Score | Main failed primitive |
|---|---:|---|
| `onboarding-form` | 0.33 | Text-entry continuation and submit |
| `catalog-filter` | 0 | Filter/search to selected item commit |
| `settings-toggle` | 0.75 | Dropdown value commit |
| `ticket-review` | 0 | Table search/selection/review commit |
| `modal-confirmation` | 0 | Modal open and confirm sequence |
| `pagination-review` | 0.33 | Page navigation and row action |
| `sortable-inventory` | 0 | Sort commit and row selection |
| `multi-select-approvals` | 0 | Multi-select and submit |
| `validation-error-recovery` | 0.4 | Validation recovery after error |
| `file-upload-request` | 0.25 | Upload form dropdown and submit |

---

## Architecture / 系统架构

```text
controlled benchmark app
        |
        v
deterministic task state + judge protocol
        |
        +-------------------------+
        |                         |
        v                         v
browser run recorder        UI-TARS real-round helper
                                  |
                                  v
                         preflight target binding
                   create / activate / isolate correct tab
                                  |
                                  v
                         per-task capture bundle
                 capture.json / trace.json / run-export.json
                                  |
                                  v
                     real-run-summary.json consistency checks
                                  |
                                  v
                 failure taxonomy + derived step-trace evidence
                                  |
                                  v
                         full finish gate artifact
```

Core design principles:

- **Deterministic tasks:** every task has explicit state, judge criteria, score,
  and success result.
- **Evidence first:** expanded closure requires summary, capture, trace,
  run-export, taxonomy, report, and finish-gate artifacts to agree.
- **Target-binding hardening:** preflight handles empty targets, active-target
  mismatch, stale UI-TARS child Chrome, and Chrome error pages.
- **No raw-action overclaiming:** expanded step traces are derived timeline
  attribution, not raw UI-TARS action transcripts.

---

## Project Structure / 项目结构

```text
gui-agent-benchmark/
├── public/                         # Browser benchmark UI and task definitions
├── src/
│   ├── judge.mjs                   # Deterministic scoring logic
│   ├── runs.mjs                    # Browser run recording schema
│   ├── uitars-preflight.mjs        # Target discovery, repair, activation
│   ├── uitars-real-round.mjs       # Real-round planning and validation
│   ├── step-trace.mjs              # Step-trace schema and taxonomy links
│   └── finish-gate.mjs             # Local + integration readiness gate
├── scripts/                        # CLI runners and validators
├── docs/
│   ├── benchmark-report-2026-05-25-expanded-real-round.md
│   ├── failure-taxonomy.md
│   ├── step-trace-schema.md
│   └── raw-uitars-trace-schema.md
├── experiments/
│   └── 2026-05-24-uitars-expanded-real-round/
│       ├── real-run-summary.json
│       ├── failure-taxonomy.json
│       ├── step-traces/<task-id>.json
│       └── tasks/<task-id>/real-run/
│           ├── capture.json
│           ├── trace.json
│           └── run-export.json
├── artifacts/
│   └── finish-gate/2026-05-25-expanded-real-round.json
├── server.mjs
└── package.json
```

---

## Quick Start / 快速开始

### 1. Install and validate

```sh
npm run validate
npm run smoke
```

Expected validation highlights:

```text
Task validation passed: 10 tasks, 40 criteria.
Real round validation passed.
Step trace validation passed: 14 traces linked to failure taxonomy.
Finish gate validation passed: 5 checks, local-only and integration modes covered.
```

### 2. Start the benchmark app

```sh
npm start
```

The app defaults to:

```text
http://127.0.0.1:4173
```

### 3. Run a real UI-TARS round plan

```sh
npm run uitars:real-round -- \
  --output experiments/<date>-uitars-real-e2e \
  --tasks all \
  --base-url http://127.0.0.1:4173 \
  --discover-local-uitars
```

The helper writes:

- `round-plan.json`
- `real-run-summary.json`
- `run-log.md`
- per-task preflight, capture, trace, and run-export artifacts

---

## Verification

The current evidence-chain state has been checked with:

```sh
npm run validate
npm run smoke
UI_TARS_REMOTE_HOST=115.190.60.96 \
UI_TARS_REMOTE_PORT=2222 \
UI_TARS_REMOTE_USER=root \
UI_TARS_REMOTE_KEY=/Users/raidriar/.ssh/id_volcano \
npm run check:finish -- --json --output artifacts/finish-gate/2026-05-25-expanded-real-round.json
```

Latest expected full-gate state:

```text
ready=true
localReady=true
integrationReady=true
```

---

## Finish Gate

Use the finish gate when deciding whether the project is actually ready rather
than only locally valid.

```sh
npm run check:finish -- --local-only
npm run check:finish -- --json --output artifacts/finish-gate/report.json
```

`--local-only` runs:

- `npm run validate`
- `npm run smoke`
- `node scripts/check-local.mjs`

The full gate also runs:

- `node scripts/check-tunnel.mjs`
- `node scripts/check-remote.mjs`

For the Volcano UI-TARS deployment, the model tunnel must bind local `18001` to
remote proxy port `8001`, not direct vLLM port `8000`.

```sh
UI_TARS_REMOTE_HOST=115.190.60.96 \
UI_TARS_REMOTE_PORT=2222 \
UI_TARS_REMOTE_USER=root \
UI_TARS_REMOTE_KEY=/Users/raidriar/.ssh/id_volcano \
npm run check:finish -- --json --output artifacts/finish-gate/2026-05-25-expanded-real-round.json
```

Current full gate artifact:

`artifacts/finish-gate/2026-05-25-expanded-real-round.json`

---

## Evidence Artifacts / 证据链

| Artifact | Purpose |
|---|---|
| `docs/benchmark-report-2026-05-25-expanded-real-round.md` | Report-ready narrative and primitive analysis |
| `experiments/2026-05-24-uitars-expanded-real-round/real-run-summary.json` | Machine-readable 10-task summary |
| `experiments/2026-05-24-uitars-expanded-real-round/failure-taxonomy.json` | Task-to-failure-code taxonomy with timeline links |
| `experiments/2026-05-24-uitars-expanded-real-round/step-traces/<task-id>.json` | Derived timeline attribution for each expanded task |
| `experiments/2026-05-24-uitars-expanded-real-round/tasks/<task-id>/real-run/capture.json` | Final benchmark state and judge result |
| `experiments/2026-05-24-uitars-expanded-real-round/tasks/<task-id>/real-run/trace.json` | Capture trace artifact |
| `experiments/2026-05-24-uitars-expanded-real-round/tasks/<task-id>/real-run/run-export.json` | Importable run export |
| `artifacts/finish-gate/2026-05-25-expanded-real-round.json` | Full local + integration readiness result |

---

## Benchmark API

The browser app exposes a small deterministic API:

```js
window.__BENCH__ = {
  reset(taskId),
  snapshot(),
  evaluate(taskId),
  listTasks(),
  runs(),
  getRun(id),
  clearRuns(),
  exportRuns(),
  importRuns(payload)
}
```

`evaluate(taskId)` returns:

```js
{ success, score, details, state }
```

See `docs/judge-protocol.md` for the full schema.

---

## Trace Import

The Import control accepts existing run exports and external trace payloads:

```json
{
  "traceVersion": 1,
  "source": "ui-tars",
  "taskId": "onboarding-form",
  "taskTitle": "Submit onboarding request",
  "startedAt": "2026-05-20T00:00:00.000Z",
  "events": [
    {
      "timestamp": "2026-05-20T00:00:01.000Z",
      "type": "input",
      "path": "form.fullName",
      "value": "Maya Ortiz"
    }
  ]
}
```

Supported formats:

- one trace object
- `{ "traces": [ ... ] }`
- JSONL where each non-empty line is one complete trace object
- existing `{ "runs": [ ... ] }` exports

---

## Evidence Limitations / 证据限制

The expanded step traces are **derived timeline attributions**. They link
preflight reports, operator prompts, final capture state, benchmark evaluation,
and the finish gate, but they are not raw UI-TARS action transcripts.

Raw UI-TARS action-level logs, screenshots, browser private storage, and
model-internal logs were not captured for the expanded round. Future repeated
rounds should preserve raw UI-TARS action traces before making timing,
action-count, or low-level policy claims.

---

## Related Reports

- `docs/benchmark-report-2026-05-23.md`
- `docs/benchmark-report-2026-05-24-repeated-baseline.md`
- `docs/benchmark-report-2026-05-25-expanded-real-round.md`
- `docs/failure-taxonomy.md`
- `docs/repeated-baseline.md`
- `docs/step-trace-schema.md`
- `docs/raw-uitars-trace-schema.md`
