// tests/lib/phase-guard-template.test.mjs
// W3b-W1：phase-guard 单一模板模块 renderPhaseGuard 的一致性契约。
// 差异白名单（D4）：标题/页脚中的 platformId、按 format/alwaysApply 生成的
// frontmatter、codebuddy 独有的条件应用 blockquote（conditionalPreamble）；
// 其余文本任何漂移均红灯。禁令并集夹具固化自修复前 6 份内嵌正文，只增不减。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { renderPhaseGuard } = await import('../../scripts/lib/phase-guard-template.mjs');

// 参数矩阵（spec：六平台参数矩阵唯一确定；pi 不写 guard）。
const MATRIX = [
  { platformId: 'cline', rulesFormat: 'md', alwaysApply: true, conditionalPreamble: false },
  { platformId: 'windsurf', rulesFormat: 'md', alwaysApply: true, conditionalPreamble: false },
  { platformId: 'qwen', rulesFormat: 'md', alwaysApply: true, conditionalPreamble: false },
  { platformId: 'amazon-q', rulesFormat: 'md', alwaysApply: true, conditionalPreamble: false },
  { platformId: 'roocode', rulesFormat: 'md', alwaysApply: true, conditionalPreamble: false },
  { platformId: 'continue', rulesFormat: 'md', alwaysApply: true, conditionalPreamble: false },
  { platformId: 'qoder', rulesFormat: 'md', alwaysApply: true, conditionalPreamble: false },
  { platformId: 'cursor', rulesFormat: 'mdc', alwaysApply: true, conditionalPreamble: false },
  { platformId: 'zcode', rulesFormat: 'mdc', alwaysApply: true, conditionalPreamble: false },
  { platformId: 'codebuddy', rulesFormat: 'md', alwaysApply: false, conditionalPreamble: true },
  { platformId: 'trae', rulesFormat: 'md', alwaysApply: true, conditionalPreamble: false },
  { platformId: 'trae-cn', rulesFormat: 'md', alwaysApply: true, conditionalPreamble: false },
  { platformId: 'workbuddy', rulesFormat: 'md', alwaysApply: true, conditionalPreamble: false },
];

// codebuddy 独有的条件应用 blockquote（与 alwaysApply:false 对应），逐字固化。
const CONDITIONAL_BLOCKQUOTE = '> 仅在检测到 spec-superflow 变更工件（`.spec-superflow.yaml`、`proposal.md`、`execution-contract.md`、`specs/`）时应用此规则。普通项目无需走 workflow-start，CodeBuddy 不会强制加载本规则（`alwaysApply: false`）。';

// 修复前 6 份内嵌正文的“禁令行并集”夹具：
// 来源 A=scripts/lib/install.mjs（long 基线）、B=install-cursor.mjs、
// C=install-zcode.mjs、D=cmd-install-codebuddy.mjs、E=cmd-install-trae.mjs、
// F=cmd-install-workbuddy.mjs。Quick 行取 A 的 long 版（只增不减）。
const PROHIBITION_UNION = [
  // 入口规则（2 条；A-F 全有）
  '- 所有工作必须从 "/workflow-start" 入口开始。',
  '- 在 .spec-superflow.yaml 中确认当前 state 和 workflow 模式之前，不要开始写代码。',
  // 全局禁止（6 条；contract/plan/receipt 三道 gate、Quick long、回退、执行类 skill）
  '- Full 或 legacy Hotfix 没有 execution-contract.md 或未经用户明确批准，不得进入实现。',
  '- Full 或 legacy Hotfix 必须先运行 ssf execution plan <change-dir> ...；没有 current execution plan 不得开始实现。',
  '- 只有 Full/legacy Hotfix 的 all pass review receipts 后才可 closing；不得把未审查的 wave 当作完成。',
  '- Quick、direct Hotfix、tweak 不要求 contract、execution plan、review receipt 或 DP-3/DP-4；它们须在边界内验证并持久化 test_result: pass。Quick 仅限 ≤3 单模块代码文件；出现 PRD、Spec/Design、API、数据/权限或跨模块风险时，展示 Quick/Full 选择，用户选择 Quick 必须在 receipt 中记录 tdd、new-test 或 bounded 验证策略。direct Hotfix 必须验证原症状回归。',
  '- 执行过程中如果发现需求/范围变化，必须回退到 specifying 或 bridging，而不是直接改代码。',
  '- 不要直接调用执行类 skill（如 "/build-executor"），必须通过入口路由。',
  // 决策点协议（DP-0~DP-7；A-F 全有）
  '- DP-0：设计前确认',
  '- DP-1：需求确认',
  '- DP-2：工件审查',
  '- DP-3/DP-4：仅 Full 或 legacy Hotfix 需要 contract 批准与执行模式确认。',
  '- DP-5：调试升级',
  '- DP-6：验证失败',
  '- DP-7：是否收口归档？',
];

