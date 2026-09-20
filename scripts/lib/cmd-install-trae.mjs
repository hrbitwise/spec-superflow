// ssf install-trae — deploy spec-superflow for Trae (CN & international editions).
//
// Trae reads skills from ~/.trae-cn/skills/ or ~/.trae/skills/ (global, not
// project-level). user_rules/*.md files are auto-loaded as always-on context.
// The shared skills/ directory contains unrelated 3rd-party skills — we must
// ONLY replace the 9 spec-superflow skill subdirectories and never wipe the
// whole directory. Runtime dependencies live under a dedicated
// spec-superflow/ subdirectory that serves as ${CLAUDE_PLUGIN_ROOT}.
//
// Deploy layout (Trae CN example; international swaps .trae/ for .trae-cn/):
//   ~/.trae-cn/
//   ├── spec-superflow/                 ← pluginRoot (runtime deps)
//   │   ├── scripts/  docs/  templates/  dist/  hooks/
//   │   └── package.json
//   ├── skills/                         ← deployed skills (OTHER SKILLS PRESERVED)
//   │   ├── workflow-start/
//   │   └── ... (9 skills; names match source exactly)
//   └── user_rules/
//       └── phase-guard.md              ← always-on phase guard (plain md)
//
// Re-running the installer upgrades in place: it replaces the spec-superflow/
// runtime dir and refreshes only the source-named skill directories.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { cp, writeFile, mkdtemp } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { rewriteSkillMarkdown } from './runtime-rewrite.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultPluginRoot = resolve(__dirname, '..', '..');

const PLUGIN_NAME = 'spec-superflow';
const GITHUB_REPO = 'hrbitwise/spec-superflow';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const RUNTIME_DIRS = ['scripts', 'docs', 'templates', 'dist', 'hooks'];

/** Trae 用户级目录的候选顺序：优先 CN，fallback 国际版。 */
const TRAE_ROOTS = ['.trae-cn', '.trae'];

// ─── helpers ──────────────────────────────────────────────

/** 确保目录存在（不存在则递归创建）。 */
function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** 探测用户的 Trae 安装根目录。优先命中 ~/.trae-cn；命中失败则用 ~/.trae。 */
function detectTraeRoot(explicitDir) {
  if (explicitDir) return resolve(explicitDir);
  const h = homedir();
  for (const name of TRAE_ROOTS) {
    const candidate = join(h, name);
    if (existsSync(candidate)) return candidate;
  }
  // 两个都不存在时默认装 CN（最常见），安装时自动创建。
  return join(h, TRAE_ROOTS[0]);
}

/** 列出源码仓 skills/ 下的全部合法 skill 目录名。 */
function listSkillNames(skillsDir) {
  if (!existsSync(skillsDir)) {
    throw new Error(`skills/ directory not found at ${skillsDir}`);
  }
  return readdirSync(skillsDir)
    .filter(name => {
      const dir = join(skillsDir, name);
      return statSync(dir).isDirectory() && existsSync(join(dir, 'SKILL.md'));
    })
    .sort();
}

/** 递归拷贝目录，返回文件总数。 */
async function copyDir(src, dst) {
  if (!existsSync(src)) return 0;
  ensureDir(dst);
  const entries = readdirSync(src);
  let fileCount = 0;
  for (const name of entries) {
    const srcPath = join(src, name);
    const dstPath = join(dst, name);
    const st = statSync(srcPath);
    if (st.isDirectory()) {
      fileCount += await copyDir(srcPath, dstPath);
    } else {
      await cp(srcPath, dstPath, { force: true });
      fileCount += 1;
    }
  }
  return fileCount;
}

/**
 * 把源码 skills 拷贝到共享的 ~/.trae-cn/skills/ 目录。
 * 仅删除源中存在的 skill 目录名（other 第三方 skill 完全保留）。
 */
