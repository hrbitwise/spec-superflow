# AGENTS.md

This file provides guidance to AI coding agents working in this repository.

## What This Is

A self-contained plugin that integrates OpenSpec-style planning + Superpowers execution discipline. Zero runtime dependencies. This line is a fork superset of upstream v2: the v2 execution model plus ported v1.5 capabilities (scenario-ID traceability, `doctor skills`/`doctor vault` gates, the Trae installer, the design-template Boundary Check, advisory phase-guard semantics).

Supports 20 installation surfaces (Claude Code, Cursor, OpenAI Codex CLI/App, GitHub Copilot CLI, Gemini CLI, OpenCode, WorkBuddy, CatPaw, CodeBuddy, Trae, Cline, Kiro, Windsurf, Qwen Code, Amazon Q, Roo Code, Continue, Pi, ZCODE, Qoder). See `INSTALL.md` for the full matrix and `scripts/lib/platform-runtime-inventory.mjs` for the runtime inventory.

## Current default (new changes)

Use only when the user opts into spec-superflow. New tasks have direct and planned entry points (`ssf workflow start <dir> --path direct|planned`), not a five-path questionnaire. Planned work uses proposal.md + tasks.md and one concrete approval; specs/design are optional. No handwritten execution-contract or recommendation receipt is required. Native/final is default; delegation and worktrees are explicit. Ordinary debugging stays in executing. `ssf workflow complete` runs final checks and records verified or explicit accepted-risk delivery; failure is never rewritten as pass. User instructions always take precedence.

## Commands

```bash
# Build TypeScript
npm run build

# Run integration tests
npm test

# Run single test (Node 20+ native test runner)
node --test tests/e2e.test.mjs --test-name-pattern="parseDeltaSpec"

# Validate artifacts (uses docs/examples/ data)
npm run validate

# Skill ↔ CLI consistency gate (also a CI gate)
node scripts/spec-superflow.mjs doctor skills

# Bump version across all manifests/docs
node scripts/spec-superflow.mjs version <semver>
```

## Architecture

### Source Code (`src/`)

TypeScript interfaces + regex-based parsers. Compiles to `dist/` (ES2022 + NodeNext + strict).

- `schema/` — Type definitions: `base.ts` (Requirement, Scenario), `change.ts` (Delta operations), `spec.ts`
- `parsing/` — `requirement-blocks.ts` parses delta spec markdown (scenario-ID aware). `change-parser.ts` extracts `## Why` + `## What Changes` + delta sections from proposal markdown (fence-aware).
- `validation/` — `validator.ts` validates artifacts against schema rules; `constants.ts` holds thresholds. All public API re-exported from `src/index.ts`.

### Validation Rules

- **spec.md**: Each Requirement must contain `SHALL` or `MUST`, at least 1 `#### Scenario:` block. Scenarios may carry IDs (`#### Scenario: S-<CAP>-NNN: title`, unique per change); tasks then declare `covers: S-...-NNN, ...` and `ssf validate` renders a coverage matrix — spec publication blocks on uncovered ID-bearing scenarios.
- **Delta spec**: ADDED/MODIFIED must have requirement text + scenarios; cross-section conflicts blocked.
- **proposal.md**: `## Why` ≥ 50 characters, `## What Changes` cannot be empty.
- `Validator` returns `ValidationReport` with `{valid, issues: [{level, path, message}], summary}`. Strict mode treats warnings as errors.

### Skills and workflow (`skills/`)

Nine skills, one per directory (flat layout: sub-prompt files sit next to SKILL.md). New changes use direct or planned; read `skills/workflow-start/SKILL.md` when explicitly enabling the workflow. Load only the skill needed for the current action: need-explorer (uncertain scope), spec-writer (concrete plan; teaches the design-template Boundary Check), build-executor (implementation), bug-investigator (diagnosis; escalation needs at least three evidence-backed failed attempts), code-reviewer (review), spec-merger (delta specs), release-archivist (closure). contract-builder is only for existing legacy contracts.

