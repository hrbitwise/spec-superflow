# Repair and Focused Re-review Protocol (SDD)

按需加载资产：由 build-executor 入口在 wave review 出现 fail receipt 进入修复流程时读取。
"读 CLI repair state 才准 dispatch"与"第三次未解决失败熔断 adjudication-required"两道门禁在入口正文恒可见。

Dispatch no repair before reading `ssf execution show <change-dir> --json`: use the CLI-provided `waves[].repair` state together with `eligible` and `retryable`. Never infer a repair round from filenames or history, and do not write, edit, or modify a repair-state file directly.

- **Rounds 1–2 — recovery:** dispatch only the focused repair for the current wave. Give the implementer the CLI repair round, previous review report, and prior review head; generate a scoped diff from that head, then dispatch the `skills/build-executor/references/re-review-prompt.md` reviewer against the prior finding and that scoped diff. Do not redispatch dependent waves.
- **Third unresolved failure — stop:** the third unresolved receipt yields CLI status `adjudication-required`. Stop automatic dispatch and request human adjudication rather than attempting a fourth repair. After human review, record it with `ssf execution adjudicate <change-dir> --wave <id> --decision allow-review --confirm --reason <text>`; it authorizes one continuous review only, never a pass, and a failed authorized review returns to `adjudication-required`.
- Every focused re-review writes its separate persisted report, recorded only through `ssf execution review <change-dir> --wave <id> --base <sha> --head <sha> --report .superpowers/sdd/reviews/<wave-id>-rereview.md --verdict <pass|fail>`. A replacement `pass` receipt is the only evidence that resolves the wave.