async function copySkillsWithRoot(sourceSkills, targetSkills, pluginRootAbs, sourceSkillNames) {
  if (existsSync(targetSkills)) {
    for (const name of sourceSkillNames) {
      const dir = join(targetSkills, name);
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  ensureDir(targetSkills);

  for (const name of sourceSkillNames) {
    const src = join(sourceSkills, name);
    const dst = join(targetSkills, name);
    await cp(src, dst, { recursive: true, force: true });
    rewriteSkillMarkdown(dst, pluginRootAbs);
  }
  return sourceSkillNames.length;
}

/** phase-guard 规则内容（Trae user_rules 是纯 md，无 frontmatter）。 */
function phaseGuardContent(platform = 'trae') {
  return `# Phase Guard — spec-superflow (${platform})

## 入口规则

- 所有工作必须从 "/workflow-start" 入口开始。
- 在 .spec-superflow.yaml 中确认当前 state 和 workflow 模式之前，不要开始写代码。

## 全局禁止

- Full 或 legacy Hotfix 没有 execution-contract.md 或未经用户明确批准，不得进入实现。
- Full 或 legacy Hotfix 必须先运行 ssf execution plan <change-dir> ...；没有 current execution plan 不得开始实现。
- 只有 Full/legacy Hotfix 的 all pass review receipts 后才可 closing；不得把未审查的 wave 当作完成。
- Quick、direct Hotfix、tweak 不要求 contract、execution plan、review receipt 或 DP-3/DP-4；它们须在边界内验证并持久化 test_result: pass。direct Hotfix 必须验证原症状回归。
- 执行过程中如果发现需求/范围变化，必须回退到 specifying 或 bridging，而不是直接改代码。
- 不要直接调用执行类 skill（如 "/build-executor"），必须通过入口路由。

## 决策点协议

- DP-0：设计前确认
- DP-1：需求确认
- DP-2：工件审查
- DP-3/DP-4：仅 Full 或 legacy Hotfix 需要 contract 批准与执行模式确认。
- DP-5：调试升级
- DP-6：验证失败
- DP-7：是否收口归档？

> 本文件由 spec-superflow 安装脚本生成（platform: ${platform}）；
> 对具体变更的 guard 内容请运行 \`ssf inject <change-dir>\` 更新。
`;
}

/** 读 package.json 的 version 字段，缺失时返回 '0.0.0'。 */
function readVersion(pluginRoot) {
  try {
    const pkg = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// ─── release fetch / clone ────────────────────────────────

async function fetchLatestTag() {
  const res = await fetch(GITHUB_API_URL);
  if (!res.ok) throw new Error(`GitHub API failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (!data.tag_name) throw new Error('GitHub API response missing tag_name');
  return data.tag_name;
}

async function cloneRelease(tag) {
  const tmpDir = await mkdtemp(join(tmpdir(), 'spec-superflow-'));
  const url = `https://github.com/${GITHUB_REPO}.git`;
  console.log(`📥 Cloning ${tag} into ${tmpDir} ...`);
  execFileSync('git', ['clone', '--depth', '1', '--branch', tag, url, tmpDir], { stdio: 'inherit' });
  return tmpDir;
}

// ─── plan & install ───────────────────────────────────────

/** 构建安装计划（dry-run 与真实安装共用）。 */
function planInstall({ pluginRoot = defaultPluginRoot, traeDir } = {}) {
  const root = resolve(pluginRoot);
  const skillsDir = join(root, 'skills');
  const skillNames = listSkillNames(skillsDir);
  const traeRoot = detectTraeRoot(traeDir);
  const targetPluginDir = join(traeRoot, PLUGIN_NAME);
  const targetSkills = join(traeRoot, 'skills');
  const targetRules = join(traeRoot, 'user_rules');
  const version = readVersion(root);
  const pluginRootAbs = resolve(targetPluginDir);
  const variant = traeRoot.endsWith('.trae-cn') ? 'trae-cn' : 'trae';

  return {
    pluginRoot: root,
    skillsDir,
    skillNames,
    traeRoot,
    targetPluginDir,
    targetSkills,
    targetRules,
    version,
    pluginRootAbs,
    variant,
  };
}

/** 执行 Trae 安装：runtime deps → skills → phase-guard。 */
async function installTrae({ pluginRoot, traeDir, plan: providedPlan, logger = console } = {}) {
  const installPlan = providedPlan || planInstall({ pluginRoot, traeDir });
  const {
    skillNames,
    traeRoot,
    targetPluginDir,
    targetSkills,
    targetRules,
    variant,
    pluginRootAbs,
    pluginRoot: sourceRoot,
  } = installPlan;

  // 0. 清理旧 runtime 目录（仅此一个；skills 由步骤 2 单独处理）。
  if (existsSync(targetPluginDir)) {
    rmSync(targetPluginDir, { recursive: true, force: true });
  }
  ensureDir(targetPluginDir);

  // 1. 拷贝运行时依赖。
  logger.log('📋 Copying runtime dependencies...');
  for (const dir of RUNTIME_DIRS) {
    const src = join(sourceRoot, dir);
    const dst = join(targetPluginDir, dir);
    if (existsSync(src)) {
      const count = await copyDir(src, dst);
      logger.log(`   ${dir}/ → ${dst} (${count} files)`);
    } else {
      logger.log(`   ${dir}/ — skipped (not found)`);
    }
  }

  // 同时拷贝 package.json 以便版本识别。
  const pkgSrc = join(sourceRoot, 'package.json');
  if (existsSync(pkgSrc)) {
    await cp(pkgSrc, join(targetPluginDir, 'package.json'), { force: true });
  }

  // 2. 拷贝 skills（只替换源中有的名字；其他第三方 skill 保留）。
  const count = await copySkillsWithRoot(installPlan.skillsDir, targetSkills, pluginRootAbs, skillNames);
  logger.log(`   skills/ → ${targetSkills} (${count} skills, paths rewritten, unrelated skills preserved)`);

  // 3. 写 phase-guard 规则（plain md；其他 user_rules 文件保留）。
  ensureDir(targetRules);
  await writeFile(join(targetRules, 'phase-guard.md'), phaseGuardContent(variant), 'utf-8');
  logger.log(`   phase-guard → ${join(targetRules, 'phase-guard.md')}`);

  // Trae hooks.json 格式未确认，暂不写。

  return installPlan;
}

// ─── CLI entry ────────────────────────────────────────────

/** 命令主入口。 */
export async function run(args) {
  const { values } = parseArgs({
    args,
    options: {
      local: { type: 'string' },
      'trae-dir': { type: 'string' },
      tag: { type: 'string' },
      'dry-run': { type: 'boolean' },
    },
  });

  // Dry-run 打印计划后退出。
  if (values['dry-run']) {
    const plan = planInstall({ pluginRoot: values.local || defaultPluginRoot, traeDir: values['trae-dir'] });
    console.log('Trae install plan:');
    console.log(`  Plugin:      ${PLUGIN_NAME} v${plan.version}`);
    console.log(`  Variant:     ${plan.variant}`);
    console.log(`  Skills:      ${plan.skillNames.length} (${plan.skillNames.join(', ')})`);
    console.log(`  Trae root:   ${plan.traeRoot}`);
    console.log(`  Plugin root: ${plan.targetPluginDir}`);
    console.log(`  Skills dir:  ${plan.targetSkills}`);
    console.log(`  Rules:       ${plan.targetRules}/phase-guard.md`);
    console.log(`  Hooks:       (skipped — format undetermined)`);
    return;
  }

  // 解析源码来源。
  let pluginRoot = defaultPluginRoot;
  let isTemp = false;
  let installedTag = null;

  if (values.local) {
    pluginRoot = resolve(values.local);
    console.log(`📁 Using local repo: ${pluginRoot}`);
  } else {
    installedTag = values.tag || await fetchLatestTag();
    console.log(`⬆️  Installing spec-superflow ${installedTag} for Trae ...`);
    pluginRoot = await cloneRelease(installedTag);
    isTemp = true;
  }

  try {
    const plan = await installTrae({ pluginRoot, traeDir: values['trae-dir'] });

    console.log(`\n✅ Trae install complete:`);
    console.log(`   Plugin:      ${PLUGIN_NAME} v${plan.version}`);
    console.log(`   Variant:     ${plan.variant}`);
    console.log(`   Skills:      ${plan.skillNames.length}`);
    console.log(`   Trae root:   ${plan.traeRoot}`);
    console.log(`   Plugin root: ${plan.targetPluginDir}`);
    console.log(`   Skills dir:  ${plan.targetSkills}`);
    console.log(`   Rules:       ${plan.targetRules}/phase-guard.md`);
    if (installedTag) console.log(`   Version:     ${installedTag}`);
    console.log(`\nNext: restart Trae and try "/workflow-start".`);
  } finally {
    if (isTemp) rmSync(pluginRoot, { recursive: true, force: true });
  }
}

export { planInstall, installTrae, detectTraeRoot, PLUGIN_NAME };
