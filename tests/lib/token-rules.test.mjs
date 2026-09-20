// tests/lib/token-rules.test.mjs
// Tests for scripts/lint/rules/token-rules.mjs — lint rule functions

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkMaxLines, checkMaxChars, checkMaxEmphasisMarkers, checkMaxCodeBlockLength, MAX_LINES_ASSET, MAX_CHARS_ASSET, MAX_LINES_LEAF, MAX_CHARS_LEAF, CONTROLLER_SKILLS, resolveBudget, default as tokenRules } from '../../scripts/lint/rules/token-rules.mjs';

const CTX = { skillDirs: ['test-skill'], skillsDir: '/fake/skills' };
const ROOT = process.cwd();
const read = file => readFileSync(join(ROOT, file), 'utf8');

describe('token-rules: checkMaxLines', () => {
  it('passes when under limit', async () => {
    const issues = await checkMaxLines('test', 'line1\nline2\nline3', CTX, 10);
    assert.equal(issues.length, 0);
  });

  it('fails when over limit', async () => {
    const content = Array(251).fill('line').join('\n');
    const issues = await checkMaxLines('test', content, CTX, 250);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, 'error');
    assert.ok(issues[0].message.includes('251'));
  });
});

describe('token-rules: checkMaxChars', () => {
  it('passes when under limit', async () => {
    const issues = await checkMaxChars('test', 'short', CTX, 100);
    assert.equal(issues.length, 0);
  });

  it('warns when over limit', async () => {
    const content = 'x'.repeat(10001);
    const issues = await checkMaxChars('test', content, CTX, 10000);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, 'warning');
  });
});