/**
 * 规范化渲染输出：frontmatter 整段替换为占位，标题与页脚中的 platformId
 * 替换为占位；其余文本保持原样，用于逐字一致性断言。
 */
function normalize(text, platformId) {
  // frontmatter 三形态统一替换为同一占位行（无 frontmatter 时前置占位）。
  const frontmatter = /^---\n[\s\S]*?\n---\n\n/;
  const withPlaceholder = frontmatter.test(text)
    ? text.replace(frontmatter, '<<FRONTMATTER>>\n')
    : `<<FRONTMATTER>>\n${text}`;
  return withPlaceholder
    .replace(`# Phase Guard — spec-superflow (${platformId})`, '# Phase Guard — spec-superflow (<ID>)')
    .replace(`（platform: ${platformId}）`, '（platform: <ID>）');
}

describe('W3b-W1 参数矩阵：规范化后正文逐字一致', () => {
  it('13 个 platformId 除标题 id/frontmatter/条件段外 deep 相等', () => {
    // conditionalPreamble=false 的 12 个 id：规范化后只剩一个唯一文本。
    const withoutPreamble = MATRIX.filter(row => !row.conditionalPreamble);
    const normalized = withoutPreamble.map(row =>
      normalize(renderPhaseGuard(row.platformId, row), row.platformId));
    assert.equal(new Set(normalized).size, 1, '非条件平台正文存在漂移');

    // codebuddy：移除条件 blockquote 后必须与基线逐字一致（条件段是唯一差异）。
    const codebuddy = MATRIX.find(row => row.platformId === 'codebuddy');
    const codebuddyText = renderPhaseGuard(codebuddy.platformId, codebuddy);
    const stripped = codebuddyText.replace(`${CONDITIONAL_BLOCKQUOTE}\n\n`, '');
    assert.equal(normalize(stripped, codebuddy.platformId), normalized[0]);
  });
});

describe('W3b-W1 禁令并集：只增不减', () => {
  it('并集夹具固化 15 条（2 入口 + 6 全局禁止 + DP-0~DP-7）', () => {
    assert.equal(PROHIBITION_UNION.length, 15);
    for (const line of PROHIBITION_UNION) {
      assert.match(line, /^- /);
    }
    // 去重检查：并集本身不得有重复条目。
    assert.equal(new Set(PROHIBITION_UNION).size, PROHIBITION_UNION.length);
  });

  for (const row of MATRIX) {
    it(`platform=${row.platformId} 逐条命中禁令并集`, () => {
      const text = renderPhaseGuard(row.platformId, row);
      for (const line of PROHIBITION_UNION) {
        assert.ok(text.includes(line), `缺少禁令行：${line}`);
      }
    });
  }
});

describe('W3b-W1 Quick 条款统一为 long 版', () => {
  for (const row of MATRIX) {
    it(`platform=${row.platformId} 含 ≤3 文件边界与验证策略记录要求`, () => {
      const text = renderPhaseGuard(row.platformId, row);
      assert.ok(text.includes('Quick 仅限 ≤3 单模块代码文件'));
      assert.ok(text.includes('出现 PRD、Spec/Design、API、数据/权限或跨模块风险时，展示 Quick/Full 选择'));
      assert.ok(text.includes('用户选择 Quick 必须在 receipt 中记录 tdd、new-test 或 bounded 验证策略'));
      assert.ok(text.includes('direct Hotfix 必须验证原症状回归。'));
    });
  }
});

