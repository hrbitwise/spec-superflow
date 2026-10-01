// tests/lib/rejected-alternatives.test.mjs
// proposal 模板 Rejected Alternatives 节的机器校验。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Validator } from '../../dist/index.js';

function validateProposal(content) {
  return new Validator().validateChangeContent('validate-rejected-alternatives', content);
}

const BASE_PROPOSAL = `# 变更提案

## 背景（Why）

解决一个问题。

## 变更内容（What Changes）

- 做一件事。

## 范围（Scope）

### 范围内（In Scope）

- 一项。

### 范围外（Out of Scope）

- 不两项。

## 影响与验证

- **影响区域**：代码。
- **完成证明**：通过。
`;

const FULL_PROPOSAL_WITH_VALID_ALTS = BASE_PROPOSAL.replace(
  '## 影响与验证',
  `## 已排除的替代方案（Rejected Alternatives）

- **方案 A**：用独立 decisions.md 文件记录——排除理由：需扩展 artifacts_hash 清单，收益不抵成本
- **方案 B**：嵌入 design.md 的决策日志——排除理由：design 是执行阶段工件，clarification 决策应在 proposal 层即可见
- **方案 C**：无结构化记录——排除理由：DP-1 确认后澄清结论即丢弃，决策不可追溯

## 影响与验证`,
);

describe('Rejected Alternatives 节校验', () => {
  it('缺失该节时零 issue（向后兼容，可选节）', () => {
    const result = validateProposal(BASE_PROPOSAL);
    const altIssues = result.issues.filter(i => i.message.includes('[rejected-alt]'));
    assert.equal(altIssues.length, 0, `missing section must produce no rejected-alt issues, got: ${altIssues.map(i => i.message)}`);
  });

  it('合法条目（每项有描述 + 排除理由，≤5 条）零 issue', () => {
    const result = validateProposal(FULL_PROPOSAL_WITH_VALID_ALTS);
    const issues = result.issues.filter(i => i.message.includes('[rejected-alt]'));
    assert.equal(issues.length, 0, `legal alternatives must produce no issues, got: ${issues.map(i => i.message)}`);
  });

  it('条目缺失排除理由时报 ERROR', () => {
    const bad = BASE_PROPOSAL.replace(
      '## 影响与验证',
      `## 已排除的替代方案（Rejected Alternatives）

- **方案 A**：只有描述没有理由
- **方案 B**：完整描述——排除理由：完整理由

## 影响与验证`,
    );
    const result = validateProposal(bad);
    const issues = result.issues.filter(i => i.message.includes('[rejected-alt]'));
    assert.ok(
      issues.some(i => i.level === 'ERROR' && /排除理由/i.test(i.message)),
      `must report ERROR for missing exclusion reason, got: ${issues.map(i => `${i.level}: ${i.message}`)}`,
    );
  });

  it('条目缺失描述时报 ERROR', () => {
    const bad = BASE_PROPOSAL.replace(
      '## 影响与验证',
      `## 已排除的替代方案（Rejected Alternatives）

- **方案 A**：——排除理由：只有理由没有描述

## 影响与验证`,
    );
    const result = validateProposal(bad);
    const issues = result.issues.filter(i => i.message.includes('[rejected-alt]'));
    assert.ok(
      issues.some(i => i.level === 'ERROR' && /描述/i.test(i.message)),
      `must report ERROR for missing description, got: ${issues.map(i => `${i.level}: ${i.message}`)}`,
    );
  });

  it('条目数超过 5 时报 WARNING（需求漂移信号）', () => {
    const many = BASE_PROPOSAL.replace(
      '## 影响与验证',
      `## 已排除的替代方案（Rejected Alternatives）

${Array.from({ length: 7 }, (_, i) => `- **方案 ${i + 1}**：描述 ${i + 1}——排除理由：理由 ${i + 1}`).join('\n')}

## 影响与验证`,
    );
    const result = validateProposal(many);
    const issues = result.issues.filter(i => i.message.includes('[rejected-alt]'));
    assert.ok(
      issues.some(i => i.level === 'WARNING' && /条目数|上限|5|漂移/i.test(i.message)),
      `must report WARNING for > 5 entries, got: ${issues.map(i => `${i.level}: ${i.message}`)}`,
    );
  });

  it('条目数恰好 5 条不报 WARNING（边界）', () => {
    const five = BASE_PROPOSAL.replace(
      '## 影响与验证',
      `## 已排除的替代方案（Rejected Alternatives）

${Array.from({ length: 5 }, (_, i) => `- **方案 ${i + 1}**：描述 ${i + 1}——排除理由：理由 ${i + 1}`).join('\n')}

## 影响与验证`,
    );
    const result = validateProposal(five);
    const warnings = result.issues.filter(i => i.level === 'WARNING' && i.message.includes('[rejected-alt]'));
    assert.equal(warnings.length, 0, `exactly 5 entries must not warn, got: ${warnings.map(i => i.message)}`);
  });
});
