// tests/lib/install-temp-dir.test.mjs
// W1 任务 1.1 回归：四处远程安装入口 SHALL 使用 os.tmpdir() 创建 clone
// 工作目录，MUST NOT 硬编码 POSIX 专用的 /tmp 路径。
// 动态导入被测函数：实现未导出时仅本用例失败，不影响源码文本扫描用例。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

describe('W1/1.1 安装器临时目录跨平台可用', () => {
  it('createTempCloneDir 在 os.tmpdir() 下创建唯一临时目录', async () => {
    const { createTempCloneDir } = await import('../../scripts/lib/install.mjs');
    const dir = await createTempCloneDir();
    try {
      assert.equal(existsSync(dir), true, 'mkdtemp 应真实创建目录');
      const expectedPrefix = resolve(tmpdir()).toLowerCase();
      assert.ok(
        resolve(dir).toLowerCase().startsWith(expectedPrefix),
        `临时目录 ${dir} 应位于 os.tmpdir()=${tmpdir()} 之下`,
      );
      assert.ok(
        basename(dir).startsWith('spec-superflow-'),
        '目录名应带 spec-superflow- 前缀',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // 四个远程安装入口均不得出现硬编码临时目录（精确匹配 bug 形状，避免误伤）。
  const sourceFiles = [
    'scripts/lib/install.mjs',
    'scripts/install-cursor.mjs',
    'scripts/install-zcode.mjs',
    'scripts/lib/cmd-install-workbuddy.mjs',
  ];
  for (const rel of sourceFiles) {
    it(`${rel} 不硬编码 POSIX 专用临时目录`, () => {
      const content = readFileSync(join(ROOT, rel), 'utf8');
      assert.ok(
        !content.includes("join('/tmp'"),
        `${rel} 仍含硬编码 join('/tmp', ...)，应改用 os.tmpdir()`,
      );
    });
  }
});