describe('token-rules: 入口与资产分级预算（bundle check）', () => {
  it('bundle 声明 appliesTo=all', () => {
    assert.equal(tokenRules.appliesTo, 'all');
    assert.equal(MAX_LINES_ASSET, 220);
    assert.equal(MAX_CHARS_ASSET, 12000);
  });

  it('资产子文件超过 220 行时报 error（阈值比入口 250 行更紧）', async () => {
    const content = Array(221).fill('line').join('\n');
    const issues = await tokenRules.check('test', content, { isSkillEntry: false });
    const lineIssue = issues.find(i => i.message.includes('lines'));
    assert.ok(lineIssue, '221 行的资产文件必须触发行数红线');
    assert.equal(lineIssue.severity, 'error');
    assert.ok(lineIssue.message.includes('220'), '错误消息必须携带资产阈值 220');
  });

  it('资产子文件 12001 字符时只报 warning（存量不触发整改）', async () => {
    const issues = await tokenRules.check('test', 'x'.repeat(12001), { isSkillEntry: false });
    const charIssue = issues.find(i => i.message.includes('chars'));
    assert.ok(charIssue, '12001 字符必须触发字符预算警告');
    assert.equal(charIssue.severity, 'warning');
    assert.ok(charIssue.message.includes('12000'));
  });

  it('资产阈值不放松行数约束：221~250 行区间中枢放行但资产报错', async () => {
    const content = Array(230).fill('line').join('\n');
    const entryIssues = await tokenRules.check('build-executor', content, { isSkillEntry: true });
    const assetIssues = await tokenRules.check('build-executor', content, { isSkillEntry: false });
    assert.equal(entryIssues.find(i => i.message.includes('lines')), undefined, '230 行对中枢合法');
    assert.ok(assetIssues.find(i => i.message.includes('lines')), '230 行对资产非法');
  });

  it('叶子入口超过 210 行时报 error（211~250 行区间中枢合法但叶子非法）', async () => {
    const content = Array(230).fill('line').join('\n');
    const leafIssues = await tokenRules.check('release-archivist', content, { isSkillEntry: true });
    const controllerIssues = await tokenRules.check('workflow-start', content, { isSkillEntry: true });
    assert.ok(leafIssues.find(i => i.message.includes('lines')), '230 行对叶子非法');
    assert.equal(controllerIssues.find(i => i.message.includes('lines')), undefined, '230 行对中枢合法');
  });

  it('resolveBudget 三档分级与字符阈值正确', () => {
    assert.deepEqual(resolveBudget('workflow-start', true), { lineLimit: 250, charLimit: 20000, tier: 'controller' });
    assert.deepEqual(resolveBudget('build-executor', true), { lineLimit: 250, charLimit: 20000, tier: 'controller' });
    assert.deepEqual(resolveBudget('release-archivist', true), { lineLimit: MAX_LINES_LEAF, charLimit: MAX_CHARS_LEAF, tier: 'leaf' });
    assert.deepEqual(resolveBudget('release-archivist', false), { lineLimit: MAX_LINES_ASSET, charLimit: MAX_CHARS_ASSET, tier: 'asset' });
    assert.ok(CONTROLLER_SKILLS.size === 2, '中枢集合只含两个状态机控制器');
  });

  it('存量叶子 SKILL.md 全部在 210 行 / 12000 字符内（阈值不得靠整改存量达成）', () => {
    const controllers = new Set(['workflow-start', 'build-executor']);
    const dirs = ['bug-investigator', 'code-reviewer', 'contract-builder', 'need-explorer',
      'release-archivist', 'spec-merger', 'spec-writer'].filter(d => !controllers.has(d));
    for (const dir of dirs) {
      const c = read(`skills/${dir}/SKILL.md`);
      assert.ok(c.split('\n').length <= MAX_LINES_LEAF, `${dir} 行数必须 ≤ ${MAX_LINES_LEAF}`);
      assert.ok(c.length <= MAX_CHARS_LEAF, `${dir} 字符数必须 ≤ ${MAX_CHARS_LEAF}`);
    }
  });

  it('资产文件豁免代码块长度红线（长 fenced 块是 prompt 模板本体），入口仍执行', async () => {
    const longBlock = '```\n' + Array(20).fill('code').join('\n') + '\n```';
    const assetIssues = await tokenRules.check('test', longBlock, { isSkillEntry: false });
    const entryIssues = await tokenRules.check('test', longBlock, { isSkillEntry: true });
    assert.equal(assetIssues.find(i => i.message.includes('Code block')), undefined,
      '资产文件的长 fenced 块不应触发代码块红线');
    assert.ok(entryIssues.find(i => i.message.includes('Code block')),
      '入口文档的超长代码块必须继续被拦截');
  });

  it('缺省 ctx 按 SKILL.md 入口阈值执行（历史行为不变）', async () => {
    const overEntry = Array(251).fill('line').join('\n');
    const issues = await tokenRules.check('test', overEntry);
    const lineIssue = issues.find(i => i.message.includes('lines'));
    assert.ok(lineIssue);
    assert.equal(lineIssue.severity, 'error');
    assert.ok(lineIssue.message.includes('250'));
  });
});

describe('token-rules: checkMaxEmphasisMarkers', () => {
  it('passes for content without banned markers', async () => {
    const issues = await checkMaxEmphasisMarkers('test', 'normal text with **some** emphasis', CTX, 30);
    assert.equal(issues.length, 0);
  });

  it('detects EXTREMELY_IMPORTANT', async () => {
    const issues = await checkMaxEmphasisMarkers('test', 'This is EXTREMELY_IMPORTANT content', CTX, 30);
    const eiIssue = issues.find(i => i.message.includes('EXTREMELY_IMPORTANT'));
    assert.ok(eiIssue, 'should flag EXTREMELY_IMPORTANT');
    assert.equal(eiIssue.severity, 'error');
  });

  it('detects CRITICAL', async () => {
    const issues = await checkMaxEmphasisMarkers('test', 'CRITICAL: do not skip', CTX, 30);
    const crIssue = issues.find(i => i.message.includes('CRITICAL'));
    assert.ok(crIssue, 'should flag CRITICAL');
    assert.equal(crIssue.severity, 'error');
  });

  it('warns on too many IMPORTANT occurrences', async () => {
    const content = 'IMPORTANT\n'.repeat(5) + 'text';
    const issues = await checkMaxEmphasisMarkers('test', content, CTX, 30);
    const impIssue = issues.find(i => i.message.includes('IMPORTANT'));
    assert.ok(impIssue, 'should flag excessive IMPORTANT');
  });

  it('warns on too many emphasis markers', async () => {
    const content = '**a** **b** '.repeat(31);
    const issues = await checkMaxEmphasisMarkers('test', content, CTX, 30);
    const empIssue = issues.find(i => i.message.includes('emphasis markers'));
    assert.ok(empIssue, 'should flag excessive emphasis');
    assert.equal(empIssue.severity, 'warning');
  });
});

