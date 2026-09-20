// Bundle: token-rules
// Collection of token efficiency lint rules for skill files.
// Each rule is exported individually; also exported as a default bundle.

const MAX_LINES_PER_SKILL = 250;
// 20000：v0.8.7 后 workflow-start / build-executor 两个中枢 skill 承载完整状态机
// 路由与执行契约（~19.6K 字符），10K 阈值早于功能翻倍期设定。行数红线 250 仍是
// 主约束；字符阈值只防失控膨胀，不应逼迫删除完整 CLI flag 与边界语义。
const MAX_CHARS_PER_SKILL = 20000;
// 入口文档分级：只有承载完整状态机路由与执行契约的两个中枢 skill 吃满 250/20K；
// 其余叶子 skill 收紧到 210/12K，防止叶子随迭代悄悄长到中枢尺寸（棘轮效应）。
// 叶子阈值按存量实测校准（2026-09 最大 release-archivist 195 行 / 9242 字符），留 15 行余量。
const CONTROLLER_SKILLS = new Set(['workflow-start', 'build-executor']);
const MAX_LINES_LEAF = 210;
const MAX_CHARS_LEAF = 12000;
// 按需加载资产（prompt 模板 / references 子文件）分级预算：场景模板本应比入口控制器更聚焦，
// 故行数红线比中枢 SKILL.md 更紧。阈值按存量实测上取整设定（2026-09 存量官方口径最大 211 行 / 9938 字符，
// task-reviewer-prompt.md），只约束未来增量，不触发存量整改。
// 注意：15 行代码块规则不适用于资产文件——prompt 模板的长 fenced 块就是模板本体而非示例代码，
// 该检查只在 SKILL.md 入口上执行（见 checkAll）。
const MAX_LINES_ASSET = 220;
const MAX_CHARS_ASSET = 12000;
const MAX_EMPHASIS_MARKERS = 30;
const MAX_IMPORTANT_OCCURRENCES = 3;
const MAX_CODE_BLOCK_LINES = 15;

function countEmphasisMarkers(content) {
  return (content.match(/\*\*[^*]+\*\*/g) || []).length;
}

function countImportant(content) {
  return (content.match(/\bIMPORTANT\b/g) || []).length;
}

function countExtremelyImportant(content) {
  return (content.match(/EXTREMELY_IMPORTANT/g) || []).length;
}

function countCritical(content) {
  return (content.match(/\bCRITICAL\b/g) || []).length;
}

function getCodeBlocks(content) {
  const blocks = [];
  const regex = /```[\s\S]*?```/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const lines = match[0].split('\n').length;
    blocks.push({ content: match[0], lines });
  }
  return blocks;
}

/**
 * Check file line count does not exceed max.
 * @param {string} _skillName
 * @param {string} content
 * @param {object} _ctx
 * @param {number} [max=250]
 */
export async function checkMaxLines(_skillName, content, _ctx, max = MAX_LINES_PER_SKILL) {
  const lineCount = content.split('\n').length;
  if (lineCount > max) {
    return [{ severity: 'error', message: `File has ${lineCount} lines (max: ${max})` }];
  }
  return [];
}

/**
 * Check file character count does not exceed max.
 */
export async function checkMaxChars(_skillName, content, _ctx, max = MAX_CHARS_PER_SKILL) {
  const charCount = content.length;
  if (charCount > max) {
    return [{ severity: 'warning', message: `File has ${charCount} chars (max: ${max})` }];
  }
  return [];
}

/**
 * Check emphasis markers (**bold**) count does not exceed max.
 * Also checks for banned markers (EXTREMELY_IMPORTANT, CRITICAL).
 */
