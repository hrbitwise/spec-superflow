# Direct Short-Path Intake (Quick / incident Hotfix)

按需加载资产：由 workflow-start 入口在收到明确有界的 Quick / incident Hotfix 请求时读取。
入口正文只保留同轮接收的触发条件与边界判定；本文件承载完整的同轮 intake 流程。

For a clearly bounded Quick or incident Hotfix request, recommend and accept in the same turn. Do not collect the eight intake facts as a questionnaire: infer them from the request and repository, show the observed facts, recommendation, and qualification reason, then ask the user to choose `tdd`, `new-test`, or `bounded` verification before running:

```bash
ssf state init <change-dir>
ssf workflow recommend <change-dir> --task-count <n> --file-count <n> --config-doc-only no --schema-api-change no --new-module no --behavioral-constraint-change <yes|no> --cross-module-change <yes|no> --uncertainty low --request-kind <standard|incident>
ssf workflow accept <change-dir> --source direct-request --verification <tdd|new-test|bounded>
```

Quick is ≤3 tasks/files of low-risk code. Hotfix is an incident with a reproducible symptom and ≤2 tasks/files. Display `Observed`, `Recommended`, `Why`, and any risk reasons; acceptance is the user's direct request to proceed and their explicit verification choice. Do not create planning artifacts, a contract, an execution plan, wave receipts, or DP approvals. Transition through the receipt-aware guard, execute bounded work, and require `test_result: pass` before closing. A fourth code file, behavioral-constraint change (PRD/spec/design/API/data/permission), cross-module work, a new module, high uncertainty, or failed verification does not auto-escalate: show Quick and Full, then wait for the user's choice. A user selecting Quick must acknowledge the recommendation and choose `tdd`, `new-test`, or `bounded` verification in the receipt. Tweak is only ≤4 config/doc-only tasks/files with no risk signals; it cannot be selected as an override. A legacy Hotfix without a valid direct receipt remains on the Full contract/DP-3/plan/review path.

### Bearing-Fact Assumption Display

The eight inferred facts are not equal. Task/file limits, `new_module`, and `schema_api_change` are countable and speak for themselves; `uncertainty`, `behavioral_constraint_change`, and `cross_module_change` are the judgment-heavy facts that can silently fail — yet the model certifies them itself. Do not certify them silently:

- Within the same `Observed`/`Why` display, add one line per bearing fact that has no concrete evidence in the request or repository: inferred value, what breaks if it is wrong, and the evidence searched (found or absent). "Probably low risk" with no searched evidence is a STOP signal — the same evidence standard as bug-investigator's "It's probably X".
- Never add a question round: the user's verification choice (`tdd`/`new-test`/`bounded`) in this same turn doubles as confirmation of the displayed assumptions.
- If scrutiny flips a bearing fact (a behavioral constraint, cross-module surface, or high uncertainty surfaces), do not accept on the old facts: refresh `ssf workflow recommend` with the corrected facts and follow the risk-signal rule above — show Quick and Full and wait for the user's choice. Never auto-escalate.