describe('token-rules: checkMaxCodeBlockLength', () => {
  it('passes for short code blocks', async () => {
    const issues = await checkMaxCodeBlockLength('test', '```\nline1\nline2\n```', CTX, 5);
    assert.equal(issues.length, 0);
  });

  it('warns for long code blocks', async () => {
    const lines = Array(17).fill('code').join('\n');
    const content = '```\n' + lines + '\n```';
    const issues = await checkMaxCodeBlockLength('test', content, CTX, 15);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, 'warning');
    assert.ok(issues[0].message.includes('19'), `expected message to include '19', got: ${issues[0].message}`);
  });

  it('handles content with no code blocks', async () => {
    const issues = await checkMaxCodeBlockLength('test', 'just text, no code', CTX, 15);
    assert.equal(issues.length, 0);
  });
});

describe('spec publication documentation contract', () => {
  it('keeps Purpose optional for delta specs while documenting deterministic publication behavior', () => {
    const template = read('templates/spec.md');
    const merger = read('skills/spec-merger/SKILL.md');
    const artifactContract = read('docs/artifact-contract.md');

    assert.match(template, /## Purpose[\s\S]*可选/,
      'the delta template must present Purpose as an optional extension');
    assert.match(template, /可省略/,
      'legacy delta specs must remain valid without a Purpose section');
    assert.match(merger, /only when creating a canonical main spec/i,
      'Purpose handling must be limited to new main specs');
    assert.match(merger, /deterministic default Purpose/i,
      'missing Purpose must have an explicit deterministic fallback');
    assert.match(merger, /must not overwrite an existing main spec Purpose/i,
      'a delta Purpose must not rewrite an existing main spec');
    assert.match(artifactContract, /no-op.*already synchronized/i,
      'the artifact contract must identify an already-synchronized delta as a no-op');
    assert.match(artifactContract, /near-match.*must fail/i,
      'the artifact contract must keep near-match mistakes outside no-op handling');
  });
});

describe('SDD focused re-review documentation contract', () => {
  it('keeps repair dispatch CLI-governed and escalates a bounded re-review loop', () => {
    const executor = read('skills/build-executor/SKILL.md');
    const implementer = read('skills/build-executor/references/implementer-prompt.md');
    const reviewer = read('skills/build-executor/references/task-reviewer-prompt.md');
    const rereviewer = read('skills/build-executor/references/re-review-prompt.md');

    assert.match(executor, /execution show <change-dir> --json[\s\S]*repair/i,
      'the controller must read CLI repair state before dispatching a repair');
    assert.match(executor, /rounds? 1[–-]2[\s\S]*recovery/i,
      'the first two failed reviews must remain focused recovery rounds');
    assert.match(executor, /adjudication-required/i,
      'a third unresolved review must stop automatic dispatch for adjudication');
    assert.match(executor, /new evidence|new context|specific strategy change/i,
      'an implementer retry must add concrete information instead of repeating the same attempt');
    assert.match(executor, /prior failure reason[\s\S]*single objective[\s\S]*necessary file paths/i,
      'retry context must stay focused instead of repeating the planning pack');
    assert.match(executor, /ssf execution review[\s\S]*--verdict <pass\|fail>/i,
      'every re-review must be persisted through the CLI receipt command');
    assert.doesNotMatch(executor, /(?:write|edit|modify) a repair-state file to (?:continue|resolve|record)/i,
      'the controller must not be instructed to mutate repair-state files directly');

    assert.match(rereviewer, /scoped diff/i,
      'the re-review prompt must constrain review to the repair diff');
    assert.match(rereviewer, /previous review/i,
      'the re-review prompt must retain the prior finding as review context');
    assert.match(rereviewer, /adjudication-required/i,
      'the re-review prompt must stop at the circuit-breaker state');
    assert.match(implementer, /repair round/i,
      'implementers must receive the repair round as additional evidence');
    assert.match(reviewer, /repair scope/i,
      'reviewers must verify that a repair stays within its declared scope');
  });
});