export async function checkMaxEmphasisMarkers(_skillName, content, _ctx, max = MAX_EMPHASIS_MARKERS) {
  const issues = [];
  const emphasis = countEmphasisMarkers(content);
  if (emphasis > max) {
    issues.push({ severity: 'warning', message: `File has ${emphasis} emphasis markers (max: ${max})` });
  }
  const ei = countExtremelyImportant(content);
  if (ei > 0) {
    issues.push({ severity: 'error', message: `File contains EXTREMELY_IMPORTANT (${ei}x) — banned marker` });
  }
  const cr = countCritical(content);
  if (cr > 0) {
    issues.push({ severity: 'error', message: `File contains CRITICAL (${cr}x) — banned marker` });
  }
  const imp = countImportant(content);
  if (imp > MAX_IMPORTANT_OCCURRENCES) {
    issues.push({ severity: 'warning', message: `File contains IMPORTANT ${imp}x (max: ${MAX_IMPORTANT_OCCURRENCES})` });
  }
  return issues;
}

/**
 * Check code blocks do not exceed max lines.
 */
export async function checkMaxCodeBlockLength(_skillName, content, _ctx, max = MAX_CODE_BLOCK_LINES) {
  const issues = [];
  const blocks = getCodeBlocks(content);
  blocks.forEach((block, i) => {
    if (block.lines > max) {
      issues.push({
        severity: 'warning',
        message: `Code block #${i + 1} has ${block.lines} lines (max: ${max})`,
      });
    }
  });
  return issues;
}

/**
 * 按文件角色解析尺寸预算：中枢入口 / 叶子入口 / 按需资产三档。
 * @param {string} skillName - skill 目录名
 * @param {boolean} isEntry - 是否为 <skill>/SKILL.md
 * @returns {{lineLimit: number, charLimit: number, tier: string}}
 */
export function resolveBudget(skillName, isEntry) {
  if (!isEntry) return { lineLimit: MAX_LINES_ASSET, charLimit: MAX_CHARS_ASSET, tier: 'asset' };
  if (CONTROLLER_SKILLS.has(skillName)) {
    return { lineLimit: MAX_LINES_PER_SKILL, charLimit: MAX_CHARS_PER_SKILL, tier: 'controller' };
  }
  return { lineLimit: MAX_LINES_LEAF, charLimit: MAX_CHARS_LEAF, tier: 'leaf' };
}

/**
 * Bundle: run all token rules and return combined issues.
 * 尺寸预算按文件角色三级分级（controller / leaf / asset）；
 * 缺省 ctx（无 file 信息）按中枢入口阈值执行，保持历史行为不回退。
 */
async function checkAll(skillName, content, ctx) {
  // ctx 完全缺省（直接调用方无文件角色信息）时按最宽的中枢入口阈值执行，
  // 保持历史行为不回退；正常 lint 调度始终携带 ctx，按角色走三档分级。
  if (!ctx) {
    const results = await Promise.all([
      checkMaxLines(skillName, content, ctx, MAX_LINES_PER_SKILL),
      checkMaxChars(skillName, content, ctx, MAX_CHARS_PER_SKILL),
      checkMaxEmphasisMarkers(skillName, content, ctx),
      checkMaxCodeBlockLength(skillName, content, ctx),
    ]);
    return results.flat();
  }
  const isEntry = ctx.isSkillEntry !== false;
  const { lineLimit, charLimit } = resolveBudget(skillName, isEntry);
  const checks = [
    checkMaxLines(skillName, content, ctx, lineLimit),
    checkMaxChars(skillName, content, ctx, charLimit),
    checkMaxEmphasisMarkers(skillName, content, ctx),
  ];
  // 代码块长度红线只约束入口文档：资产文件的长 fenced 块是模板本体，豁免
  if (isEntry) checks.push(checkMaxCodeBlockLength(skillName, content, ctx));
  const results = await Promise.all(checks);
  return results.flat();
}

export { MAX_LINES_ASSET, MAX_CHARS_ASSET, MAX_LINES_LEAF, MAX_CHARS_LEAF, CONTROLLER_SKILLS };

export default {
  name: 'token-rules',
  // token 预算同时约束 SKILL.md 入口与按需加载的子文件资产
  appliesTo: 'all',
  check: checkAll,
};
