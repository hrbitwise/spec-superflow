// tests/lib/skill-consistency.test.mjs
// `ssf doctor skills` 事实核对引擎测试：真实仓库 dogfood（必须零问题）+
// 合成夹具证明每一类漂移都能被检出 + 解析器单元测试。
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

let tempDir;

const {
  extractCliCatalog,
  parseSkillInvocations,
  checkSkillConsistency,
  buildThresholdRules,
} = await import(pathToFileURL(join(process.cwd(), 'scripts', 'lib', 'skill-consistency.mjs')).href);

describe('skill-consistency: 真实仓库目录提取', () => {
  const catalog = extractCliCatalog(process.cwd());

  it('从 COMMANDS 注册表提取顶层命令', () => {
    assert.ok(catalog.commands.has('execution'));
    assert.ok(catalog.commands.has('doctor'));
    assert.ok(catalog.commands.has('runtime'));
  });

  it('提取二级子命令（数组、=== 比较、case 三种写法）', () => {
    const execution = catalog.commands.get('execution');
    for (const sub of ['recommend', 'plan', 'show', 'revise', 'review', 'adjudicate', 'resync']) {
      assert.ok(execution.subcommands.has(sub), `missing execution sub: ${sub}`);
    }
    assert.ok(catalog.commands.get('state').subcommands.has('transition'));
    assert.ok(catalog.commands.get('runtime').subcommands.has('asset'));
  });

  it('提取 parseArgs 内联 flag、命名常量 flag 与跨行多键', () => {
    assert.ok(catalog.commands.get('execution').flags.has('acknowledge-recommendation'));
    assert.ok(catalog.commands.get('debug').flags.has('id'), 'OPTIONS 命名常量');
    assert.ok(catalog.commands.get('checkpoint').flags.has('commit-start'), 'CHECKPOINT_SAVE_OPTIONS 命名常量');
    assert.ok(catalog.commands.get('handoff').flags.has('expected-output'), '单行多键内联 options');
    assert.ok(catalog.commands.get('isolate').flags.has('force'));
  });

  it('沿动态 import / runScript 递归收集被转发模块的 flag', () => {
    // runtime config 转发 cmd-config；runtime guard 转发 scripts/guard/guard.mjs
    assert.ok(catalog.commands.get('runtime').flags.has('resolve-model'));
    assert.ok(catalog.commands.get('runtime').flags.has('get'));
  });

  it('提取 runtime asset 白名单', () => {
    assert.ok(catalog.assetAllowlist.has('skills/build-executor/implementer-prompt.md'));
    assert.ok(catalog.assetAllowlist.has('docs/state-machine.md'));
  });
});

describe('skill-consistency: parseSkillInvocations()', () => {
  it('解析折行、占位符、引号值、flag=value 与 asset 路径', () => {
    const markdown = [
      '```bash',
      'ssf execution review <change-dir> --wave <wave-id> \\',
      '  --base <sha> --head [HEAD_SHA] --verdict=pass',
      'ssf debug escalate changes/x --reason "three; things" --confirm',
      'ssf runtime asset read skills/build-executor/implementer-prompt.md',
      '```',
    ].join('\n');
    const invocations = parseSkillInvocations(markdown);
    assert.equal(invocations.length, 3);

    const review = invocations[0];
    assert.equal(review.command, 'execution');
    assert.equal(review.subcommand, 'review');
    assert.deepEqual(review.flags, ['wave', 'base', 'head', 'verdict']);
    assert.equal(review.line, 2, '折行后保留起始行号');

    const escalate = invocations[1];
    assert.equal(escalate.command, 'debug');
    assert.equal(escalate.subcommand, 'escalate');
    assert.deepEqual(escalate.flags, ['reason', 'confirm']);

    const asset = invocations[2];
    assert.equal(asset.command, 'runtime');
    assert.equal(asset.subcommand, 'asset');
    assert.equal(asset.assetPath, 'skills/build-executor/implementer-prompt.md');
  });

  it('不把占位符或 pass|fail 这类值误判为子命令', () => {
    const invocations = parseSkillInvocations('ssf state transition changes/x approved-for-build');
    assert.equal(invocations[0].command, 'state');
    assert.equal(invocations[0].subcommand, 'transition');
  });
});

