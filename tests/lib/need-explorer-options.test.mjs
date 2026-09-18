// tests/lib/need-explorer-options.test.mjs
// need-explorer 选项呈现契约测试：防止后续压缩/改写时丢失
// “同维度可比、默认推荐、错误代价、前置依赖、看不懂时降层”五项呈现规则。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 读取仓库根目录下的文本文件 */
function read(relPath) {
  return readFileSync(join(repoRoot, relPath), 'utf-8');
}

describe('need-explorer: 选项呈现契约', () => {
  const skill = read('skills/need-explorer/SKILL.md');
  const step3 = skill.match(/### 3\. Prefer Multiple-Choice Questions[\s\S]*?(?=### 4\.)/)?.[0] ?? '';
  const step4 = skill.match(/### 4\. Propose 2-3 Approaches with Trade-Offs[\s\S]*?(?=### 5\.)/)?.[0] ?? '';
  const antiPatterns = skill.match(/## Anti-Patterns[\s\S]*?(?=## )/)?.[0] ?? '';
  const exceptions = skill.match(/## Exception Handling[\s\S]*?(?=## )/)?.[0] ?? '';

  it('多选选项必须满足五项呈现要素：白话、同层、默认、错误代价、最多三项', () => {
    for (const phrase of [
      /Plain language/i,
      /Same altitude, mutually exclusive/i,
      /Mark a default/i,
      /Wrongness cost/i,
      /Three options max/i,
    ]) {
      assert.match(step3, phrase, `缺少选项呈现要素: ${phrase}`);
    }
  });

  it('用户无法评估的选项必须先问前置事实，按依赖顺序提问', () => {
    assert.match(step3, /prerequisite question first \(dependency order\)/i);
  });

  it('方案对比必须使用同一组维度，禁止各说各话', () => {
    assert.match(step4, /same dimensions/i);
    assert.match(step4, /scope touched, risk, fallback if it fails, follow-up cost/i);
  });

  it('推荐方案必须给出否决其他方案的理由，并附场景走查与切换条件', () => {
    assert.match(step4, /why each alternative is rejected/i);
    assert.match(step4, /bare verdict/i);
    assert.match(step4, /Concrete scenario/i);
    assert.match(step4, /Escape condition/i);
  });

  it('必须保留至少一个备选方案的底线规则', () => {
    assert.match(step4, /Never present a single path/i);
  });

  it('反模式必须包含“黑话选项菜单”，且要求降层而非重复解释', () => {
    assert.match(antiPatterns, /Jargon option menus/i);
    assert.match(antiPatterns, /descend one level/i);
  });

  it('用户看不懂选项时禁止原样重复菜单，须改白话+场景，仍不懂则问前置问题', () => {
    assert.match(exceptions, /never repeat the same menu verbatim/i);
    assert.match(exceptions, /plain language with one concrete scenario/i);
    assert.match(exceptions, /single prerequisite question/i);
  });
});
