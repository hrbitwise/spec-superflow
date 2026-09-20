#!/usr/bin/env node
// lint-skills.mjs — Skill content static analyzer
// Scans skills/*/SKILL.md (entry docs) plus skills/**/*.md (on-demand assets)
// against registered rules, outputs structured report.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildReferenceGraph } from './rules/asset-references.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, '..', '..', 'skills');
const RULES_DIR = join(__dirname, 'rules');

async function loadRules() {
  if (!existsSync(RULES_DIR)) return [];
  const ruleFiles = readdirSync(RULES_DIR).filter(f => f.endsWith('.mjs'));
  const rules = [];
  for (const file of ruleFiles.sort()) {
    try {
      // Windows 下动态 import 只接受 file:// URL，裸盘符路径（如 d:\...）会被 ESM 加载器拒绝，必须转换
      const mod = await import(pathToFileURL(join(RULES_DIR, file)).href);
      if (mod.default && typeof mod.default.check === 'function') {
        rules.push(mod.default);
      }
    } catch (e) {
      console.error(`Warning: failed to load rule ${file}: ${e.message}`);
    }
  }
  return rules;
}

/**
 * 递归收集目录下全部 .md 文件，返回相对 rootDir 的 posix 路径排序列表。
 * @param {string} rootDir - 扫描根目录
 * @returns {string[]} 如 ['build-executor/SKILL.md', 'build-executor/references/implementer-prompt.md']
 */
function collectMarkdowns(rootDir) {
  const found = [];
  /**
   * 深度优先递归单层目录
   * @param {string} dir - 当前遍历目录
   */
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        found.push(relative(rootDir, full).split(sep).join('/'));
      }
    }
  };
  if (existsSync(rootDir)) walk(rootDir);
  return found.sort();
}

/**
 * 判断规则是否适用于当前文件。
 * appliesTo === 'all' 的规则覆盖入口与子文件；缺省规则只跑 SKILL.md 入口。
 * @param {object} rule - 规则 bundle
 * @param {boolean} isSkillEntry - 当前文件是否为 <skill>/SKILL.md
 * @returns {boolean}
 */
function ruleApplies(rule, isSkillEntry) {
  return rule.appliesTo === 'all' || isSkillEntry;
}

/**
 * 读取全部 skill 资产并构建引用图上下文（悬空 / 孤儿判定的共享状态）。
 * @param {string[]} allDirs - 全部 skill 目录名
 * @returns {{assetContents: Map<string,string>, assets: Set<string>, referenced: Set<string>, repoRoot: string}}
 */
function buildAssetContext(allDirs) {
  const assetContents = new Map();
  // 统一以 SKILLS_DIR 为路径基准收集（rel 形如 build-executor/SKILL.md），避免基准错位
  for (const rel of collectMarkdowns(SKILLS_DIR)) {
    if (!allDirs.includes(rel.split('/')[0])) continue;
    assetContents.set(rel, readFileSync(join(SKILLS_DIR, ...rel.split('/')), 'utf-8'));
  }
  return {
    assetContents,
    assets: new Set(assetContents.keys()),
    referenced: buildReferenceGraph(assetContents),
    repoRoot: join(SKILLS_DIR, '..'),
  };
}

/**
 * 对单个 markdown 文件执行适用规则，返回带 file 标注的 issues。
 * @param {object[]} rules - 已加载规则
 * @param {string} skillName - skill 目录名
 * @param {string} rel - 文件相对 skills 目录的 posix 路径
 * @param {string} content - 文件内容
 * @param {object} baseCtx - 共享上下文
 * @returns {Promise<Array>}
 */
async function runRulesForFile(rules, skillName, rel, content, baseCtx) {
  const isSkillEntry = rel === `${skillName}/SKILL.md`;
  const ctx = { ...baseCtx, file: rel, isSkillEntry };
  const issues = [];
  for (const rule of rules) {
    if (!ruleApplies(rule, isSkillEntry)) continue;
    try {
      const ruleIssues = await rule.check(skillName, content, ctx);
      if (Array.isArray(ruleIssues)) {
        issues.push(...ruleIssues.map(i => ({ ...i, rule: rule.name || 'unknown', file: rel })));
      }
    } catch (e) {
      issues.push({ severity: 'error', rule: rule.name || 'unknown', file: rel, message: `Rule threw: ${e.message}` });
    }
  }
  return issues;
}

/**
 * @param {Object} options
 * @param {string[]} [options.skills] — specific skill names to lint (default: all)
 * @returns {Promise<{valid: boolean, results: Array, summary: string}>}
 */