describe('W3b-W1 条件应用 blockquote 仅 codebuddy', () => {
  it('codebuddy 含逐字条件段，其余 12 个 id 均不含', () => {
    for (const row of MATRIX) {
      const text = renderPhaseGuard(row.platformId, row);
      if (row.platformId === 'codebuddy') {
        assert.ok(text.includes(CONDITIONAL_BLOCKQUOTE));
      } else {
        assert.ok(!text.includes(CONDITIONAL_BLOCKQUOTE));
        assert.ok(!text.includes('仅在检测到 spec-superflow 变更工件'));
      }
    }
  });

  it('codebuddy 显式 conditionalPreamble=false 时不输出条件段', () => {
    const text = renderPhaseGuard('codebuddy', {
      rulesFormat: 'md', alwaysApply: false, conditionalPreamble: false,
    });
    assert.ok(!text.includes(CONDITIONAL_BLOCKQUOTE));
  });
});

describe('W3b-W1 frontmatter 三形态', () => {
  it('mdc（cursor/zcode）：固定 description + alwaysApply:true', () => {
    for (const id of ['cursor', 'zcode']) {
      const text = renderPhaseGuard(id, { rulesFormat: 'mdc', alwaysApply: true });
      assert.ok(text.startsWith('---\n'));
      assert.ok(text.includes('description: spec-superflow 阶段守卫：防止阶段漂移和未授权实现'));
      assert.ok(text.includes('alwaysApply: true'));
      // description 行必须位于 alwaysApply 行之前。
      assert.ok(text.indexOf('description:') < text.indexOf('alwaysApply:'));
    }
  });

  it('md + alwaysApply:false（codebuddy）：仅 alwaysApply:false，无 description', () => {
    const text = renderPhaseGuard('codebuddy', {
      rulesFormat: 'md', alwaysApply: false, conditionalPreamble: true,
    });
    assert.ok(text.startsWith('---\nalwaysApply: false\n---\n\n'));
    assert.ok(!text.includes('description'));
  });

  it('md + alwaysApply:true：无 frontmatter，首行即标题', () => {
    for (const id of ['cline', 'trae', 'workbuddy']) {
      const text = renderPhaseGuard(id, { rulesFormat: 'md', alwaysApply: true });
      assert.ok(text.startsWith('# Phase Guard'));
      assert.ok(!text.startsWith('---'));
    }
  });
});

describe('W3b-W1 页脚统一且无硬编码脚本名', () => {
  it('每份含通用生成说明（platform:<id>）与 ssf inject 提示，无 .mjs 文件名', () => {
    for (const row of MATRIX) {
      const text = renderPhaseGuard(row.platformId, row);
      assert.ok(text.includes(`本文件由 spec-superflow 生成（platform: ${row.platformId}）`));
      assert.ok(text.includes('`ssf inject <change-dir>`'));
      assert.ok(!/install-[a-z-]+\.mjs/.test(text), `出现硬编码安装器名：${row.platformId}`);
      assert.ok(!/cmd-install-[a-z-]+\.mjs/.test(text), `出现硬编码安装器名：${row.platformId}`);
    }
  });

  it('每份标题含精确 platformId', () => {
    for (const row of MATRIX) {
      const text = renderPhaseGuard(row.platformId, row);
      assert.ok(text.includes(`# Phase Guard — spec-superflow (${row.platformId})`));
    }
  });
});

describe('W3b-W1 渲染确定性', () => {
  it('同参数渲染两次 deep 相等（全部矩阵行）', () => {
    for (const row of MATRIX) {
      const a = renderPhaseGuard(row.platformId, row);
      const b = renderPhaseGuard(row.platformId, { ...row });
      assert.equal(a, b);
    }
  });

  it('默认参数等价 md/true/无前置说明', () => {
    assert.equal(
      renderPhaseGuard('cline'),
      renderPhaseGuard('cline', {
        rulesFormat: 'md', alwaysApply: true, conditionalPreamble: false,
      }),
    );
  });
});
