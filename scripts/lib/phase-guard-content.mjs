export function createPhaseGuardContent({ platformId, format = 'md', alwaysApply = true } = {}) {
  const body = `# spec-superflow — opt-in (${platformId ?? 'plugin'})

Apply this workflow only when the user explicitly requests spec-superflow or the user asks to continue an active change that contains \`.spec-superflow.yaml\`. Generic proposal, spec, design, task, or contract files are not activation signals. Otherwise ignore this rule and handle the task normally.

Analyze the request first: read-only questions, analysis, and information lookup may be answered directly. When a request may involve code changes, bug fixes, or creating or continuing a change, recommend entering through \`workflow-start\` with your reasons and let the user decide before routing; do not start writing code before the user has chosen a path and the current state and workflow are confirmed in \`.spec-superflow.yaml\`. Workflow gates (contract, execution plan, review receipts) stay intact on every path.

When active, enter through \`workflow-start\`; it loads the current state and applicable gates.
`;
  if (format !== 'mdc' && alwaysApply) return body;
  const frontmatter = alwaysApply
    ? 'description: spec-superflow opt-in workflow guard\nalwaysApply: true'
    : 'alwaysApply: false';
  return `---
${frontmatter}
---

${body}`;
}
