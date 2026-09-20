# Adversarial Reviewer Prompt Template

Use this template **instead of** `code-reviewer-prompt.md` for a high-risk
wave when the trigger conditions in `code-reviewer/SKILL.md` apply. It is the
same wave gate with a different method: the reviewer builds an independent
judgment from requirements and diff alone, before encountering any
implementer explanation.

**Purpose:** catch "agreed mistakes" — claims the implementer and a normal
reviewer would both accept because they sound plausible, not because they
were verified.

```
Subagent (general-purpose):
  description: "Adversarial review of wave [WAVE_ID]"
  model: [MODEL — REQUIRED: resolve the standard review profile; a stronger
         profile or model upgrade needs explicit user approval before dispatch]
  prompt: |
    You are performing an ADVERSARIAL review for wave [WAVE_ID]. You were
    deliberately given no implementer report and no conversation history.
    Build your own judgment from the requirements and the diff. Plausibility
    is not evidence.

    ## Inputs (complete list)

    - Requirements binding this wave: [PLAN_OR_REQUIREMENTS]
    - Relevant design decisions, including their Sources labels: [DESIGN_EXCERPT]
    - Why adversarial review was triggered: [TRIGGER]
    - Base: [BASE_SHA], Head: [HEAD_SHA]
    - Planned wave ID: [WAVE_ID]

    Inspect with:
      git diff --stat [BASE_SHA]..[HEAD_SHA]
      git diff [BASE_SHA]..[HEAD_SHA]

    Read files outside the diff only to test a claim you extracted below —
    one focused check per claim, recording both the claim and what you
    checked. Read-only on this checkout: never mutate the working tree, the
    index, HEAD, or branch state; use git show/diff/log to inspect.

    Why there is no implementer report: explanations anchor the reader —
    "the API guarantees X" is then read as fact. Your job is to discover
    what the code actually assumes, not to grade someone else's description.

    ## Protocol: CLAIM → EXTRACT → DOUBT → RECONCILE → STOP

    1. CLAIM — list the factual claims embedded in the diff: code comments,
       commit messages, test assumptions, and guard clauses that imply a
       precondition ("the caller is already authenticated", "this branch is
       unreachable", "the API returns ordered rows", "config was validated
       upstream", "this lock is always held here").
    2. EXTRACT — rewrite each claim as one falsifiable proposition.
    3. DOUBT — for each proposition, construct the condition that breaks
       it: which input, state, caller, ordering, or version makes it false?
       Check call sites and named sources yourself; "the comment says so"
       is never confirmation. Give extra scrutiny to decisions labeled
       `unverified` in the design excerpt.
    4. RECONCILE — mark every proposition:
       - **confirmed**: evidence found — cite file:line or the exact source;
       - **refuted**: a breaking condition exists — cite it;
       - **unresolved**: neither proved nor disproved after focused checks.
    5. STOP — an unresolved proposition on a high-risk path (data loss,
       authorization, security, money, irreversible actions) blocks the
       wave. Do not guess, do not pass on optimism: escalate it for a human
       decision.

    ## Standard Checks Still Apply

    Run the normal wave-review checklist as well: spec/contract alignment,
    minimality and scope (cite the missing requirement and diff line for
    any unrequested addition), code quality, tests, and the contract
    `## Quality Gates` security baseline — no credentials/tokens/keys in
    the diff, an audit result for every newly added dependency, and
    `uncovered` recorded honestly where project tooling is absent.

    ## Output Format

    Write your full verdict to
    `[CHANGE_DIR]/.superpowers/sdd/reviews/[WAVE_ID]-adversarial.md`. This
    path must point to a non-empty, persisted report before the controller
    records the receipt. Include the wave ID, base/head SHA, and the
    trigger reason. End with the exact receipt command:

    ```bash
    ssf execution review <change-dir> --wave [WAVE_ID] --base [BASE_SHA] --head [HEAD_SHA] --report [REVIEW_REPORT_FILE] --verdict <pass|fail>
    ```

    Verdict rules:
    - `fail` for any refuted proposition on a high-risk path, any
      Critical/Important finding from the standard checklist, or any
      unresolved high-risk proposition (recorded under Escalations).
    - `pass` only when every high-risk proposition is confirmed with cited
      evidence and no Critical/Important finding remains.
    A repair needs a fresh review and a replacement `pass` receipt before
    any dependent wave or closing transition.

    ### Claim Register

    | # | Claim (file:line) | Falsifiable proposition | Breaking condition | Verdict | Evidence |
    |---|-------------------|-------------------------|--------------------|---------|----------|

    ### Issues

    #### Critical (Must Fix)
    #### Important (Should Fix)
    #### Minor (Nice to Have)

    For each issue: file:line, what is wrong, why it matters, how to fix.

    ### Escalations
    [Unresolved high-risk propositions requiring a human decision, each with
    the proposition, the checks already performed, and the residual unknown.]

    ### Assessment

    **Ready to merge?** [Yes | No | With fixes]
    **Reasoning:** [1-2 sentence technical assessment]
```

**Placeholders:**
- `[MODEL]` — REQUIRED: standard review profile via `ssf runtime config --resolve-model`; any stronger profile requires prior user approval
- `[PLAN_OR_REQUIREMENTS]` — the contract acceptance items and spec SHALL/MUST lines binding this wave, quoted verbatim (not a summary)
- `[DESIGN_EXCERPT]` — the design decisions relevant to this wave with their Sources labels (`internal` / cited / `unverified`); never the whole design document
- `[TRIGGER]` — which adversarial-review trigger condition fired
- `[BASE_SHA]` / `[HEAD_SHA]` — wave commit range
- `[WAVE_ID]` — planned wave under review
- `[CHANGE_DIR]` / `[REVIEW_REPORT_FILE]` — change directory and the adversarial report path `.superpowers/sdd/reviews/<wave-id>-adversarial.md`

**Reviewer returns:** Claim Register, Issues (Critical/Important/Minor), Escalations, Assessment, and the receipt command.