For an existing change, identify the current path from recorded state and evidence: direct requires a valid schema-3 workflow-selection receipt; planned requires a schema-2 execution plan. Schema-1/2 direct receipts, legacy plans, `workflow recommend/select/accept` and the eight-state routing are legacy recovery only ([docs/legacy-workflow.md](docs/legacy-workflow.md)); retain original approvals and never migrate active legacy changes automatically. Missing or corrupt evidence requires investigation, not reinitialization.

### Scripts and guards (`scripts/`)

- `spec-superflow.mjs` — bundled CLI dispatcher (`ssf` / `spec-superflow`).
- `lib/cmd-*.mjs` — command modules; `lib/skill-consistency.mjs` powers `ssf doctor skills`; `lib/vault-drift.mjs` powers `ssf doctor vault`; `lib/phase-guard-content.mjs` is the single source of the opt-in + advisory entry guard shipped to every platform.
- Source skills use `SSF` as the placeholder for the bundled runtime; runtime references go through the allowlisted `ssf runtime asset read`. Installers must carry both skills and referenced assets.

### Templates and examples

- `templates/*.md` — artifact formats; `templates/design.md` includes the mandatory Boundary Check section (layer attribution, repo/module landing, extension priority, prohibited items, boundary-contract reference).
- `docs/examples/` — complete change sets (`add-dark-mode` with scenario IDs, `refactor-auth-boundary`) used by tests as real input data.

## Design Decisions

- **`dist/` is committed** — the plugin is consumed via skills and scripts, not as an npm package. Tracking `dist/` lets validation scripts work immediately after cloning.
- **Tests import from `dist/`, not `src/`** — always run `npm run build` before `npm test`.
- **CLI source is the single source of truth for skill docs** — `ssf doctor skills` re-derives commands/flags/assets/thresholds from the code and fails on drift; keep docs and engine constants in sync in the same change.
- **Self-contained** — does not require OpenSpec or Superpowers to be installed. Absorbed concepts are reimplemented here.
- **Zero runtime dependencies** — only TypeScript as devDependency.
- **Multi-platform, single source** — same 9 skills across 20 surfaces. Platform wiring is isolated to hooks, plugin manifests, and installers (`.claude-plugin/`, `.cursor-plugin/`, `.codex-plugin/`, `.github/plugin/`, `.opencode/`, `.agents/`, `gemini-extension.json`, `scripts/install-*.mjs`, `scripts/lib/cmd-install-*.mjs`, `scripts/lib/platforms.mjs`).

## CI/CD (`.github/workflows/ci.yml`)

- **Push/PR to `main`**: Build + test on a Node 20/22 matrix + Plugin Scanner + installer smoke tests (including `install-trae`) + the `doctor skills` hard gate.
- **Tag push `v*`**: Build + test + gates → `gh release create`. CI does **not** publish to npm; publishing to the Aliyun private registry (`npm publish --registry=https://registry.anpm.alibaba-inc.com`) is a manual local step documented in `docs/release-checklist.md`.

## Testing

Tests import from `dist/index.js` (compiled output), not source. Run `npm run build` before `npm test`.

Test data lives in `docs/examples/` — real proposal/spec/design artifacts from `add-dark-mode` and `refactor-auth-boundary` scenarios. Tests that need a POSIX shell skip cleanly on Windows (`hasBash` guard).

### Windows development notes

- PowerShell 5 has no `&&`; chain commands with `;`.
- The repo enforces LF; prefer the file tools over `Out-File` (which writes BOM/CRLF) for content changes.
- `node scripts/lint/lint-skills.mjs` prints rule-loader warnings on Windows (`d:` paths are not `file://` URLs); lint still reports 0 errors. CI runs it on Linux where rules load cleanly.

## Release Checklist

Refer to `docs/release-checklist.md` before publishing. Key items:
- Keep `README.md`, `docs/README_en.md`, `INSTALL.md`, `CHANGELOG.md`, and all plugin manifests/installers in sync. Use `ssf version <semver>` (then update the Codex `--ref` example in `docs/README_en.md` if the version-sync did not cover it).
- Verify examples are complete; no stray `TODO` or `TBD` markers.
- `package.json` version matches `.claude-plugin/plugin.json` version.
- npm publish is a manual local step to the Aliyun private registry; CI only creates the GitHub Release.