describe('skill-consistency: 真实仓库 dogfood', () => {
  it('全部 skill 文档与 CLI 一致（漂移红灯）', () => {
    const result = checkSkillConsistency(process.cwd());
    assert.deepEqual(result.issues, [], result.message);
    assert.equal(result.pass, true);
    assert.ok(result.message.includes('14 skill files'));
  });

  it('阈值契约全部满足（裁决次数/DP-5/状态名/执行模式）', () => {
    const rules = buildThresholdRules(process.cwd());
    for (const rule of rules) {
      assert.equal(rule.satisfied, true, `${rule.concept} (${rule.file})`);
    }
  });
});

describe('skill-consistency: 合成夹具检出全部漂移类型', () => {
  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-skill-consistency-'));
  });

  // mkdir + write 的小助手（UTF-8 无 BOM）。
  function write(relativePath, content) {
    const filePath = join(tempDir, relativePath);
    mkdirSync(join(filePath, '..'), { recursive: true });
    writeFileSync(filePath, content, 'utf8');
  }

  before(() => {
    // CLI 注册表（合成）
    write('scripts/spec-superflow.mjs', `
const COMMANDS = {
  foo:     () => import('./lib/cmd-foo.mjs'),
  runtime: () => import('./lib/cmd-runtime.mjs'),
};
`);
    // cmd-foo：两个子命令、两个 flag
    write('scripts/lib/cmd-foo.mjs', `
import { parseArgs } from 'node:util';
const SUBCOMMANDS = ['plan', 'show'];
export function run(args) {
  parseArgs({ args, options: {
    alpha: { type: 'string' },
    beta: { type: 'boolean', default: false },
  }});
  if (args[0] === 'plan') return;
}
`);
    // cmd-runtime：asset 白名单 + asset 子命令
    write('scripts/lib/cmd-runtime.mjs', `
const ASSETS = new Set(['skills/x/exists.md', 'docs/missing.md']);
export function run(args) {
  switch (args[0]) { case 'asset': return; }
}
`);
    // 阈值契约所需文件（与真实常量 N=3 / 真实模式列表对齐）
    write('scripts/lib/cmd-state.mjs', "const VALID_STATES = ['exploring', 'closing'];");
    write('skills/workflow-start/SKILL.md', '# routing\nexploring → closing\n');
    write('skills/build-executor/SKILL.md',
      '# build\nmodes: inline batch-inline sdd\nthe third unresolved failure stops the wave\n');
    write('skills/bug-investigator/SKILL.md',
      '# debug\nAfter at least three distinct evidence-backed attempts, stop.\n');
    // 合法脚本文件
    write('scripts/hello', '#!/usr/bin/env node\n');
    // 合法 asset 文件
    write('skills/x/exists.md', '# allowlisted and present\n');
    // 被测 skill：混合合法与非法引用
    write('skills/x/SKILL.md', [
      '# X',
      'good: `ssf foo plan changes/demo --alpha v --beta`',
      'unknown command: `ssf bar thing --alpha`',
      'unknown sub: `ssf foo nope changes/demo`',
      'unknown flag: `ssf foo plan --gamma`',
      'asset ok: `ssf runtime asset read skills/x/exists.md`',
      'asset unlisted: `ssf runtime asset read skills/x/nope.md`',
      'asset allowlisted but missing: `ssf runtime asset read docs/missing.md`',
      'script good: `scripts/hello`',
      'script missing: `scripts/nope-script`',
    ].join('\n'));
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('逐类报告 unknown-command/sub/flag、asset、script 漂移且阈值规则无误报', () => {
    const result = checkSkillConsistency(tempDir);
    assert.equal(result.pass, false);
    const kinds = new Set(result.issues.map(issue => issue.kind));
    assert.deepEqual([...kinds].sort(), [
      'asset-missing',
      'asset-not-allowlisted',
      'script-missing',
      'unknown-command',
      'unknown-flag',
      'unknown-subcommand',
    ]);
    // 合法引用（--alpha/--beta）不应产生问题
    assert.ok(!result.issues.some(issue => issue.kind === 'unknown-flag' && /'--(alpha|beta)'/.test(issue.detail)));
    assert.ok(!result.issues.some(issue => issue.kind === 'threshold-drift'), result.message);
  });

  it('skills 目录缺失时明确失败而非静默通过', () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), 'ssf-skill-consistency-empty-'));
    mkdirSync(join(emptyRoot, 'scripts', 'lib'), { recursive: true });
    writeFileSync(join(emptyRoot, 'scripts', 'spec-superflow.mjs'), 'const COMMANDS = {};\n');
    try {
      const result = checkSkillConsistency(emptyRoot);
      assert.equal(result.pass, false);
      assert.ok(result.issues.some(issue => issue.kind === 'threshold-drift'));
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });
});
