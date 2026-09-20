// tests/lib/asset-references.test.mjs
// Tests for scripts/lint/rules/asset-references.mjs — 引用完整性规则（悬空引用 / 孤儿资产）

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  extractAssetRefs,
  buildReferenceGraph,
  parseFrontmatter,
  checkDanglingReferences,
  checkAssetDeclarations,
  checkOrphanAssets,
  default as assetReferencesRule,
} from '../../scripts/lint/rules/asset-references.mjs';

/**
 * 递归收集目录下全部 .md 文件（测试辅助，镜像 lint-skills 的收集逻辑）
 * @param {string} dir - 扫描目录
 * @returns {string[]} 相对 dir 的 posix 路径
 */
function collectMarkdowns(dir) {
  const out = [];
  const walk = d => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && ent.name.endsWith('.md')) out.push(relative(dir, full).split(sep).join('/'));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

describe('asset-references: extractAssetRefs', () => {
  it('提取 skills 全路径引用（反引号与 runtime asset read 两种形态）', () => {
    const content = [
      'Read `skills/build-executor/writing-good-tests.md` first.',
      'Load with `ssf runtime asset read skills/build-executor/implementer-prompt.md`.',
    ].join('\n');
    const refs = extractAssetRefs(content, 'build-executor/SKILL.md');
    const skillRefs = refs.filter(r => r.kind === 'skill').map(r => r.path);
    assert.deepEqual(skillRefs.sort(), [
      'build-executor/implementer-prompt.md',
      'build-executor/writing-good-tests.md',
    ]);
  });

  it('仅从 runtime asset read 加载指令提取 docs/templates 引用，正文裸写不提取', () => {
    const content = [
      'Run `ssf runtime asset read docs/state-machine.md` when ambiguous.',
      'See docs/artifact-contract.md for background without a load command.',
    ].join('\n');
    const refs = extractAssetRefs(content, 'workflow-start/SKILL.md');
    const repoRefs = refs.filter(r => r.kind === 'repo').map(r => r.path);
    assert.deepEqual(repoRefs, ['docs/state-machine.md']);
  });

  it('提取同目录裸文件名并携带当前目录', () => {
    const refs = extractAssetRefs('dispatch the `re-review-prompt.md` reviewer', 'build-executor/SKILL.md');
    const bare = refs.filter(r => r.kind === 'bare');
    assert.equal(bare.length, 1);
    assert.equal(bare[0].file, 're-review-prompt.md');
    assert.equal(bare[0].dir, 'build-executor');
  });

  it('剔除含占位符的运行时路径并对重复引用去重', () => {
    const content = [
      'write to `skills/x/<wave-id>-rereview.md`',
      'load `skills/x/[CHANGE_DIR]/guide.md`',
      'twice `skills/x/a.md` and `skills/x/a.md`',
    ].join('\n');
    const refs = extractAssetRefs(content, 'x/SKILL.md');
    assert.deepEqual(refs, [{ kind: 'skill', path: 'x/a.md' }]);
  });
});

describe('asset-references: checkDanglingReferences', () => {
  it('skills 全路径目标不存在时报 error', async () => {
    const ctx = {
      file: 'build-executor/SKILL.md',
      isSkillEntry: true,
      assets: new Set(['build-executor/SKILL.md']),
    };
    const issues = await checkDanglingReferences('build-executor', 'read `skills/build-executor/missing.md`', ctx);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, 'error');
    assert.match(issues[0].message, /missing\.md/);
  });

  it('skills 全路径目标存在时不报错', async () => {
    const ctx = {
      file: 'build-executor/SKILL.md',
      isSkillEntry: true,
      assets: new Set(['build-executor/SKILL.md', 'build-executor/implementer-prompt.md']),
    };
    const issues = await checkDanglingReferences('build-executor', 'load `skills/build-executor/implementer-prompt.md`', ctx);
    assert.equal(issues.length, 0);
  });

  it('docs/templates 加载目标按 repoAssets 集合判定，缺失时报 error', async () => {
    const ctx = {
      file: 'workflow-start/SKILL.md',
      isSkillEntry: true,
      assets: new Set(['workflow-start/SKILL.md']),
      repoAssets: new Set(['docs/state-machine.md']),
    };
    const content = '`ssf runtime asset read docs/state-machine.md` and `ssf runtime asset read docs/gone.md`';
    const issues = await checkDanglingReferences('workflow-start', content, ctx);
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /docs\/gone\.md/);
  });

  it('裸文件名同目录不存在时按 change 工件名忽略（零误报）', async () => {
    const ctx = {
      file: 'spec-writer/SKILL.md',
      isSkillEntry: true,
      assets: new Set(['spec-writer/SKILL.md']),
    };
    const issues = await checkDanglingReferences('spec-writer', 'generate `proposal.md` and `tasks.md`', ctx);
    assert.equal(issues.length, 0);
  });

  it('缺少资产清单上下文时不阻断（无 ctx.assets 直接放行）', async () => {
    const issues = await checkDanglingReferences('x', 'read `skills/x/missing.md`', { file: 'x/SKILL.md' });
    assert.equal(issues.length, 0);
  });
});

