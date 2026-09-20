---
name: code-reviewer
description: Review completed implementation batches for spec compliance and code quality. Invoke after execution batches complete, before merging, or when a review gate is reached in the workflow.
# 按需加载资产登记：正文对本 skill 资产的引用必须与本清单一致（lint 四象限校验）。
assets:
  - references/code-reviewer-prompt.md
  - references/adversarial-reviewer-prompt.md
---

# Code Reviewer

Two responsibilities: requesting review (dispatching a reviewer subagent) and receiving review (acting on feedback with technical rigor). **Review early, review often. Verify before implementing feedback.**

## Part 1: Requesting Review

**Mandatory after**: each task in SDD, each planned execution wave, each major feature, before merge.
**Optional**: when stuck, before refactoring, after fixing complex bugs.

### Procedure
1. Get SHAs: `BASE_SHA=$(git rev-parse HEAD~1)` and `HEAD_SHA=$(git rev-parse HEAD)`
2. Dispatch `general-purpose` subagent using template at `skills/code-reviewer/references/code-reviewer-prompt.md`
3. Fill placeholders: `[DESCRIPTION]` (what was built), `[PLAN_OR_REQUIREMENTS]` (contract/spec reference), `[BASE_SHA]`, `[HEAD_SHA]`, `[WAVE_ID]`, and a distinct `[REVIEW_REPORT_FILE]`.
4. Require the reviewer to write a non-empty persisted review report at `.superpowers/sdd/reviews/<wave-id>.md`, then record that exact in-overlay path in the wave receipt with `ssf execution review <change-dir> --wave <wave-id> --base <base-sha> --head <head-sha> --report .superpowers/sdd/reviews/<wave-id>.md --verdict <pass|fail>`. The execution plan initializes this directory; paths outside it are rejected for audit safety.
5. Act on feedback: Critical/Important findings require a `fail` receipt, focused repair, re-review, and replacement `pass` receipt before a dependent wave or closing can proceed. Note Minor for later, push back with reasoning if reviewer is wrong.
6. At `adjudication-required`, wait for a human to run `ssf execution adjudicate <change-dir> --wave <id> --decision allow-review --confirm --reason <text>` before another review. It authorizes one review and never substitutes for `pass`.

### Minimality And Scope

For unrequested complexity, cite the missing task requirement and diff line.
Use Important for merge-blocking complexity and Minor for safe,
behavior-neutral redundancy; never score by line count.

### Anti-Bypass Check

Verify the reviewed diff does not weaken the contract's `## Quality Gates`: no
relaxed or removed assertions, deleted or skipped tests, new `--no-verify` /
`@ts-ignore` / `eslint-disable` escapes, or edits to lint, type, or CI
configuration. Any of these without a recorded user approval in the contract is
a Critical finding and requires a `fail` receipt.

### Security Baseline Check

Verify the reviewed diff meets the contract's `## Quality Gates` security baseline:

- **Secrets**: no credentials, tokens, API keys, or private keys in the diff; config and secrets must live outside version control.
- **Dependencies**: every newly added dependency carries a recorded audit result — an ecosystem audit command or an explicit manual review.

A leaked credential, or a newly added dependency with a known high-severity vulnerability, is Critical. A missing or unrecorded check is Important: the change is unverified, not merely untidy. When the project has no tooling, require the substitute recorded under the contract's anti-bypass rule 5.

### Adversarial Review (high-risk waves)

The standard review doubts the report while reading it. When an unexamined assumption is itself the danger, dispatch the template at `skills/code-reviewer/references/adversarial-reviewer-prompt.md` **instead of** the standard template — same gate, same receipt mechanism, deeper method.

**Trigger when any one holds:** irreversible actions (schema/data migration, deletion, authn/authz, payment, crypto); unfamiliar or unowned code spanning 3+ modules; the implementer self-reported DONE_WITH_CONCERNS; or a relevant design decision is labeled `unverified`.

Fresh-context rules: dispatch a new subagent receiving only the binding requirements (verbatim), the relevant design excerpt with Sources labels, the trigger reason, and the diff — never the implementer's report or conversation history. Resolve the standard review profile; a stronger profile or model upgrade needs explicit user approval before dispatch, with the trigger and cost disclosed. The report lands at `.superpowers/sdd/reviews/<wave-id>-adversarial.md`. A refuted or unresolved proposition on a high-risk path is a `fail` receipt plus human escalation — never an optimistic pass. Do not run it as an extra gate on top of the standard review; it replaces that wave's standard review.

## Part 2: Receiving Review Feedback

### The Response Pattern
1. READ feedback without reacting
2. UNDERSTAND and restate requirement
3. VERIFY against codebase reality
4. EVALUATE: technically sound for THIS codebase?
5. RESPOND: technical acknowledgment or reasoned pushback
6. IMPLEMENT: one item at a time, test each

### Severity Levels

| Level | Meaning | Action |
|-------|---------|--------|
| Critical | Bugs, security, data loss, broken functionality | Fix immediately |
| Important | Architecture problems, missing features, poor error handling, test gaps | Fix before next batch |
| Minor | Code style, optimization, documentation polish | Note for later |

### Forbidden Responses
Never: performative agreement ("You're right!", "Great point!"), blind implementation before verification, thanking the reviewer. Instead: restate the requirement, ask clarifying questions, push back with reasoning, or just fix it (actions > words).

### Handling Unclear Feedback
If any item is unclear → STOP. Do not implement anything yet. Ask for clarification on unclear items. Partial understanding = wrong implementation.

### Source-Specific Rules

**From user**: Trusted — implement after understanding. Still ask if scope unclear. No performative agreement.

**From external reviewer**: Before implementing, check: technically correct for this codebase? breaks existing functionality? reason for current implementation? works on all platforms? reviewer understands full context? If suggestion seems wrong, push back with technical reasoning.

### When to Push Back
Suggestion breaks existing functionality, reviewer lacks context, violates YAGNI, technically incorrect for this stack, legacy/compatibility reasons, conflicts with user's architectural decisions. Push back with technical reasoning, not defensiveness.

### Implementation Order
1. Clarify unclear items first
2. Fix blocking issues (breaks, security)
3. Fix simple issues (typos, imports)
4. Fix complex issues (refactoring, logic)
5. Test each fix individually, verify no regressions

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Performative agreement | State requirement or just act |
| Blind implementation | Verify against codebase first |
| Batch without testing | One at a time, test each |
| Proceeding without a wave receipt | Record `pass`/`fail` via `ssf execution review` before the next dependent wave |
| Assuming reviewer is right | Check if breaks things |
| Avoiding pushback | Technical correctness > comfort |
| Partial implementation | Clarify all items first |

## Exception Handling

- **Parse failures**: Report specific file, request regenerated review package
- **Missing files**: Regenerate via `scripts/review-package`. Empty diff = nothing to review
- **User interruption**: Re-read review report on resume, continue from next unreviewed batch

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
