// Bundle: asset-references
// 引用完整性 lint 规则：校验 skill 文档对按需加载资产（子模板 / docs / templates）的引用。
//
// 背景：SKILL.md 中的硬门禁随注入必然可见，而下沉到子文件的资产依赖 agent 主动读取。
// 一旦引用路径写错（悬空引用）或资产失去任何 skill 文档入口（孤儿资产），
// 规则会静默失效且无任何报错。本规则用纯静态扫描堵住这两个缺口。
//
// 可识别的引用形态：
//   1. 仓库相对全路径：`skills/<dir>/<file>.md`（含 ssf runtime asset read 命令形式）
//   2. 加载指令指向的 docs/templates 资产：`ssf runtime asset read docs/xx.md`
//   3. 同目录裸文件名（反引号包裹）：`` `re-review-prompt.md` ``
//      仅当同目录确实存在同名文件时才视为引用；不存在则按 change 工件名（如 proposal.md）忽略，零误报。
// 含占位符（<...>、[...]、*）的运行时路径一律不判。

import { existsSync } from 'node:fs';
import { join } from 'node:path';

// 匹配 skills/<segments>.md 形式的仓库相对全路径（允许出现在反引号或加载命令中）
const SKILL_REF_RE = /(?:ssf runtime asset read\s+)?(skills\/[a-z0-9][\w.-]*(?:\/[a-z0-9][\w.-]*)*\.md)/gi;
// 匹配加载指令明确指向的 docs/templates 资产（裸写的 docs/ 路径不判，避免正文泛指造成误报）
const REPO_REF_RE = /ssf runtime asset read\s+((?:docs|templates)\/[a-z0-9][\w.-]*(?:\/[a-z0-9][\w.-]*)*\.md)/gi;
// 匹配反引号包裹的裸文件名（同目录兄弟资产，如 `re-review-prompt.md`）
const BARE_REF_RE = /`([a-z0-9][a-z0-9-]*\.md)`/gi;
// 含这些字符的路径是运行时占位符，不参与存在性校验
const PLACEHOLDER_RE = /[<>\[\]*]/;

/**
 * 从 markdown 内容中提取全部资产引用（纯文本解析，不做存在性判断）。
 * @param {string} content - 当前文档全文
 * @param {string} currentFile - 当前文档相对 skills 目录的 posix 路径（如 build-executor/SKILL.md）
 * @returns {{kind:'skill'|'repo'|'bare', path?:string, file?:string, dir?:string}[]}
 */
