---
name: spec-writer
description: Create or refine spec-superflow planning artifacts. Invoke when the change is understood well enough to write proposal.md, specs/, design.md, and tasks.md.
---

# Spec Writer

Create or refine planning artifacts when the change has moved beyond exploration.

## Required Inputs

Read `.spec-superflow.yaml` (especially `dp_0_decisions`, `dp_0_confirmed`) and any existing planning artifacts. If `dp_0_confirmed` is not `true`, stop and route back to `workflow-start` for DP-0.

## Config Check

Run: `ssf runtime config --get artifacts.order` — generate in configured order (default: proposal → specs → design → tasks). Run with `artifacts.skip` — skip any listed artifacts.

## Artifact Roles

- `proposal.md`: why and scope
- `specs/`: required behavior (testable)
- `design.md`: architecture decisions and trade-offs (not line-by-line)
- `tasks.md`: dependency-aware implementation steps

## Working Rules

**Honor DP-0**: Read `dp_0_decisions`, respect confirmed constraints, don't silently expand scope. Pause on unconfirmed decisions.

### proposal.md
Must state: observed problem, what changes, in/out scope, impact areas, and proof of completion. Prefer concrete facts over empty adjectives such as “better”, “robust”, or “efficient”.

### specs/
Every requirement must be testable. Use SHALL or MUST. Every requirement must have at least one `#### Scenario:` with WHEN/THEN. Group under ADDED/MODIFIED/REMOVED Requirements headers.

### design.md
Must have: relevant facts and constraints, goals and non-goals, decisions (Choice + Rationale + Alternatives + Consequences + Sources), and risks with verification evidence. Do not invent stakeholders, migration steps, or open questions when they do not affect the decision.

### design.md Decisions — Red-Team Before Recording

Pressure-test every Decision before writing it; record the answers inside the existing Decision fields, not a new section:

- **Alternatives**: state the evidence that disqualifies each rejected alternative. A bare verdict (“simpler”, “better”) with no support is not a rationale.
- **Consequences**: label each consequence as evidence-backed or inferred; an inference is acceptable only when its assumption is named.
- **Sources**: any external factual claim the decision rests on — framework/runtime guarantees, API contracts, version-specific behavior, performance numbers — cites a specific document page plus its version or date; a bare domain is not a source. A purely internal trade-off (module layout, naming) is labeled `internal`. A claim whose source could not be located is labeled `unverified`: legal and non-blocking, but fabricating a precise link or citation is forbidden.
- **Risks**: every risk links to a mitigation and to verification evidence.

“It's probably fine” is a STOP signal — the same evidence standard as bug-investigator's “It's probably X”. If a field cannot be filled without inventing facts, first seek evidence in the repository or label the inference with its named assumption. Ask the user only when the gap meets the Artifact Generation pause conditions above; remain in specifying — do not route back to need-explorer or reopen DP-1.

### tasks.md
Must include a delivery/proof map and dependency-aware tasks. Each task names the affected path or bounded area, the observable outcome, and the evidence command. Keep RED/GREEN details, review receipts, and dispatch mechanics in the execution contract/task brief; do not inflate reader-facing tasks into five ritual substeps.

## Artifact Generation

When DP-0 has made the scope clear, generate the configured planning pack (proposal, delta specs from `templates/spec.md`, design, and tasks) in order without pausing between individual artifacts. Validate the pack, then request one DP-2 review. Pause earlier only when the missing decision can change user-visible behavior, compatibility, security, delivery scope, or the selected design; or when artifacts state incompatible scope.

## Validation Checklist

### proposal.md
- `## Why` > 50 chars, `## What Changes`, `## Scope` (In/Out), `## Impact`, no TBD/TODO; claims name an observed problem and a completion proof

### specs/
- SHALL/MUST for required behavior, `#### Scenario:` with WHEN/THEN per requirement, grouped under delta headers, no contradictions

### design.md
- facts/constraints, goals/non-goals, `## Decisions` (≥1, with Choice+Rationale+rejected-Alternative evidence+Consequences labeled evidence/inferred+Sources: specific page and version for external claims, `internal` for internal-only trade-offs, `unverified` allowed, fabricated citations forbidden), risks linked to mitigation and verification; no unsupported verdict words or unlabeled inferences

### tasks.md
- delivery/proof map, numbered tasks, affected paths or bounded areas, observable outcomes, no placeholders, every requirement mapped, explicit dependencies
- Must use the template checkbox format (one `- [ ]` per task on its own line); the guard enforces this format when entering execution

**If any artifact fails validation, fix before handing off to contract-builder.**

## DP-2: Artifact Review Gate

Present a concise summary of all 4 artifacts, then ask one DP-2 question for material adjustments. For Full changes, run one independent five-question blind reader check (problem, command boundary, invalidation boundary, continuation boundary, and document flow) before recording approval; repair only answers the reader cannot derive. An unfilled red-team field — a rejected Alternative with no disqualifying evidence, a Consequence with no evidence/inferred label, or a Risk with no linked mitigation and verification evidence — is a repair item the reader must catch. After approval:
```bash
ssf state set <change-dir> dp_2_result "approved: <summary>"
ssf state set <change-dir> dp_2_timestamp now
```

After the artifacts are done and DP-2 is recorded, advance the state:
```bash
ssf state transition <change-dir> specifying
```

## Handoff Rule

Do not start implementation after writing planning artifacts. Once stable, validated, and DP-2 is recorded, hand off to `contract-builder`.

## Exception Handling

- **Parse failures**: Report specific file/error; don't generate from corrupted templates
- **Missing templates**: Fall back to artifact structure defined in this skill
- **User interruption**: Artifacts on disk are the recovery checkpoint; resume from first missing/incomplete one
- **Validation failure**: Fix before handoff — do not hand off broken artifacts

## Standard User-Facing Handoff

End every user-facing phase report with this concise handoff. Only a successfully
persisted `closing` state and `abandoned` are terminal.

### Normal report

- Current stage: `<detected workflow stage>`.
- Completed / blocker: `<completed work>`.
- Next stage: `<next workflow stage or skill>`.
- Entry condition: `<what must be true to enter it>`.

### Blocked report

- Current stage: `<detected workflow stage>`.
- Completed / blocker: `<blocking fact or missing evidence>`.
- Next stage: `<stage that resumes after the blocker>`.
- Entry condition: `<the approval, artifact, validation, or fix required>`.

### Approval-wait report

- Current stage: `<detected workflow stage>`.
- Completed / blocker: `<work ready for the named decision>`.
- Next stage: `<stage that follows approval>`.
- Entry condition: `<explicit user approval or recorded decision>`.

### Successful terminal report

- Current stage: successfully persisted `closing` or `abandoned`.
- Completed / blocker: `<persisted terminal outcome>`.
- Next stage: `none`.
- Entry condition: no further transition exists.
