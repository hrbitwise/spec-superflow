---
name: need-explorer
description: Clarify intent, scope, constraints, and success criteria before artifact creation. Invoke when the request is fuzzy, the user is comparing options, or the workflow needs a stable change definition before writing artifacts.
---

# Need Explorer

Turn a rough idea into a stable change definition before writing artifacts.

## Primary Goal

Agree on: problem, scope, non-goals, success criteria, whether to split before specification.

## Process

### 1. Inspect Context First

Before asking questions, understand what exists and what constraints are in place.

### 2. One Question at a Time

Ask a single clear question, wait for the answer, digest, then ask the next. Never ask 3+ questions at once. Each answer informs the next question.

### 3. Prefer Multiple-Choice Questions

Present 2-3 options when reasonable answers are finite. This reduces cognitive load and surfaces unconsidered choices. Options are a decision aid, not a vocabulary test — every option set must satisfy:

- **Plain language**: phrase each option as what the user gets and gives up; jargon may follow in parentheses, never lead.
- **Same altitude, mutually exclusive**: all options at one abstraction level, no overlaps; overlapping options mean the question is not ready.
- **Mark a default**: label one option recommended, grounded in evidence from the request or repository ("I saw X, so…"); never "it depends".
- **Wrongness cost**: one line per option — if this choice is wrong, worst outcome and cost to reverse; say so explicitly if reversal is impossible.
- **Three options max**: more than three means you have not filtered; narrow before asking.

Never present options the user cannot evaluate with information they hold. When a decision rests on a fact they lack, ask that prerequisite question first (dependency order), then re-present the options.

### 4. Propose 2-3 Approaches with Trade-Offs

Compare all approaches on the **same dimensions** in one frame — scope touched, risk, fallback if it fails, follow-up cost — so they are actually comparable; never let each approach sell a different virtue. For each approach: what it is, upside, downside, best-for. Then:

- **Recommend one** with evidence, and say why each alternative is rejected; a bare verdict ("simpler", "better") is not a reason.
- **Concrete scenario**: when approaches are abstract, walk through one ("If we pick A, tomorrow: [input → behavior → result]").
- **Escape condition**: state when the user should prefer the alternative ("pick B only if X").

Never present a single path — always name at least one alternative.

### 5. Validate Before Concluding

Restate what you heard: "Here's what I'm hearing: [problem, scope, non-goals, success criteria]. Does this match?" Incorporate corrections and re-validate.

### 6. DP-1: Requirement Confirmation Gate

After user confirms the summary:
```bash
ssf state set <change-dir> dp_1_result "confirmed: <one-line summary>"
ssf state set <change-dir> dp_1_timestamp now
```
DP-1 confirms scope, non-goals, and success criteria before artifact creation.

### 7. Hand Off

Once DP-1 is recorded, hand off to `spec-writer`.

## Anti-Patterns

- **Skipping exploration**: "Simple" changes have scope too. Five minutes of exploration prevents two hours of rework.
- **Proposing solutions before clarifying**: If the user says "add caching," first ask what problem caching solves.
- **Jargon option menus**: option sets only an expert could rank, or each option judged on a different dimension. If the user cannot compare them, descend one level and settle the prerequisite fact — do not re-explain the same menu.
- **Exploring indefinitely**: Stop when change name, problem statement, scope, non-goals, success criteria, and decomposition decision are all clear.

## Exploration Standard

You must leave exploration with: a usable change name, a crisp problem statement, scope boundaries, non-goals, success criteria, and a decomposition decision (one change or split).

## Strong Rule

Do not produce implementation code. This skill stabilizes intent, not builds.

## Self-Review Before Handoff

1. **Placeholder scan**: No "probably", "maybe", "TBD", or "we'll figure it out later"
2. **Contradiction check**: No scope items conflicting with non-goals or constraints
3. **Scope check**: Can a developer draw a bright line between in and out?

## Exception Handling

- **Parse failures**: Report the specific file, proceed with available information
- **Missing files**: Note absent essential files as constraints, continue
- **User does not understand an option**: never repeat the same menu verbatim. Re-present in plain language with one concrete scenario; if it is still opaque, stop presenting options and ask the single prerequisite question whose answer makes the choice decidable
- **User interruption**: Exploration is stateless — on resume, re-ask the current question

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