describe('asset-references: checkOrphanAssets', () => {
  /** 构造共享测试上下文 */
  const makeCtx = (file, isSkillEntry) => ({
    file,
    isSkillEntry,
    assets: new Set([
      'a/SKILL.md',
      'a/used.md',
      'a/orphan.md',
      'b/SKILL.md',
    ]),
    referenced: new Set(['a/used.md']),
  });

  it('入口扫描时只报本目录无入边的资产为 warning', async () => {
    const issues = await checkOrphanAssets('a', '', makeCtx('a/SKILL.md', true));
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, 'warning');
    assert.match(issues[0].message, /a\/orphan\.md/);
  });

  it('不把其他 skill 目录的孤儿算到本目录', async () => {
    const issues = await checkOrphanAssets('b', '', makeCtx('b/SKILL.md', true));
    assert.equal(issues.length, 0);
  });

  it('扫描子文件时跳过孤儿判定，避免同目录重复报告', async () => {
    const issues = await checkOrphanAssets('a', '', makeCtx('a/used.md', false));
    assert.equal(issues.length, 0);
  });
});

describe('asset-references: parseFrontmatter', () => {
  it('解析标量与 assets 数组，忽略注释行，容忍 description 中的冒号', () => {
    const content = [
      '---',
      'name: demo-skill',
      'description: A demo: with colons, and commas.',
      '# 这是注释',
      'assets:',
      '  - references/a.md',
      '  - references/b.md',
      '---',
      '',
      '# Body',
    ].join('\n');
    const fm = parseFrontmatter(content);
    assert.equal(fm.name, 'demo-skill');
    assert.equal(fm.description, 'A demo: with colons, and commas.');
    assert.deepEqual(fm.assets, ['references/a.md', 'references/b.md']);
  });

  it('无 frontmatter 时返回 null', () => {
    assert.equal(parseFrontmatter('# Just a heading'), null);
  });
});

describe('asset-references: checkAssetDeclarations 四象限', () => {
  /** 构造含 frontmatter 的入口文档 */
  const entry = assets => [
    '---',
    'name: demo',
    'description: demo skill',
    ...(assets ? ['assets:', ...assets.map(a => `  - ${a}`)] : []),
    '---',
    '',
  ].join('\n');

  const baseCtx = (assetsOnDisk, file = 'demo/SKILL.md') => ({
    file,
    isSkillEntry: true,
    assets: new Set(['demo/SKILL.md', ...assetsOnDisk]),
  });

  it('象限一：声明路径不存在时报 error', async () => {
    const content = entry(['references/gone.md']);
    const issues = await checkAssetDeclarations('demo', content, baseCtx([]));
    const err = issues.find(i => i.severity === 'error' && /Declared asset not found/.test(i.message));
    assert.ok(err, '声明不存在的资产必须报错');
    assert.match(err.message, /gone\.md/);
  });

  it('象限二：磁盘有资产但未登记时报 warning', async () => {
    const content = entry([]);
    const issues = await checkAssetDeclarations('demo', content, baseCtx(['demo/references/real.md']));
    const warn = issues.find(i => /Undeclared asset/.test(i.message));
    assert.ok(warn, '存在却未登记的资产必须警告');
    assert.match(warn.message, /real\.md/);
  });

  it('象限三：正文引用本 skill 资产却未声明时报 warning', async () => {
    const content = entry([]) + 'Load `skills/demo/references/used.md` now.';
    const issues = await checkAssetDeclarations('demo', content, baseCtx(['demo/references/used.md']));
    assert.ok(issues.some(i => /Reference without declaration/.test(i.message)),
      '引用未声明资产必须警告');
    assert.ok(issues.some(i => /Undeclared asset/.test(i.message)),
      '该资产同时也应被象限二捕获');
  });

  it('声明、磁盘、引用三者一致时无 issue；无资产 skill 省略 assets 字段亦合法', async () => {
    const content = entry(['references/used.md']) + 'Load `skills/demo/references/used.md`.';
    const issues = await checkAssetDeclarations('demo', content, baseCtx(['demo/references/used.md']));
    assert.deepEqual(issues, []);

    const noAssetIssues = await checkAssetDeclarations('empty', '# no frontmatter, no assets', {
      file: 'empty/SKILL.md', isSkillEntry: true, assets: new Set(['empty/SKILL.md']),
    });
    assert.deepEqual(noAssetIssues, []);
  });

  it('扫描子文件轮次时跳过声明检查', async () => {
    const issues = await checkAssetDeclarations('demo', 'whatever', {
      file: 'demo/references/used.md', isSkillEntry: false, assets: new Set(),
    });
    assert.deepEqual(issues, []);
  });
});