export function extractAssetRefs(content, currentFile) {
  const refs = [];
  const seen = new Set();
  const dir = currentFile.includes('/') ? currentFile.split('/').slice(0, -1).join('/') : '';

  /**
   * 去重并过滤占位符路径后登记一条引用
   * @param {object} ref - 引用描述对象
   */
  const push = ref => {
    const key = JSON.stringify(ref);
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };

  for (const m of content.matchAll(SKILL_REF_RE)) {
    const path = m[1];
    if (!PLACEHOLDER_RE.test(path)) {
      push({ kind: 'skill', path: path.replace(/^skills\//, '') });
    }
  }
  for (const m of content.matchAll(REPO_REF_RE)) {
    const path = m[1];
    if (!PLACEHOLDER_RE.test(path)) {
      push({ kind: 'repo', path });
    }
  }
  for (const m of content.matchAll(BARE_REF_RE)) {
    const file = m[1];
    if (!PLACEHOLDER_RE.test(file)) {
      push({ kind: 'bare', file, dir });
    }
  }
  return refs;
}

/**
 * 基于全量资产清单构建全局引用图：汇总每个资产被哪些有效引用指向。
 * 供 lint-skills 在扫描前一次性计算，孤儿判定以此为准。
 * @param {Map<string, string>} assetContents - key: 相对 skills 目录的 posix 路径；value: 文件内容
 * @returns {Set<string>} 被任意 skill 文档有效引用的资产 relpath 集合
 */
export function buildReferenceGraph(assetContents) {
  const assets = new Set(assetContents.keys());
  const referenced = new Set();
  for (const [file, content] of assetContents) {
    for (const ref of extractAssetRefs(content, file)) {
      const target = ref.kind === 'skill'
        ? ref.path
        : ref.kind === 'bare'
          ? (ref.dir ? `${ref.dir}/${ref.file}` : ref.file)
          : null;
      // 仅登记真实存在的 skills 资产；bare 名称解析失败时视为 change 工件名并忽略
      if (target && assets.has(target)) referenced.add(target);
    }
  }
  return referenced;
}

/**
 * 解析 SKILL.md 顶部 YAML frontmatter 的最小子集（顶层标量 + 数组）。
 * 零依赖手写实现：只需识别 name/description/assets，# 注释行忽略，
 * 不追求完整 YAML 兼容（description 中允许出现冒号）。
 * @param {string} content - 文档全文
 * @returns {Record<string, string|string[]>|null} 无 frontmatter 时返回 null
 */
export function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const result = {};
  let currentKey = null;
  for (const rawLine of m[1].split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (/^\s*#/.test(line) || line.trim() === '') continue;
    const kv = line.match(/^([a-zA-Z_][\w.-]*):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1];
      const val = kv[2].trim();
      result[currentKey] = val === '' ? [] : val;
      continue;
    }
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && currentKey && Array.isArray(result[currentKey])) {
      result[currentKey].push(item[1].trim().replace(/^["']|["']$/g, ''));
    }
  }
  return result;
}

/**
 * 校验 frontmatter assets 声明与磁盘资产、正文引用三者一致（机器化加载契约）：
 * - 声明路径在磁盘不存在            → declared-missing (error)
 * - 目录内资产未登记                → undeclared-asset (warning)
 * - 正文引用本 skill 资产但未登记   → reference-without-declaration (warning)
 * 声明却无正文入边（orphan）由 checkOrphanAssets 独立覆盖，形成四象限闭环。
 * 仅在 SKILL.md 入口轮执行；无资产的 skill 可省略 assets 字段，零负担。
 * @param {string} skillName - skill 目录名
 * @param {string} content - SKILL.md 全文
 * @param {object} ctx - lint 上下文
 * @returns {Promise<Array>}
 */
export async function checkAssetDeclarations(skillName, content, ctx) {
  if (ctx.isSkillEntry === false) return [];
  if (!(ctx.assets instanceof Set)) return [];

  const issues = [];
  const fm = parseFrontmatter(content);
  const declared = fm && Array.isArray(fm.assets) ? fm.assets : [];
  const prefix = `${skillName}/`;

  // 磁盘上属于本 skill 的非入口资产
  const diskAssets = [...ctx.assets].filter(rel => rel.startsWith(prefix) && rel !== `${skillName}/SKILL.md`);
  // 无资产且无声明：合法（7 个无资产 skill 走此路径）
  if (diskAssets.length === 0 && declared.length === 0) return [];

  const declaredRels = declared.map(d => `${prefix}${d.replace(/^\.?\//, '')}`);

  // 象限一：声明必存在
  for (const rel of declaredRels) {
    if (!ctx.assets.has(rel)) {
      issues.push({ severity: 'error', message: `Declared asset not found: skills/${rel} (frontmatter assets entry has no matching file)` });
    }
  }

  // 象限二：存在必声明
  const declaredSet = new Set(declaredRels);
  for (const rel of diskAssets) {
    if (!declaredSet.has(rel)) {
      issues.push({ severity: 'warning', message: `Undeclared asset: skills/${rel} (exists on disk but missing from frontmatter assets)` });
    }
  }

  // 象限三：引用必声明（仅校验指向本 skill 资产的引用，跨 skill 引用由被引方声明负责）
  for (const ref of extractAssetRefs(content, `${skillName}/SKILL.md`)) {
    if (ref.kind !== 'skill' || !ref.path.startsWith(prefix)) continue;
    if (!declaredSet.has(ref.path)) {
      issues.push({ severity: 'warning', message: `Reference without declaration: skills/${ref.path} (referenced in body but missing from frontmatter assets)` });
    }
  }
  return issues;
}

/**
 * 判断单个 docs/templates 引用目标是否存在。
 * 优先使用 ctx.repoAssets 纯集合（测试友好）；否则回退文件系统判断。
 * @param {string} relPath - 相对仓库根的 posix 路径
 * @param {object} ctx - lint 上下文
 * @returns {boolean} 无法判断时返回 true（不阻断）
 */
function repoAssetExists(relPath, ctx) {
  if (ctx.repoAssets instanceof Set) return ctx.repoAssets.has(relPath);
  if (ctx.repoRoot) return existsSync(join(ctx.repoRoot, ...relPath.split('/')));
  return true;
}

/**
 * 校验当前文档中的引用是否悬空：
 * - skills 全路径引用的目标必须存在于资产清单（error）
 * - 加载指令指向的 docs/templates 文件必须存在（error）
 * - 裸文件名仅在同目录存在同名资产时视为有效引用，否则按工件名忽略
 * @param {string} _skillName - skill 目录名
 * @param {string} content - 当前文档全文
 * @param {object} ctx - lint 上下文，需含 assets（Set<relpath>）
 * @returns {Promise<Array>} lint issues
 */
export async function checkDanglingReferences(_skillName, content, ctx) {
  const issues = [];
  const assets = ctx.assets instanceof Set ? ctx.assets : null;
  for (const ref of extractAssetRefs(content, ctx.file || `${_skillName}/SKILL.md`)) {
    if (ref.kind === 'skill') {
      if (assets && !assets.has(ref.path)) {
        issues.push({ severity: 'error', message: `Dangling asset reference: skills/${ref.path} (target file does not exist)` });
      }
    } else if (ref.kind === 'repo') {
      if (!repoAssetExists(ref.path, ctx)) {
        issues.push({ severity: 'error', message: `Dangling asset reference: ${ref.path} (loaded via ssf runtime asset read but file does not exist)` });
      }
    }
    // bare 引用：同目录无同名资产时按 change 工件名忽略，零误报
  }
  return issues;
}

/**
 * 校验孤儿资产：当前 skill 目录下非 SKILL.md 的 markdown 文件若没有任何
 * skill 文档（含子文件之间）的有效入边，报 warning。
 * 仅在扫描 SKILL.md 入口时执行一次，避免同一目录多文件重复报告。
 * @param {string} skillName - skill 目录名
 * @param {string} _content - 当前文档全文（未使用，签名对齐规则接口）
 * @param {object} ctx - lint 上下文，需含 assets 与 referenced 两个集合
 * @returns {Promise<Array>} lint issues
 */
export async function checkOrphanAssets(skillName, _content, ctx) {
  // 子文件扫描时跳过：孤儿是目录级判定，只在入口文档轮次报告
  if (ctx.file && ctx.isSkillEntry === false) return [];
  if (!(ctx.assets instanceof Set) || !(ctx.referenced instanceof Set)) return [];

  const prefix = `${skillName}/`;
  const issues = [];
  for (const rel of ctx.assets) {
    if (!rel.startsWith(prefix)) continue;
    if (rel === `${skillName}/SKILL.md`) continue;
    if (!ctx.referenced.has(rel)) {
      issues.push({ severity: 'warning', message: `Orphan asset: skills/${rel} (no skill markdown references it; dead on-demand load target)` });
    }
  }
  return issues;
}

/**
 * Bundle: 运行悬空引用、frontmatter 声明一致性与孤儿资产检查并合并结果。
 */
async function checkAll(skillName, content, ctx) {
  const results = await Promise.all([
    checkDanglingReferences(skillName, content, ctx),
    checkAssetDeclarations(skillName, content, ctx),
    checkOrphanAssets(skillName, content, ctx),
  ]);
  return results.flat();
}

export default {
  name: 'asset-references',
  // 引用完整性同时约束 SKILL.md 入口与子文件（子文件之间也存在交叉引用）
  appliesTo: 'all',
  check: checkAll,
};
