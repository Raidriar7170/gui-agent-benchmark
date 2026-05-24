# UI-TARS Failure Taxonomy

This taxonomy classifies failures observed in real UI-TARS Local Browser
Operator runs against the GUI Agent Benchmark. It separates environment
readiness from model/browser interaction ability so a failed task can still be
useful evidence.

## Principles

- Classify the first failure that prevents task completion as the primary
  failure.
- Add secondary failures only when they are directly visible in artifacts or
  operator observations.
- Do not classify a task as infrastructure failure when the finish gate,
  tunnel check, and remote health check pass.
- Prefer concrete interaction failures over broad labels such as "model failed".

## Severity Levels

| Severity | Meaning | Typical action |
| --- | --- | --- |
| P0 | Invalidates the run environment or prevents any meaningful model attempt. | Fix before comparing models. |
| P1 | Blocks task completion after the benchmark page is reachable. | Prioritize for model/operator improvement. |
| P2 | Reduces score or robustness but does not fully invalidate the attempt. | Track across rounds. |

## Codes

| Code | Layer | Severity | Definition | Evidence pattern |
| --- | --- | --- | --- | --- |
| `ENV-TUNNEL-MISROUTE` | Infrastructure | P0 | Local tunnel reaches direct vLLM instead of the UI-TARS proxy. | `/v1/models` works but chat fails with a high `max_tokens` context-length error. |
| `ENV-REMOTE-UNREADY` | Infrastructure | P0 | Remote model/proxy cannot answer health checks. | `check:remote` or `check:tunnel` fails after correct tunnel binding. |
| `BIND-SEARCH-START` | Operator binding | P1 | UI-TARS Local Browser starts or observes a search page instead of the benchmark task page. | Model sees Google/Bing/Baidu and requires `call_user()` plus CDP preflight repair. |
| `BIND-MULTI-TARGET` | Operator binding | P1 | More than one benchmark target is visible, making capture ambiguous. | Capture rejects multiple exact targets or preflight reports `ambiguous`. |
| `BIND-EMPTY-TARGET` | Operator binding | P1 | The UI-TARS child Chrome CDP endpoint is reachable, but exposes no page targets. | `/json/version` succeeds while `/json/list` returns `[]`. |
| `BIND-ACTIVE-TARGET-MISMATCH` | Operator binding | P1 | A correct benchmark target exists, but UI-TARS continues observing a different active page. | `/json/list` includes the benchmark target and a search-page target; screenshots still show the search page. |
| `ACT-UNSUPPORTED-HOTKEY` | Interaction primitive | P1 | The model attempts a hotkey unsupported by the operator runtime while trying to recover target focus. | UI-TARS reports an action execution error such as unsupported `meta` key. |
| `ACT-TEXT-ENTRY-STALL` | Interaction primitive | P1 | Model focuses or clicks a text field repeatedly without entering required text. | Final state has only earlier text fields filled, or none, while the model keeps clicking an input. |
| `ACT-SELECTION-COMMIT-MISS` | Interaction primitive | P1 | Model identifies or clicks a selectable item, but benchmark state does not record the selection. | `selectedSku`, `selectedTicketId`, or equivalent state remains empty. |
| `ACT-DROPDOWN-VALUE-MISS` | Interaction primitive | P1 | Model opens or targets a dropdown/select but leaves the target value unchanged. | Boolean toggles succeed while select value remains the default. |
| `ACT-TABLE-SEARCH-LOOP` | Interaction primitive | P1 | Model loops on table/list search or scrolling and does not commit the target row. | Query and selected row state remain empty after repeated search/list actions. |
| `TASK-PARTIAL-PLAN` | Task execution | P2 | Model performs some relevant subtasks but omits necessary filters, values, submit, or evaluate action. | Score is nonzero or state is partially changed, but required criteria remain unmet. |

## Round-Level Use

For each real run, record:

- `primaryCode`: the earliest blocking failure code.
- `secondaryCodes`: directly observed additional failure modes.
- `timelineAttribution`: the step trace path plus the exact step ids that prove
  the primary code.
- `evidence`: final state fields, failed criteria, and artifact paths.
- `environmentStatus`: `valid`, `invalid`, or `mitigated`.

An environment issue can be listed as historical or mitigated for a round, but
the task's primary code should remain an interaction/task code once the finish
gate passes before capture.

## Timeline Attribution

Final state explains what failed; step traces explain when the failure became
visible. A taxonomy entry should include:

```json
{
  "timelineAttribution": {
    "tracePath": "experiments/2026-05-23-uitars-real-e2e/step-traces/settings-toggle.json",
    "primaryEvidenceStepIds": [
      "settings-s06-toggles-complete",
      "settings-s07-timezone-unchanged",
      "settings-s10-failure"
    ],
    "timelineSummary": "UI-TARS completed boolean controls, then left the timezone dropdown at UTC."
  }
}
```

The primary evidence steps must point to concrete timeline entries, not only the
final judge result. For example, `ACT-DROPDOWN-VALUE-MISS` is supported by the
combination of a successful toggle-control step, an unchanged timezone step, and
the final failure attribution step.

Step trace schema details live in `docs/step-trace-schema.md`.

## Repeated Baseline Findings

The 2026-05-24 repeated baseline adds stability evidence across three real
rounds and 12 captured attempts:
`experiments/2026-05-24-uitars-repeated-baseline/summary.json`.

| Task | Stable pattern | Primary code |
| --- | --- | --- |
| `catalog-filter` | Recovered after round 1 and succeeded in rounds 2 and 3. | `ACT-SELECTION-COMMIT-MISS` for the initial failure. |
| `settings-toggle` | Partial success across all rounds, with timezone left incorrect. | `ACT-DROPDOWN-VALUE-MISS` |
| `onboarding-form` | Repeatedly failed before full form completion. | `ACT-TEXT-ENTRY-STALL` |
| `ticket-review` | Target recognition improved in round 3, but selection and review commit still failed. | `ACT-TABLE-SEARCH-LOOP`, `ACT-SELECTION-COMMIT-MISS` |

Round 3 also exposed `BIND-EMPTY-TARGET`,
`BIND-ACTIVE-TARGET-MISMATCH`, and `ACT-UNSUPPORTED-HOTKEY` while recovering
`ticket-review`. Those binding failures are useful run-quality evidence, but
the task score still comes from the final benchmark state.
