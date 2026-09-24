// scripts/lib/phase-guard-template.mjs
// phase-guard 正文单一事实源（D1-D3）：纯函数、无 IO/网络、零项目内 import，
// 仅依赖 Node 内置模块，杜绝循环依赖。6 个安装器的内嵌正文统一由本模块渲染。

// mdc frontmatter 的固定 description 文案（不随 platformId 变化）。
const FRONTMATTER_DESCRIPTION = 'spec-superflow 阶段守卫：防止阶段漂移和未授权实现';

// codebuddy 独有的条件应用说明（与 alwaysApply:false 对应，D1 参数化保留）。
const CONDITIONAL_PREAMBLE = '> 仅在检测到 spec-superflow 变更工件（`.spec-superflow.yaml`、`proposal.md`、`execution-contract.md`、`specs/`）时应用此规则。普通项目无需走 workflow-start，CodeBuddy 不会强制加载本规则（`alwaysApply: false`）。';

/**
 * 按 rulesFormat/alwaysApply 渲染 frontmatter 段（含结尾空行）。
 * - mdc：固定 description + alwaysApply:true；
 * - md + alwaysApply:false：仅 alwaysApply:false；
 * - md + alwaysApply:true：无 frontmatter（空串）。
 */
function renderFrontmatter(rulesFormat, alwaysApply) {
  if (rulesFormat === 'mdc') {
    return `---
description: ${FRONTMATTER_DESCRIPTION}
alwaysApply: true
---

`;
  }
  if (!alwaysApply) {
    return `---
alwaysApply: false
---

`;
  }
  return '';
}

/**
 * 渲染 phase-guard 统一正文（以共享 install.mjs long 版为骨架，D2）：
 * 标题 id、可选条件应用 blockquote、入口规则、全局禁止（Quick 统一 long）、
 * DP-0~DP-7 与通用页脚；页脚不含任何硬编码安装脚本文件名（D3）。
 */
function renderBody(platformId, conditionalPreamble) {
  const preamble = conditionalPreamble ? `\n${CONDITIONAL_PREAMBLE}\n` : '';
  return `# Phase Guard — spec-superflow (${platformId})
${preamble}
## 入口规则

- 所有工作必须从 "/workflow-start" 入口开始。
- 在 .spec-superflow.yaml 中确认当前 state 和 workflow 模式之前，不要开始写代码。

## 全局禁止

- Full 或 legacy Hotfix 没有 execution-contract.md 或未经用户明确批准，不得进入实现。
- Full 或 legacy Hotfix 必须先运行 ssf execution plan <change-dir> ...；没有 current execution plan 不得开始实现。
- 只有 Full/legacy Hotfix 的 all pass review receipts 后才可 closing；不得把未审查的 wave 当作完成。
- Quick、direct Hotfix、tweak 不要求 contract、execution plan、review receipt 或 DP-3/DP-4；它们须在边界内验证并持久化 test_result: pass。Quick 仅限 ≤3 单模块代码文件；出现 PRD、Spec/Design、API、数据/权限或跨模块风险时，展示 Quick/Full 选择，用户选择 Quick 必须在 receipt 中记录 tdd、new-test 或 bounded 验证策略。direct Hotfix 必须验证原症状回归。
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

> 本文件由 spec-superflow 生成（platform: ${platformId}）；
> 对具体变更的 guard 内容请运行 \`ssf inject <change-dir>\` 更新。
`;
}

/**
 * 渲染 phase-guard 全文（完整文件为产出单元）。
 *
 * @param {string} platformId - 标题与页脚中使用的精确平台标识
 * @param {Object} [opts]
 * @param {'md'|'mdc'} [opts.rulesFormat='md'] - 规则文件格式；mdc 生成 frontmatter
 * @param {boolean} [opts.alwaysApply=true] - md 格式下 false 时输出 alwaysApply:false
 * @param {boolean} [opts.conditionalPreamble=false] - true 时标题下加条件应用 blockquote（仅 codebuddy）
 * @returns {string} phase-guard 文件全文，同参数组合结果确定
 */
export function renderPhaseGuard(
  platformId,
  { rulesFormat = 'md', alwaysApply = true, conditionalPreamble = false } = {},
) {
  return `${renderFrontmatter(rulesFormat, alwaysApply)}${renderBody(platformId, conditionalPreamble)}`;
}
