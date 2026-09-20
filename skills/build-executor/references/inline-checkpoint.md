# Inline Mode Recovery Checkpoint

On-demand reference for the `ssf checkpoint save` recovery step of Inline
execution; load it when a committed, reviewed task has another task remaining.

After a task is committed and reviewed, when another task remains, save the
recovery context with real evidence:

```bash
ssf checkpoint save <change-dir> \
  --task <completed-task-id> --next "<next task>" --completed "<completed work>" \
  --verification "<verification report path>" --review "<review report path>" \
  --risk "<open risk or None>" --commit-start <base-sha> --commit-end <head-sha>
```

This augments `.superpowers/sdd/progress.md`; it does not replace the progress
ledger or add a new core workflow state. Do not claim a checkpoint is current
when `ssf checkpoint list` reports it as stale.
