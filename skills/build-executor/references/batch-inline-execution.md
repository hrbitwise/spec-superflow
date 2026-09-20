# Batch Inline Execution

On-demand procedure for the user-confirmed `batch-inline` mode; the entry
skill retains the recommendation/confirmation gate and the downgrade boundary.

Only when the user explicitly confirms `batch-inline` after seeing the recommendation. Current agent executes directly and serially. TDD Iron Law still applies.

Procedure: announce mode → write failing test → confirm failure → implement → run suite → refactor → lightweight checkpoint (files exist, no placeholders, test passed, no unintended changes) → report.

Boundaries: if any task touches >1 module, involves schema/API/config changes, or has open questions → downgrade to Inline or SDD.
