// tests/lib/runtime-rewrite.test.mjs
// Tests for scripts/lib/runtime-rewrite.mjs — shared portable-runtime rewriting.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadModule(relPath) {
  return import(pathToFileURL(join(process.cwd(), relPath)).href);
}

describe('runtime-rewrite', () => {
  it('rewrites a bare ssf debug invocation to the local runtime', async () => {
    const { rewriteRuntime } = await loadModule('scripts/lib/runtime-rewrite.mjs');
    const out = rewriteRuntime('Run `ssf debug attempt record <change-dir>`.', '/root/plugin');
    assert.doesNotMatch(out, /\bssf debug\b/);
    assert.match(out, /node ['"].+spec-superflow\.mjs['"] debug attempt record/);
  });

  it('rewrites npx and node scripts forms', async () => {
    const { rewriteRuntime } = await loadModule('scripts/lib/runtime-rewrite.mjs');
    const out = rewriteRuntime(
      '`npx --yes --package spec-superflow@0.12.1 ssf state init <dir>` and `node scripts/spec-superflow.mjs state get <dir>`',
      '/root/plugin',
    );
    assert.doesNotMatch(out, /npx --yes --package spec-superflow@\d+\.\d+\.\d+ ssf/);
    assert.doesNotMatch(out, /node scripts\/spec-superflow\.mjs/);
    assert.match(out, /node ['"].+spec-superflow\.mjs['"] state/);
  });

  it('rewriteSkillMarkdown rewrites SKILL.md and nested reference markdown', async () => {
    const { rewriteSkillMarkdown } = await loadModule('scripts/lib/runtime-rewrite.mjs');
    const root = mkdtempSync(join(tmpdir(), 'ssf-rewrite-skill-'));
    try {
      // 构造 skill 目录：SKILL.md + 同层子提示词 + 嵌套 references 子目录
      mkdirSync(join(root, 'references'), { recursive: true });
      const skillMd = join(root, 'SKILL.md');
      const subPrompt = join(root, 'sub-prompt.md');
      const nestedRef = join(root, 'references', 'checklist.md');
      writeFileSync(skillMd, 'Run `ssf validate <dir>`.', 'utf-8');
      writeFileSync(subPrompt, 'See `${CLAUDE_PLUGIN_ROOT}/docs`.', 'utf-8');
      writeFileSync(nestedRef, 'Use `ssf state get <dir>` under ${CLAUDE_PLUGIN_ROOT}.', 'utf-8');

      const count = rewriteSkillMarkdown(root, '/root/plugin');

      assert.equal(count, 3, '应递归覆盖 SKILL.md、同层子提示词与嵌套 references 文件');
      for (const file of [skillMd, subPrompt, nestedRef]) {
        const content = readFileSync(file, 'utf-8');
        assert.doesNotMatch(content, /\$\{CLAUDE_PLUGIN_ROOT\}/, `${file} 的占位符应被替换`);
      }
      assert.match(readFileSync(skillMd, 'utf-8'), /node ['"].+spec-superflow\.mjs['"] validate/);
      assert.match(readFileSync(nestedRef, 'utf-8'), /node ['"].+spec-superflow\.mjs['"] state/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