describe('build executor continuity protocol contract', () => {
  it('keeps execution under host-controller control until a real terminal condition', () => {
    const executor = read('skills/build-executor/SKILL.md');

    assert.match(executor, /## Controller Continuity Protocol/,
      'the executor must define an explicit continuity protocol for the host controller');
    assert.match(executor, /active subtask|pending wave receipt/i,
      'active subtasks and pending wave receipts must keep the controller in an active execution state');
    assert.match(executor, /commentary/i,
      'non-terminal progress must be communicated as commentary');
    assert.match(executor, /must not.*final|do not.*final/i,
      'the controller must not send a final response while execution work remains active');
    assert.match(executor, /User interruption.*execution show[\s\S]*progress ledger/i,
      'resume must recover current execution state from both the CLI and progress ledger');
    assert.match(executor, /eligible repair|eligible task/i,
      'resume must continue the current eligible repair or task');
    assert.match(executor, /only.*completed|external blocker|user authorization/i,
      'only completion, an external blocker, or required user authorization may end the control turn');
    assert.match(executor, /host controller responsibility/i,
      'the protocol must attribute continuity to the host controller');
    assert.match(executor, /does not create.*background/i,
      'the skill must not claim that it creates autonomous background execution');
  });
});

describe('planning document readability contract', () => {
  it('keeps one human review gate and moves execution ritual out of planning documents', () => {
    const writer = read('skills/spec-writer/SKILL.md');
    const proposal = read('templates/proposal.md');
    const design = read('templates/design.md');
    const tasks = read('templates/tasks.md');

    assert.match(writer, /without pausing between individual artifacts/i);
    assert.match(writer, /one DP-2/i);
    assert.match(writer, /five-question blind reader check/i);
    assert.match(proposal, /完成证明/);
    assert.match(proposal, /Scope[\s\S]*In Scope[\s\S]*Out of Scope/);
    assert.match(design, /后果/);
    assert.match(tasks, /交付与证明/);
    assert.match(tasks, /execution contract \/ task brief/i);
    assert.doesNotMatch(tasks, /1\.2 运行测试并确认失败/);
  });
});

describe('test-quality guidance contract', () => {
  it('teaches falsifiable behavior tests without changing the existing mode boundaries', () => {
    const guide = read('skills/build-executor/references/writing-good-tests.md');
    const executor = read('skills/build-executor/SKILL.md');
    const implementer = read('skills/build-executor/references/implementer-prompt.md');
    const reviewer = read('skills/build-executor/references/task-reviewer-prompt.md');

    assert.match(guide, /可观察行为/,
      'the guide must make the behavior under test observable');
    assert.match(guide, /独立预期/,
      'the guide must require expectations that do not restate the implementation');
    assert.match(guide, /变异检查/,
      'the guide must require a concrete change that would make a behavior test fail');
    assert.match(guide, /文本存在断言/,
      'the guide must reject text-presence assertions as behavior tests');
    assert.match(guide, /纯文档[\s\S]*不需要[\s\S]*单元测试/,
      'documentation-only tasks must not be asked to invent unit tests');

    for (const [name, content] of Object.entries({ executor, implementer, reviewer })) {
      assert.match(content, /writing-good-tests\.md/,
        `${name} must point agents to the shared test-quality guide`);
    }

    assert.match(executor, /Quick follows the verification strategy persisted in its receipt/,
      'Quick must retain its user-selected verification strategy');
    assert.match(executor, /## Tweak Mode[\s\S]*Skip TDD/,
      'Tweak must retain its direct-edit boundary');
    assert.match(executor, /Full and legacy Hotfix still require RED → GREEN → REFACTOR/,
      'Full work must retain the TDD iron law');
  });
});
