// ssf validate <dir> — validate artifacts in a change directory
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import { loadConfig } from './config-loader.mjs';
import { validateSpecPathLayout, relativeSpecPath } from './spec-paths.mjs';
import { applyDeltaToBaselineDetailed } from './spec-publication.mjs';

async function getValidator() {
  const mod = await import('../../dist/index.js');
  return new mod.Validator(false);
}

function printReport(label, report) {
  console.log(`\n  📋 ${label}`);
  if (report.valid) {
    console.log(`     ✅ valid (${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.info} info)`);
  } else {
    console.log(`     ❌ invalid (${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.info} info)`);
  }
  for (const issue of report.issues) {
    const icon = issue.level === 'ERROR' ? '🔴' : issue.level === 'WARNING' ? '🟡' : '🔵';
    console.log(`     ${icon} [${issue.level}] ${issue.path}: ${issue.message}`);
  }
}

function projectRootForStandardChange(changeDir) {
  const resolvedChangeDir = resolve(changeDir);
  const changesDir = dirname(resolvedChangeDir);
  return basename(changesDir) === 'changes' ? dirname(changesDir) : null;
}

function preflightDeltaBaseline(projectRoot, specFile, content) {
  if (!projectRoot) return null;
  const capability = basename(dirname(specFile));
  const baselinePath = join(projectRoot, 'specs', capability, 'spec.md');
  const baseline = existsSync(baselinePath) ? readFileSync(baselinePath, 'utf-8') : '';
  try {
    applyDeltaToBaselineDetailed(baseline, content, capability);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function run(args) {
  if (args.length < 1) {
    console.error('Usage: ssf validate <change-dir>');
    process.exit(2);
  }

  const changeDir = args[0];
  if (!existsSync(changeDir) || !statSync(changeDir).isDirectory()) {
    console.error(`Error: "${changeDir}" is not a valid directory`);
    process.exit(2);
  }

  const config = loadConfig(process.cwd());
  const changeName = basename(changeDir);
  const projectRoot = projectRootForStandardChange(changeDir);
  const validator = await getValidator();

  console.log(`🔍 Validating: ${changeDir}`);
  console.log(`   Change: ${changeName}`);

  let hasErrors = false;

  // Validate proposal.md
  const proposalPath = join(changeDir, 'proposal.md');
  if (existsSync(proposalPath)) {
    const content = readFileSync(proposalPath, 'utf-8');
    const report = validator.validateChangeContent(changeName, content);
    printReport('proposal.md', report);
    if (!report.valid) hasErrors = true;
  }

  // Validate specs/*/spec.md
  const specLayout = validateSpecPathLayout(changeDir, { requireSpecs: true });
  for (const failure of specLayout.failures) {
    printReport('specs/', {
      valid: false,
      issues: [{ level: 'ERROR', path: 'specs/', message: failure }],
      summary: { errors: 1, warnings: 0, info: 0 },
    });
    hasErrors = true;
  }

  for (const specFile of specLayout.specFiles) {
    const content = readFileSync(specFile, 'utf-8');
    const report = validator.validateDeltaSpec(content);
    const rel = relativeSpecPath(changeDir, specFile);
    printReport(rel, report);
    if (!report.valid) hasErrors = true;
    if (report.valid) {
      const preflightFailure = preflightDeltaBaseline(projectRoot, specFile, content);
      if (preflightFailure) {
        printReport(`${rel} (baseline preflight)`, {
          valid: false,
          issues: [{ level: 'ERROR', path: rel, message: preflightFailure }],
          summary: { errors: 1, warnings: 0, info: 0 },
        });
        hasErrors = true;
      }
    }
  }

  // Basic structural validation for design.md and tasks.md (shared pattern)
  const STRUCTURAL_CHECKS = [
    { file: 'design.md', errorMsg: 'design.md is too short (< 50 chars) — provide architecture decisions, trade-offs, and data flow', warningMsg: 'design.md has no section headings — consider adding ## Architecture, ## Data Flow, ## Error Handling' },
    { file: 'tasks.md', errorMsg: 'tasks.md is too short (< 50 chars) — provide actionable, ordered implementation tasks', warningMsg: 'tasks.md has no section headings — consider adding ## File Structure and ## Tasks' },
  ];

  for (const { file, errorMsg, warningMsg } of STRUCTURAL_CHECKS) {
    const filePath = join(changeDir, file);
    if (!existsSync(filePath)) continue;

    const content = readFileSync(filePath, 'utf-8').trim();
    const issues = [];
    if (content.length < 50) issues.push({ level: 'ERROR', path: file, message: errorMsg });
    if (!content.includes('##')) issues.push({ level: 'WARNING', path: file, message: warningMsg });
    const report = {
      valid: issues.filter(i => i.level === 'ERROR').length === 0,
      issues,
      summary: { errors: issues.filter(i => i.level === 'ERROR').length, warnings: issues.filter(i => i.level === 'WARNING').length, info: 0 },
    };
    printReport(file, report);
    if (!report.valid) hasErrors = true;
  }

  // Scenario coverage matrix（spec 存在带 ID 场景时输出矩阵报告）
  hasErrors = printScenarioCoverage(changeDir, specLayout.specFiles, validator, hasErrors);

  console.log('');
  if (hasErrors) {
    console.log('❌ Validation failed with errors.');
    process.exit(1);
  } else {
    console.log('✅ All artifacts validated.');
    process.exit(0);
  }
}

/**
 * 输出 Scenario 覆盖矩阵报告（S-TRACE-005/006）。
 * 仅当 spec 存在带 ID 场景时启用；缺口为 ERROR，未知声明为 WARNING。
 */
function printScenarioCoverage(changeDir, specFiles, validator, hasErrorsRef) {
  const tasksPath = join(changeDir, 'tasks.md');
  if (specFiles.length === 0 || !existsSync(tasksPath)) return hasErrorsRef;
  const tasksContent = readFileSync(tasksPath, 'utf-8');
  let hasErrors = hasErrorsRef;
  for (const specFile of specFiles) {
    const specContent = readFileSync(specFile, 'utf-8');
    const coverage = validator.validateScenarioCoverage(specContent, tasksContent);
    if (!coverage.applicable) continue;
    const rel = relativeSpecPath(changeDir, specFile);
    const issues = [];
    for (const issue of coverage.idIssues) {
      const where = issue.locations.map(l => `line ${l.lineNumber}`).join(', ');
      issues.push({ level: 'ERROR', path: rel, message: `[scenario-id] ${issue.kind}: ${issue.id} (${where})` });
    }
    for (const id of coverage.missing) {
      issues.push({ level: 'ERROR', path: rel, message: `[scenario-coverage] missing: ${id} — no task covers declaration` });
    }
    for (const id of coverage.declaredButUnknown) {
      issues.push({ level: 'WARNING', path: rel, message: `[scenario-coverage] unknown id declared in tasks: ${id}` });
    }
    const errors = issues.filter(i => i.level === 'ERROR').length;
    const warnings = issues.filter(i => i.level === 'WARNING').length;
    printReport(`${rel} (scenario coverage: ${coverage.covered.length}/${coverage.totalScenarios} covered)`, {
      valid: errors === 0,
      issues,
      summary: { errors, warnings, info: 0 },
    });
    if (errors > 0) hasErrors = true;
  }
  return hasErrors;
}