describe('asset-references: buildReferenceGraph', () => {
  it('全路径与同目录裸名引用都能建立有效入边', () => {
    const contents = new Map([
      ['a/SKILL.md', 'load `skills/a/full.md` and dispatch `bare.md`'],
      ['a/full.md', ''],
      ['a/bare.md', ''],
    ]);
    const referenced = buildReferenceGraph(contents);
    assert.ok(referenced.has('a/full.md'));
    assert.ok(referenced.has('a/bare.md'));
  });

  it('指向不存在目标的裸名不建立入边（工件名歧义不污染引用图）', () => {
    const contents = new Map([
      ['a/SKILL.md', 'write `proposal.md` then read `skills/a/exists.md`'],
      ['a/exists.md', ''],
      ['a/actually-orphan.md', ''],
    ]);
    const referenced = buildReferenceGraph(contents);
    assert.deepEqual([...referenced].sort(), ['a/exists.md']);
  });
});

describe('asset-references: 真实 skills 目录集成契约', () => {
  const SKILLS_DIR = join(process.cwd(), 'skills');

  it('存量全部资产可达：无悬空引用、无孤儿资产', async () => {
    const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
    // 路径基准为 SKILLS_DIR（rel 形如 build-executor/SKILL.md），与 lint-skills 生产逻辑一致
    const assetContents = new Map();
    for (const rel of collectMarkdowns(SKILLS_DIR)) {
      assetContents.set(rel, readFileSync(join(SKILLS_DIR, ...rel.split('/')), 'utf-8'));
    }
    const ctx = {
      skillDirs: dirs,
      skillsDir: SKILLS_DIR,
      assets: new Set(assetContents.keys()),
      referenced: buildReferenceGraph(assetContents),
      repoRoot: process.cwd(),
    };

    const dangling = [];
    const orphans = [];
    const declarations = [];
    for (const dir of dirs) {
      for (const [rel, content] of assetContents) {
        if (!rel.startsWith(`${dir}/`)) continue;
        const fileCtx = { ...ctx, file: rel, isSkillEntry: rel === `${dir}/SKILL.md` };
        dangling.push(...await checkDanglingReferences(dir, content, fileCtx));
        orphans.push(...await checkOrphanAssets(dir, content, fileCtx));
        declarations.push(...await checkAssetDeclarations(dir, content, fileCtx));
      }
    }
    assert.deepEqual(dangling, [], '存量 skill 文档不允许存在悬空资产引用');
    assert.deepEqual(orphans, [], '存量 skills 目录不允许存在无入边的孤儿资产');
    assert.deepEqual(declarations, [], '存量 frontmatter assets 声明必须与磁盘资产和正文引用完全一致');
  });

  it('bundle 声明 appliesTo=all（入口与子文件都受约束）', () => {
    assert.equal(assetReferencesRule.appliesTo, 'all');
  });
});
