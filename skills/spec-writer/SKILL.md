---
name: spec-writer
description: Create or refine spec-superflow planning artifacts. Invoke when the change is understood well enough to write proposal.md, specs/, design.md, and tasks.md.
---

# Spec Writer

## Bundled runtime

Before executing a CLI line below, replace its leading `SSF` with `node "<plugin-root>/scripts/spec-superflow.mjs"`; `<plugin-root>` is the absolute directory two levels above this file. Never run `SSF` literally or call an `ssf` from `PATH`.

## Workflow routing

A new request follows this file without loading legacy instructions. For an existing change, inspect the recorded state and receipt/plan (available through `SSF workflow show <change-dir> --json` and `SSF execution show <dir> --json` when needed). Current paths are `workflow_variant: direct` with a valid workflow-selection receipt `schema_version: 3`, or `workflow_variant: planned` with an execution plan `schema_version: 2`. Older receipts (schema 1/2), legacy plans and other recorded variants use the matching section of `SSF runtime asset read docs/legacy-workflow.md`; follow that section for this change. A direct variant alone is insufficient: legacy Quick/Hotfix/Lightweight can also record it. The internal `workflow: full` value alone is not a legacy signal. Missing or corrupt state, receipt or a required plan is a recovery problem; preserve evidence rather than reinitialize or downgrade the change.

Create or refine planning artifacts when the change has moved beyond exploration.

## New planned changes

For a new request, an expanding direct change, or workflow_variant planned, write proposal.md and tasks.md together without pausing between individual artifacts. Proposal holds the goal, in/out scope, acceptance and risks; tasks holds ordered deliverables and proof commands. Add specs only for behavior needing durable scenarios and design only for unresolved architectural decisions. Do not create execution-contract.md or duplicate the task list in another plan.

Check shared interfaces against the real source once, then self-check the problem, scope, dependencies and proof. Present one approval request only if this concrete plan lacks approval. After approval run `SSF workflow start <dir> --path planned --confirm --reason "<user decision>"` and continue implementation. No intermediate planning/bridging transitions or independent reader agent. A semantic revision uses the same command after approval; a nonsemantic correction uses execution resync and retains failed-review history.

## Artifact checks

- proposal.md records the problem, in/out scope, acceptance, impact and risks.
- tasks.md is the only task list: unique numbered checkboxes, dependency order, affected paths or bounded areas, observable outcomes and proof commands. When specs use scenario IDs, each task appends `covers: S-...-NNN, ...` so the coverage matrix closes. Keep test-cycle details in execution notes rather than repeating the plan.
- Add specs/ for durable behavior scenarios: each requirement uses SHALL/MUST and a `#### Scenario:` with WHEN/THEN, grouped under the applicable delta headers. Scenarios may carry an optional ID (`#### Scenario: S-<CAP>-NNN: title`, unique within the change); every ID-bearing scenario must be covered by a task `covers:` declaration — the coverage matrix blocks closing on gaps.
- Add design.md for real technical decisions: choice, rationale, alternatives, consequences and risks. Reference existing architecture instead of copying it. Start from the template's Boundary Check section — layer attribution (three questions: product-wide generic → kernel layer; industry-shared → industry package layer; single-customer → customization layer), repo/module landing, extension-means priority self-check (config > lowcode/config-driven > SPI > new module > kernel change, with why the higher level cannot solve it), prohibited-item self-check, and project boundary-contract reference (kernel-layer changes add a downstream-impact statement). A hit on any prohibited item is a specifying rollback before approval, not a later repair; paths without a design artifact skip this check.

Self-check five questions once: problem, command boundary, invalidation boundary, continuation boundary and document flow. Fix contradictions and missing acceptance evidence before presenting the one concrete plan for approval. Keep existing approval when it still covers that exact plan. After workflow-start records approval, continue to build-executor.
