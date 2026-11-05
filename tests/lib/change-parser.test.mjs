// tests/lib/change-parser.test.mjs
// change-parser 围栏感知：围栏内章节标题与 delta 标题不得污染真实章节

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseChangeMarkdown } from '../../dist/index.js';

describe('parseChangeMarkdown 围栏感知', () => {
  it('围栏内 ## Why / ## ADDED 不污染围栏外真实章节', () => {
    const content = [
      '# Change: fence-demo',
      '',
      '## Why',
      '',
      '真实的 Why 内容，用于对照。',
      '',
      '## What Changes',
      '',
      '真实的变更说明。',
      '',
      '## 示例',
      '',
      '```md',
      '## Why',
      '',
      '围栏内的假 Why，不应出现。',
      '',
      '## What Changes',
      '',
      '围栏内的假变更说明。',
      '',
      '## ADDED Requirements',
      '',
      '### Requirement: 幻影需求',
      '```',
      '',
    ].join('\n');

    const change = parseChangeMarkdown(content, 'fence-demo');

    assert.equal(change.why, '真实的 Why 内容，用于对照。');
    assert.equal(change.whatChanges, '真实的变更说明。');
    assert.ok(!change.why.includes('围栏'), 'why 不得包含围栏文本');
    assert.ok(!change.whatChanges.includes('围栏'), 'whatChanges 不得包含围栏文本');
    // 围栏内 ## ADDED Requirements 不产生幻影 delta
    assert.deepEqual(change.deltas, []);
  });

  it('真实 ADDED 节正文含围栏时仅产出 1 条 ADDED 且 description 排除围栏', () => {
    const content = [
      '# Change: fence-inside-delta',
      '',
      '## Why',
      '',
      '原因正文。',
      '',
      '## ADDED Requirements',
      '',
      '本节说明文字，应进入 description。',
      '',
      '```md',
      '## REMOVED Requirements',
      '',
      '### Requirement: 幻影删除',
      '```',
      '',
      '### Requirement: 真实新增需求',
      '',
      '需求正文。',
      '',
    ].join('\n');

    const change = parseChangeMarkdown(content, 'fence-inside-delta');

    assert.equal(change.deltas.length, 1);
    assert.equal(change.deltas[0].operation, 'ADDED');
    assert.equal(change.deltas[0].spec, '');
    assert.equal(change.deltas[0].description, '本节说明文字，应进入 description。');
    assert.ok(!change.deltas[0].description.includes('REMOVED'), 'description 不得含围栏标题');
    assert.ok(!change.deltas[0].description.includes('幻影'), 'description 不得含围栏文本');
    assert.ok(!change.deltas[0].description.includes('```'), 'description 不得含围栏标记');
  });

  it('无围栏外 delta 节时 deltas 为空数组', () => {
    const content = [
      '# Proposal without deltas',
      '',
      '## Why',
      '',
      '仅在围栏示例中出现 delta 标题。',
      '',
      '```md',
      '## ADDED Requirements',
      '### Requirement: 示例新增',
      '## MODIFIED Requirements',
      '## REMOVED Requirements',
      '## RENAMED Requirements',
      '```',
      '',
    ].join('\n');

    const change = parseChangeMarkdown(content, 'no-delta');

    assert.deepEqual(change.deltas, []);
  });

  it('无围栏真实节的 operation/description 解析与修复前一致', () => {
    const content = [
      '# Change: plain',
      '',
      '## MODIFIED Requirements',
      '',
      '第一行说明。',
      '第二行说明。',
      '',
      '### Requirement: 被修改的需求',
      '',
      '需求正文。',
      '',
    ].join('\n');

    const change = parseChangeMarkdown(content, 'plain');

    assert.equal(change.deltas.length, 1);
    assert.equal(change.deltas[0].operation, 'MODIFIED');
    assert.equal(change.deltas[0].description, '第一行说明。\n第二行说明。');
  });
});
