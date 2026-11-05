// tests/lib/scenario-matrix.test.mjs — W2：covers 解析 + 覆盖矩阵维度（S-TRACE-004~007）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractTaskCovers, Validator } from '../../dist/index.js';

/** 最小 spec：两条带 ID 场景 + 一条无 ID 场景 */
const SPEC_WITH_IDS = [
  '## ADDED Requirements',
  '',
  '### Requirement: 认证',
  '',
  '系统 SHALL 支持认证。',
  '',
  '#### Scenario: S-AUTH-001: 令牌过期刷新',
  '- **WHEN** 令牌过期',
  '- **THEN** 刷新令牌',
  '',
  '#### Scenario: S-AUTH-002: 登出失效',
  '- **WHEN** 用户登出',
  '- **THEN** 会话失效',
  '',
  '#### Scenario: 无 ID 场景',
  '- **WHEN** x',
  '- **THEN** y',
  '',
].join('\n');

const SPEC_WITHOUT_IDS = SPEC_WITH_IDS.replace(/S-AUTH-00[12]: /g, '');

describe('extractTaskCovers', () => {
  it('S-TRACE-004: parses covers list from task lines', () => {
    const tasks = [
      '# 实现任务',
      '',
      '- [ ] **1.1 实现提取**：修改解析器；证明：单测。covers: S-AUTH-001, S-AUTH-002',
      '- [x] **1.2 唯一性**：校验重复。covers: S-AUTH-001',
    ].join('\n');
    const entries = extractTaskCovers(tasks);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].taskId, '1.1');
    assert.deepEqual(entries[0].covers, ['S-AUTH-001', 'S-AUTH-002']);
    assert.equal(entries[1].taskId, '1.2');
    assert.deepEqual(entries[1].covers, ['S-AUTH-001']);
  });

  it('returns empty for tasks without covers declarations', () => {
    const tasks = '- [ ] **1.1 任务**：无声明。';
    assert.deepEqual(extractTaskCovers(tasks), []);
  });
});

describe('Validator.validateScenarioCoverage', () => {
  const validator = new Validator();

  it('S-TRACE-005: closed matrix passes and lists coverage', () => {
    const tasks = '- [ ] **1.1 实现**：全部覆盖。covers: S-AUTH-001, S-AUTH-002';
    const report = validator.validateScenarioCoverage(SPEC_WITH_IDS, tasks);
    assert.equal(report.applicable, true);
    assert.equal(report.totalScenarios, 2);
    assert.deepEqual(report.covered.sort(), ['S-AUTH-001', 'S-AUTH-002']);
    assert.deepEqual(report.missing, []);
    assert.equal(report.valid, true);
  });

  it('S-TRACE-006: gap reported as missing and invalid', () => {
    const tasks = '- [ ] **1.1 实现**：只覆盖一个。covers: S-AUTH-001';
    const report = validator.validateScenarioCoverage(SPEC_WITH_IDS, tasks);
    assert.deepEqual(report.missing, ['S-AUTH-002']);
    assert.equal(report.valid, false);
  });

  it('S-TRACE-007: not applicable when no scenario carries an id', () => {
    const tasks = '- [ ] **1.1 实现**：无声明。';
    const report = validator.validateScenarioCoverage(SPEC_WITHOUT_IDS, tasks);
    assert.equal(report.applicable, false);
    assert.equal(report.totalScenarios, 0);
    assert.equal(report.valid, true);
  });

  it('flags covers ids that do not exist in the spec', () => {
    const tasks = '- [ ] **1.1 实现**：声明了不存在的 ID。covers: S-AUTH-001, S-AUTH-999';
    const report = validator.validateScenarioCoverage(SPEC_WITH_IDS, tasks);
    assert.deepEqual(report.declaredButUnknown, ['S-AUTH-999']);
    assert.equal(report.valid, false);
  });

  it('surfaces id issues (malformed/duplicate) as errors', () => {
    const spec = SPEC_WITH_IDS + '\n#### Scenario: S-AUTH-001: 重复 ID\n';
    const tasks = '- [ ] **1.1**：covers: S-AUTH-001, S-AUTH-002';
    const report = validator.validateScenarioCoverage(spec, tasks);
    assert.ok(report.idIssues.some(i => i.kind === 'duplicate-id'));
    assert.equal(report.valid, false);
  });
});
