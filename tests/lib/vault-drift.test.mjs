// tests/lib/vault-drift.test.mjs
// vault-drift 检查引擎测试：用临时目录构造「插件仓 + Obsidian vault」夹具，
// 覆盖镜像漂移（缺失/过期/多余/strict）、MOC 引用提取规则与断链/越界判定。
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const modulePath = join(process.cwd(), 'scripts/lib/vault-drift.mjs');
const vaultDrift = await import(pathToFileURL(modulePath).href);
const {
  checkSkillMirror,
  extractMocReferences,
  findMocFiles,
  checkMocLinks,
  checkVaultDrift,
  DEFAULT_MIRROR_DIR,
} = vaultDrift;

let fixtureRoot;

/** 创建本轮专用临时根目录，返回该路径。 */
function freshRoot(label) {
  fixtureRoot = mkdtempSync(join(tmpdir(), `ssf-vault-drift-${label}-`));
  return fixtureRoot;
}

/**
 * 构造标准夹具：插件源含两个 skill（其中一个带 references/），
 * vault 含 MOC 与完全同步的镜像。返回各关键路径供用例按需破坏。
 */
function setupFixture(label) {
  const root = freshRoot(label);
  const plugin = join(root, 'plugin');
  const vault = join(root, 'vault');

  const writeSource = (rel, content) => {
    const file = join(plugin, 'skills', ...rel.split('/'));
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content);
  };
  const writeMirror = (rel, content) => {
    const file = join(vault, DEFAULT_MIRROR_DIR, ...rel.split('/'));
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content);
  };
  const writeVault = (rel, content) => {
    const file = join(vault, ...rel.split('/'));
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content);
  };

  writeSource('workflow-start/SKILL.md', '# workflow-start\nv1\n');
  writeSource('build-executor/SKILL.md', '# build-executor\nv1\n');
  writeSource('build-executor/references/implementer-prompt.md', 'prompt v1\n');
  writeMirror('workflow-start/SKILL.md', '# workflow-start\nv1\n');
  writeMirror('build-executor/SKILL.md', '# build-executor\nv1\n');
  writeMirror('build-executor/references/implementer-prompt.md', 'prompt v1\n');
  writeVault('MOC-test.md', '# MOC\n\n见 `架构设计/存在.md`。\n');
  writeVault('架构设计/存在.md', '# 存在\n');

  return { root, plugin, vault, writeSource, writeMirror, writeVault };
}

afterEach(() => {
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
  fixtureRoot = null;
});

describe('vault-drift: checkSkillMirror()', () => {
  it('镜像与源完全一致时无 issue', () => {
    const { plugin, vault } = setupFixture('clean');
    const result = checkSkillMirror(plugin, vault);
    assert.equal(result.issues.length, 0, JSON.stringify(result.issues));
    assert.equal(result.sourceCount, 3);
    assert.equal(result.mirroredCount, 3);
    assert.equal(result.syncedCount, 3);
  });

  it('镜像缺失文件报 mirror-missing(error)', () => {
    const { plugin, vault } = setupFixture('missing');
    rmSync(join(vault, DEFAULT_MIRROR_DIR, 'build-executor', 'references'), {
      recursive: true,
      force: true,
    });
    const result = checkSkillMirror(plugin, vault);
    const issue = result.issues.find(i => i.kind === 'mirror-missing');
    assert.ok(issue, 'expected a mirror-missing issue');
    assert.equal(issue.severity, 'error');
    assert.match(issue.file, /build-executor\/references\/implementer-prompt\.md$/);
  });

  it('镜像内容过期报 mirror-outdated(error)', () => {
    const { plugin, vault } = setupFixture('outdated');
    writeFileSync(
      join(vault, DEFAULT_MIRROR_DIR, 'workflow-start', 'SKILL.md'),
      '# workflow-start\nSTALE\n',
    );
    const result = checkSkillMirror(plugin, vault);
    const issue = result.issues.find(i => i.kind === 'mirror-outdated');
    assert.ok(issue, 'expected a mirror-outdated issue');
    assert.equal(issue.severity, 'error');
    assert.match(issue.detail, /content differs/);
  });

  it('镜像中源已删除的文件报 mirror-extra(warning)', () => {
    const { plugin, vault, writeMirror } = setupFixture('extra');
    writeMirror('removed-skill/SKILL.md', 'legacy\n');
    const result = checkSkillMirror(plugin, vault);
    const issue = result.issues.find(i => i.kind === 'mirror-extra');
    assert.ok(issue, 'expected a mirror-extra issue');
    assert.equal(issue.severity, 'warning');
    // 默认模式下 warning 不阻断主入口。
    const overall = checkVaultDrift(plugin, vault);
    assert.equal(overall.ok, true);
    assert.equal(overall.pass, true);
  });

  it('strict 模式下 mirror-extra 导致失败', () => {
    const { plugin, vault, writeMirror } = setupFixture('strict');
    writeMirror('removed-skill/SKILL.md', 'legacy\n');
    const overall = checkVaultDrift(plugin, vault, { strict: true });
    assert.equal(overall.pass, false);
    assert.equal(overall.summary.warnings, 1);
  });
});

