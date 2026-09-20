// scripts/lib/runtime-rewrite.mjs
// Shared portable-runtime rewriting for installers. Deployed skills/commands
// must invoke the local runtime via `node <pluginRoot>/scripts/spec-superflow.mjs`
// rather than a globally linked `ssf` or a pinned `npx` package, so every
// installer rewrites those forms to the local runtime on copy.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { shellQuote } from './shell-quote.mjs';

// All `ssf` subcommands that a deployed skill/command may invoke. Must stay in
// sync with scripts/spec-superflow.mjs COMMANDS. `debug` is required because
// bug-investigator uses `ssf debug attempt ...`.
export const SSF_SUBCOMMANDS = [
  'audit',
  'checkpoint',
  'config',
  'debug',
  'doctor',
  'execution',
  'finish',
  'handoff',
  'inject',
  'isolate',
  'list',
  'resume',
  'runtime',
  'save',
  'state',
  'switch',
  'sync',
  'validate',
  'version',
  'workflow',
];

/**
 * Matches any portable runtime invocation in a skill/command body:
 *   - `npx --yes --package spec-superflow@<ver> ssf`
 *   - `node scripts/spec-superflow.mjs`
 *   - a bare `ssf <subcommand>`
 */
export function portableRuntimePattern() {
  return new RegExp(
    `(?:npx --yes --package spec-superflow@\\d+\\.\\d+\\.\\d+ ssf|node scripts\\/spec-superflow\\.mjs|\\bssf(?=\\s+(?:${SSF_SUBCOMMANDS.join('|')})\\b))`,
    'g',
  );
}

/**
 * Rewrite every portable runtime invocation in `content` to the deployed local
 * runtime `node <pluginRootAbs>/scripts/spec-superflow.mjs`.
 */
export function rewriteRuntime(content, pluginRootAbs) {
  const nodeCmd = `node ${shellQuote(join(pluginRootAbs, 'scripts', 'spec-superflow.mjs'))}`;
  return content.replace(portableRuntimePattern(), nodeCmd);
}

/** Recursively collect every markdown file under `dir`, sub-directories included. */
function collectMarkdownFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collectMarkdownFiles(full));
    } else if (entry.endsWith('.md')) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Rewrite every markdown file under a deployed skill directory, recursively:
 * `${CLAUDE_PLUGIN_ROOT}` placeholders and portable runtime invocations are
 * both replaced. Covers SKILL.md, sub-prompts, and nested reference files.
 * Returns the number of files rewritten.
 */
export function rewriteSkillMarkdown(dir, pluginRootAbs) {
  const files = collectMarkdownFiles(dir);
  for (const file of files) {
    let content = readFileSync(file, 'utf-8');
    if (content.includes('${CLAUDE_PLUGIN_ROOT}')) {
      content = content.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRootAbs);
    }
    writeFileSync(file, rewriteRuntime(content, pluginRootAbs), 'utf-8');
  }
  return files.length;
}
