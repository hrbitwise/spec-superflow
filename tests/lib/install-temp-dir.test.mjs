// tests/lib/install-temp-dir.test.mjs
// 回归守卫：远程安装入口 SHALL 使用 os.tmpdir()（经 release-source.mjs 的
// cloneRelease）创建 clone 工作目录，MUST NOT 硬编码 POSIX 专用的 /tmp 路径。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

describe('安装器临时目录跨平台可用', () => {
  // 远程安装相关源文件均不得出现硬编码临时目录（精确匹配 bug 形状，避免误伤）。
  const sourceFiles = [
    'scripts/lib/release-source.mjs',
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
