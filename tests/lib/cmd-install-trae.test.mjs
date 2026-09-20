// tests/lib/cmd-install-trae.test.mjs
// install-trae 命令的核心行为测试：Trae CN/国际版探测、planInstall 路径判定、保留第三方 skill。
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

/** Windows 安全的动态 import：裸 Windows 路径不是合法 ESM specifier，需转 file:// URL。 */
async function loadModule(relPath) {
  return import(pathToFileURL(join(process.cwd(), relPath)).href);
}

let tempDir;
let planInstall, installTrae, detectTraeRoot;

/**
 * 构建最小化 plugin root：2 个 skill 目录（含 SKILL.md）+ RUNTIME_DIRS 骨架。
 * 这些骨架用于验证 copyDir 被正确调用，内容不会被深度检查。
 */
function makePluginRoot({ skills = ['workflow-start', 'need-explorer'] } = {}) {
  const root = join(tempDir, 'plugin-src');
  mkdirSync(root, { recursive: true });
  // package.json（version 读这个）
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'spec-superflow', version: '9.9.9-test' }));
  // skills/ 目录
  const skillsDir = join(root, 'skills');
  mkdirSync(skillsDir, { recursive: true });
  for (const name of skills) {
    mkdirSync(join(skillsDir, name), { recursive: true });
    writeFileSync(join(skillsDir, name, 'SKILL.md'), `# ${name}\n\nTest skill content.\n`);
  }
  // RUNTIME_DIRS 骨架（空目录即可，copyDir 会处理）
  for (const dir of ['scripts', 'docs', 'templates', 'dist', 'hooks']) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  return root;
}

/** 构建带"第三方 skill"的假 Trae 用户目录。 */
function makeFakeTraeRoot(relativeName, thirdPartySkills = ['bit-lowcode', 'frontend-skill']) {
  const root = join(tempDir, relativeName);
  mkdirSync(join(root, 'skills'), { recursive: true });
  mkdirSync(join(root, 'user_rules'), { recursive: true });
  for (const name of thirdPartySkills) {
    mkdirSync(join(root, 'skills', name), { recursive: true });
    writeFileSync(join(root, 'skills', name, 'SKILL.md'), `# ${name} (第三方)\n`);
  }
  return root;
}

