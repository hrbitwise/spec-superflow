// tests/scenario-ids.test.mjs — W1：Scenario ID 提取与唯一性校验（S-TRACE-001~003）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractScenarios,
  validateScenarioIds,
} from '../../dist/index.js';

/** 构造含场景头的最小 spec 片段 */
function specWith(...scenarioHeaders) {
  return [
    '## ADDED Requirements',
    '',
    '### Requirement: R',
    '',
    '系统 SHALL 支持场景。',
    '',
    ...scenarioHeaders.flatMap(h => [h, '', '- **WHEN** x', '- **THEN** y', '']),
  ].join('\n');
}

describe('scenario id extraction', () => {
  it('S-TRACE-001: extracts S-<CAP>-NNN id and separates title', () => {
    const blocks = extractScenarios(
      specWith('#### Scenario: S-AUTH-001: 令牌过期刷新')
    );
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].id, 'S-AUTH-001');
    assert.equal(blocks[0].title, '令牌过期刷新');
    assert.equal(blocks[0].lineNumber, 7);
  });

  it('S-TRACE-002: scenarios without id stay legal and carry full title', () => {
    const blocks = extractScenarios(specWith('#### Scenario: 正常路径'));
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].id, undefined);
    assert.equal(blocks[0].title, '正常路径');
  });

  it('keeps Chinese title with colon intact when not id-shaped', () => {
    const blocks = extractScenarios(specWith('#### Scenario: 场景：正常路径'));
    assert.equal(blocks[0].id, undefined);
    assert.equal(blocks[0].title, '场景：正常路径');
  });

  it('ignores scenario headers inside fenced code blocks', () => {
    const content = [
      '## ADDED Requirements',
      '',
      '### Requirement: R',
      '',
      '说明：',
      '',
      '```markdown',
      '#### Scenario: S-FAKE-001: 围栏内示例',
      '```',
      '',
      '#### Scenario: S-REAL-001: 围栏外',
      '',
    ].join('\n');
    const blocks = extractScenarios(content);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].id, 'S-REAL-001');
  });

  it('flags id-shaped but malformed prefixes as suspected ids', () => {
    // 小写 s- / 四位数 / 缺冒号 → 不识别为合法 ID，但保留疑似标记供校验层报错
    const lower = extractScenarios(specWith('#### Scenario: s-auth-001: 小写'));
    assert.equal(lower[0].id, 's-auth-001');
    const fourDigits = extractScenarios(specWith('#### Scenario: S-AUTH-0001: 四位'));
    assert.equal(fourDigits[0].id, 'S-AUTH-0001');
    const noColon = extractScenarios(specWith('#### Scenario: S-AUTH-001 无冒号'));
    assert.equal(noColon[0].id, undefined);
  });
});

describe('scenario id uniqueness', () => {
  it('S-TRACE-003: reports duplicate id with both locations', () => {
    const blocks = extractScenarios(
      specWith(
        '#### Scenario: S-AUTH-001: 第一次出现',
        '#### Scenario: S-AUTH-001: 第二次出现'
      )
    );
    const issues = validateScenarioIds(blocks);
    const dup = issues.find(i => i.kind === 'duplicate-id');
    assert.ok(dup, 'should report duplicate-id issue');
    assert.equal(dup.id, 'S-AUTH-001');
    assert.equal(dup.locations.length, 2);
    assert.deepEqual(
      dup.locations.map(l => l.lineNumber).sort(),
      blocks.filter(b => b.id === 'S-AUTH-001').map(b => b.lineNumber).sort()
    );
  });

  it('reports malformed ids as malformed-id issues', () => {
    const blocks = extractScenarios(specWith('#### Scenario: s-auth-001: 小写'));
    const issues = validateScenarioIds(blocks);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].kind, 'malformed-id');
    assert.equal(issues[0].id, 's-auth-001');
  });

  it('returns no issues for unique valid ids and id-less scenarios', () => {
    const blocks = extractScenarios(
      specWith(
        '#### Scenario: S-AUTH-001: 甲',
        '#### Scenario: S-AUTH-002: 乙',
        '#### Scenario: 无 ID 场景'
      )
    );
    assert.deepEqual(validateScenarioIds(blocks), []);
  });
});