export async function lintSkills(options = {}) {
  const rules = await loadRules();
  const allDirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const skillDirs = options.skills
    ? allDirs.filter(s => options.skills.includes(s))
    : allDirs;

  const assetCtx = buildAssetContext(allDirs);
  const baseCtx = {
    skillDirs: allDirs,
    skillsDir: SKILLS_DIR,
    assets: assetCtx.assets,
    referenced: assetCtx.referenced,
    repoRoot: assetCtx.repoRoot,
  };

  const results = [];
  for (const skillName of skillDirs) {
    // 资产路径一律相对 SKILLS_DIR（如 build-executor/SKILL.md），直接从全量清单按前缀过滤
    const files = [...assetCtx.assets]
      .filter(rel => rel.startsWith(`${skillName}/`))
      .sort();
    if (files.length === 0) {
      results.push({ skill: skillName, issues: [{ severity: 'error', rule: 'file-existence', file: `${skillName}/SKILL.md`, message: 'SKILL.md not found' }] });
      continue;
    }

    const issues = [];
    for (const rel of files) {
      const content = assetCtx.assetContents.get(rel);
      issues.push(...await runRulesForFile(rules, skillName, rel, content, baseCtx));
    }
    if (!files.includes(`${skillName}/SKILL.md`)) {
      issues.unshift({ severity: 'error', rule: 'file-existence', file: `${skillName}/SKILL.md`, message: 'SKILL.md not found' });
    }

    results.push({ skill: skillName, issues });
  }

  const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
  const errorCount = results.reduce((sum, r) => sum + r.issues.filter(i => i.severity === 'error').length, 0);

  return {
    valid: errorCount === 0,
    results,
    summary: `${totalIssues} issue(s) (${errorCount} errors) across ${results.length} skills`,
  };
}

/**
 * Load only token-specific rules (--include token).
 */
async function loadTokenRules() {
  const tokenRulesPath = join(RULES_DIR, 'token-rules.mjs');
  if (!existsSync(tokenRulesPath)) return [];
  try {
    const mod = await import(pathToFileURL(tokenRulesPath).href);
    return mod.default && typeof mod.default.check === 'function' ? [mod.default] : [];
  } catch (e) {
    console.error(`Warning: failed to load token-rules: ${e.message}`);
    return [];
  }
}

/**
 * Token 模式：对 skills/**&#47;*.md 全量文件（或 --file 指定文件）执行尺寸预算规则。
 * 结果仍按 skill 目录分组，保持每 skill 一条 result 的报告契约。
 * @param {object[]} rules - token 规则集
 * @param {string|null} fileArg - --file 指定的绝对路径，null 表示全量扫描
 * @returns {Promise<{valid: boolean, results: Array, summary: string}>}
 */
async function lintTokenMode(rules, fileArg) {
  const allDirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  const assetCtx = buildAssetContext(allDirs);
  const baseCtx = {
    skillDirs: allDirs,
    skillsDir: SKILLS_DIR,
    assets: assetCtx.assets,
    referenced: assetCtx.referenced,
    repoRoot: assetCtx.repoRoot,
  };

  // 单文件模式：路径归一化为相对 skills 目录的 posix 路径，只扫描该文件
  const targetFiles = fileArg
    ? [relative(SKILLS_DIR, fileArg).split(sep).join('/')]
    : [...assetCtx.assets].sort();

  const grouped = new Map();
  for (const rel of targetFiles) {
    const skillName = rel.split('/')[0];
    if (!grouped.has(skillName)) grouped.set(skillName, []);
    const mdPath = join(SKILLS_DIR, ...rel.split('/'));
    if (!existsSync(mdPath)) {
      grouped.get(skillName).push({ severity: 'error', rule: 'file-existence', file: rel, message: 'file not found' });
      continue;
    }
    const content = assetCtx.assetContents.get(rel) || readFileSync(mdPath, 'utf-8');
    grouped.get(skillName).push(...await runRulesForFile(rules, skillName, rel, content, baseCtx));
  }

  const results = [...grouped.entries()].map(([skill, issues]) => ({ skill, issues }));
  const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
  const errorCount = results.reduce((sum, r) => sum + r.issues.filter(i => i.severity === 'error').length, 0);
  return {
    valid: errorCount === 0,
    results,
    summary: `${totalIssues} issue(s) (${errorCount} errors) across ${results.length} skills`,
  };
}

// CLI entry
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const includeToken = process.argv.includes('--include') && process.argv[process.argv.indexOf('--include') + 1] === 'token';
  const verbose = process.argv.includes('--verbose');
  const fileArgIdx = process.argv.indexOf('--file');
  const fileArg = fileArgIdx !== -1 ? process.argv[fileArgIdx + 1] : null;

  let report;
  if (includeToken) {
    // Token mode: only run token rules, across all markdown assets
    const rules = await loadTokenRules();
    report = await lintTokenMode(rules, fileArg);
  } else {
    report = await lintSkills();
  }

  if (!report.valid || verbose) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`✅ ${report.summary}`);
  }
  process.exit(report.valid ? 0 : 1);
}