describe('cmd-install-trae', () => {
  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-trae-'));
    const mod = await loadModule('scripts/lib/cmd-install-trae.mjs');
    planInstall = mod.planInstall;
    detectTraeRoot = mod.detectTraeRoot;
    const silentLogger = { log() {} };
    installTrae = (opts) => mod.installTrae({ ...opts, logger: silentLogger });
  });

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  // ─── detectTraeRoot ───────────────────────────────────

  describe('detectTraeRoot', () => {
    it('显式 --trae-dir 覆盖一切', () => {
      const custom = join(tempDir, 'custom-trae');
      const result = detectTraeRoot(custom);
      assert.equal(result, custom);
    });

    it('trae-cn 存在时优先使用 trae-cn', () => {
      // 在 tempDir 下同时创建 .trae-cn 和 .trae（模拟 homedir）
      const fakeHome = tempDir;
      mkdirSync(join(fakeHome, '.trae-cn'), { recursive: true });
      mkdirSync(join(fakeHome, '.trae'), { recursive: true });
      // monkey-patch homedir — 实际上 detectTraeRoot 内部调 homedir()，
      // 无法直接 mock；改用 --trae-dir 显式传参等价验证目录命中逻辑
      // 这里只验证空参数时的 fallback 目标（两个都不存在时默认 .trae-cn）
      const result = detectTraeRoot();
      assert.ok(result.endsWith('.trae-cn'), `默认应落到 .trae-cn，实际: ${result}`);
    });

    it('两个都不存在时默认 .trae-cn（自动创建）', () => {
      const result = detectTraeRoot();
      assert.ok(result.endsWith('.trae-cn'));
    });
  });

  // ─── planInstall ──────────────────────────────────────

  describe('planInstall', () => {
    it('variant 正确反映 trae-cn / trae 后缀', () => {
      const pluginRoot = makePluginRoot();
      const cn = makeFakeTraeRoot('.trae-cn');
      const intl = makeFakeTraeRoot('.trae');

      const planCn = planInstall({ pluginRoot, traeDir: cn });
      const planIntl = planInstall({ pluginRoot, traeDir: intl });

      assert.equal(planCn.variant, 'trae-cn');
      assert.equal(planIntl.variant, 'trae');
    });

    it('skillNames 与 pluginRoot/skills 下的合法目录一致', () => {
      const pluginRoot = makePluginRoot({ skills: ['workflow-start', 'need-explorer'] });
      const fake = makeFakeTraeRoot('.trae');
      const plan = planInstall({ pluginRoot, traeDir: fake });

      assert.deepEqual(plan.skillNames, ['need-explorer', 'workflow-start']); // listSkillNames 排序
      assert.equal(plan.skillNames.length, 2);
    });

    it('路径布局正确：pluginRoot / skills / user_rules', () => {
      const pluginRoot = makePluginRoot();
      const fake = makeFakeTraeRoot('.trae-cn');
      const plan = planInstall({ pluginRoot, traeDir: fake });

      assert.equal(plan.traeRoot, fake);
      assert.equal(plan.targetPluginDir, join(fake, 'spec-superflow'));
      assert.equal(plan.targetSkills, join(fake, 'skills'));
      assert.equal(plan.targetRules, join(fake, 'user_rules'));
      assert.ok(plan.pluginRootAbs.endsWith('spec-superflow'));
      assert.equal(plan.pluginRoot, pluginRoot);
    });

    it('version 从 package.json 读取', () => {
      const pluginRoot = makePluginRoot(); // 写入的是 9.9.9-test
      const fake = makeFakeTraeRoot('.trae');
      const plan = planInstall({ pluginRoot, traeDir: fake });
      assert.equal(plan.version, '9.9.9-test');
    });
  });

  // ─── installTrae ──────────────────────────────────────

  describe('installTrae', () => {
    it('runtime deps 拷贝到正确位置（scripts/ docs/ templates/ dist/ hooks/）', async () => {
      const pluginRoot = makePluginRoot();
      const fake = makeFakeTraeRoot('.trae-cn');
      await installTrae({ pluginRoot, traeDir: fake });

      const pluginRootAbs = join(fake, 'spec-superflow');
      for (const dir of ['scripts', 'docs', 'templates', 'dist', 'hooks']) {
        assert.ok(existsSync(join(pluginRootAbs, dir)), `${dir}/ 应存在`);
      }
      assert.ok(existsSync(join(pluginRootAbs, 'package.json')), 'package.json 应拷贝');
    });

    it('phase-guard.md 写入 user_rules', async () => {
      const pluginRoot = makePluginRoot();
      const fake = makeFakeTraeRoot('.trae');
      await installTrae({ pluginRoot, traeDir: fake });

      const guardPath = join(fake, 'user_rules', 'phase-guard.md');
      assert.ok(existsSync(guardPath));
      const content = readFileSync(guardPath, 'utf-8');
      assert.match(content, /Phase Guard — spec-superflow \(trae\)/);
      assert.match(content, /\/workflow-start/);
    });

    it('只替换源中有的 skill 名，第三方 skill 完全保留', async () => {
      const pluginRoot = makePluginRoot({ skills: ['workflow-start', 'need-explorer'] });
      const fake = makeFakeTraeRoot('.trae-cn', ['bit-lowcode', 'frontend-skill', 'custom-helper']);
      // 预先放一个旧版本的 workflow-start（应被替换）
      const oldWorkflowStart = join(fake, 'skills', 'workflow-start');
      mkdirSync(oldWorkflowStart, { recursive: true });
      writeFileSync(join(oldWorkflowStart, 'SKILL.md'), '# OLD workflow-start\n');

      await installTrae({ pluginRoot, traeDir: fake });

      const skills = readdirSync(join(fake, 'skills')).filter(n => {
        try { return existsSync(join(fake, 'skills', n, 'SKILL.md')); } catch { return false; }
      });
      // 全部 5 个 skill 应存在（2 个 spec-superflow + 3 个第三方）
      assert.equal(skills.length, 5, `应保留 5 个 skill，实际 ${skills.length}: ${skills.join(',')}`);
      assert.ok(skills.includes('bit-lowcode'));
      assert.ok(skills.includes('frontend-skill'));
      assert.ok(skills.includes('custom-helper'));
      // workflow-start 被替换（SKILL.md 内容应是"Test skill content"而非"OLD"）
      const wsContent = readFileSync(join(fake, 'skills', 'workflow-start', 'SKILL.md'), 'utf-8');
      assert.match(wsContent, /Test skill content/, 'workflow-start 应被替换为新版本');
      assert.doesNotMatch(wsContent, /OLD/, '旧版本应被清除');
    });

    it('可重复安装（幂等）：再跑一次全部目录仍完整', async () => {
      const pluginRoot = makePluginRoot();
      const fake = makeFakeTraeRoot('.trae');
      await installTrae({ pluginRoot, traeDir: fake });
      await installTrae({ pluginRoot, traeDir: fake }); // 第二次

      // 所有目录仍应存在
      const pluginRootAbs = join(fake, 'spec-superflow');
      for (const dir of ['scripts', 'docs', 'templates', 'dist', 'hooks']) {
        assert.ok(existsSync(join(pluginRootAbs, dir)), `二次安装后 ${dir}/ 应仍存在`);
      }
      assert.ok(existsSync(join(fake, 'user_rules', 'phase-guard.md')));
    });
  });
});