describe('vault-drift: extractMocReferences()', () => {
  it('提取反引号文件/目录引用、双链与裸文本路径，跳过占位符/URL/家目录/fenced 块', () => {
    const markdown = [
      '# MOC',
      '',
      '行3：`架构设计/存在.md` 与 `docs/datascope/` 目录。',
      '行4：裸路径 docs/intro.md 与 [[specs/approval/x/spec.md]]。',
      '行5：应跳过 `specs/<域>/<change>/spec.md`、`~/notes/x.md`、https://h.com/a/b.md。',
      '行6：无分隔符裸词 `search_notes` 不提取。',
      '```',
      'fenced/missing.md',
      '```',
      '行10：`../outside.md` 越界也要提取（交由链接检查判 unsafe）。',
    ].join('\n');

    const refs = extractMocReferences(markdown);
    const paths = refs.map(r => r.path);

    assert.ok(paths.includes('架构设计/存在.md'));
    assert.ok(paths.includes('docs/datascope'));
    assert.ok(paths.includes('docs/intro.md'));
    assert.ok(paths.includes('specs/approval/x/spec.md'));
    assert.ok(!paths.some(p => p.includes('<')));
    assert.ok(!paths.some(p => p.startsWith('~')));
    assert.ok(!paths.includes('fenced/missing.md'));
    assert.ok(!paths.includes('search_notes'));
    assert.ok(!paths.some(p => p.includes('h.com')));

    // 行号保留：首个引用在第 3 行。
    assert.equal(refs.find(r => r.path === '架构设计/存在.md').line, 3);
    // 同一路径多次出现只保留首次行号（去重）。
    const twice = `${'`x/y.md`\n'.repeat(2)}`;
    assert.equal(extractMocReferences(twice).length, 1);
  });
});

describe('vault-drift: findMocFiles()', () => {
  it('默认发现 vault 根下 MOC*.md，显式路径优先，找不到时 missing=true', () => {
    const { vault } = setupFixture('moc');
    const found = findMocFiles(vault);
    assert.equal(found.missing, false);
    assert.equal(found.files.length, 1);
    assert.match(found.files[0], /MOC-test\.md$/);

    const explicit = findMocFiles(vault, 'MOC-test.md');
    assert.equal(explicit.missing, false);

    const bad = findMocFiles(vault, 'nope/MOC-x.md');
    assert.equal(bad.missing, true);
    assert.deepEqual(bad.files, []);
  });
});

describe('vault-drift: checkMocLinks()', () => {
  it('存在的路径不报告；断链报 moc-broken-link 并带 MOC 文件名与行号', () => {
    const { vault, writeVault } = setupFixture('links');
    const moc = join(vault, 'MOC-links.md');
    writeFileSync(moc, '# MOC\n\n- `架构设计/缺失.md`\n- `架构设计/存在.md`\n', 'utf8');
    writeVault('MOC-other.md', '# O\n');

    const issues = checkMocLinks(vault, [moc]);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].kind, 'moc-broken-link');
    assert.equal(issues[0].line, 3);
    assert.match(issues[0].file, /MOC-links\.md$/);
    assert.match(issues[0].detail, /架构设计\/缺失\.md/);
  });

  it('含 .. 越界段报 moc-unsafe-link', () => {
    const { vault } = setupFixture('unsafe');
    const moc = join(vault, 'MOC-u.md');
    writeFileSync(moc, '# MOC\n\n`../escape.md`\n', 'utf8');
    const issues = checkMocLinks(vault, [moc]);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].kind, 'moc-unsafe-link');
  });
});

describe('vault-drift: checkVaultDrift() 主入口', () => {
  it('干净夹具 pass=true 且计数正确', () => {
    const { plugin, vault } = setupFixture('ok');
    const result = checkVaultDrift(plugin, vault);
    assert.equal(result.ok, true);
    assert.equal(result.pass, true);
    assert.equal(result.summary.errors, 0);
    assert.equal(result.summary.sourceFiles, 3);
    assert.equal(result.summary.syncedFiles, 3);
    assert.equal(result.summary.mocCount, 1);
  });

  it('vault 根不存在时 ok=false 并给致命原因', () => {
    const { plugin, root } = setupFixture('novault');
    const result = checkVaultDrift(plugin, join(root, 'no-such-vault'));
    assert.equal(result.ok, false);
    assert.equal(result.pass, false);
    assert.match(result.fatal, /vault root not found/);
  });

  it('无 MOC 索引时 ok=false 并提示 --moc', () => {
    const { plugin, vault } = setupFixture('nomoc');
    rmSync(join(vault, 'MOC-test.md'));
    const result = checkVaultDrift(plugin, vault);
    assert.equal(result.ok, false);
    assert.match(result.fatal, /no MOC\*\.md/);
  });

  it('镜像缺失与 MOC 断链同时出现时 pass=false 且分类计数', () => {
    const { plugin, vault, writeMirror } = setupFixture('mixed');
    rmSync(join(vault, DEFAULT_MIRROR_DIR, 'workflow-start', 'SKILL.md'));
    writeMirror('ghost/SKILL.md', 'extra\n');
    writeFileSync(join(vault, 'MOC-test.md'), '# MOC\n\n`架构设计/幽灵.md`\n', 'utf8');

    const result = checkVaultDrift(plugin, vault);
    assert.equal(result.ok, true);
    assert.equal(result.pass, false);
    const kinds = result.issues.map(i => i.kind);
    assert.ok(kinds.includes('mirror-missing'));
    assert.ok(kinds.includes('moc-broken-link'));
    assert.ok(kinds.includes('mirror-extra'));
    assert.equal(result.summary.errors, 2);
    assert.equal(result.summary.warnings, 1);
  });
});
