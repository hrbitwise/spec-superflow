// tests/lib/lint-skills-loader.test.mjs
// 回归测试：规则加载器在 Windows 下必须把裸盘符路径转换为 file:// URL 后再动态 import。
// 历史缺陷：未转换时每条规则都进入 catch 并打印 "failed to load rule"，
// 但脚本仍输出 0 issues 的假绿报告。本测试用子进程实跑两种加载路径，
// 断言（1）不存在任何规则加载失败警告；（2）扫描确实覆盖全部 9 个 skill。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const LINT_SCRIPT = join(process.cwd(), 'scripts', 'lint', 'lint-skills.mjs');

/**
 * 以子进程方式运行 lint-skills.mjs，合并 stdout/stderr 返回。
 * 不断言退出码：规则真正生效后，存量超限内容会产生非零退出码（CI 中该检查为 warning-only）。
 * @param {string[]} args - 透传给 lint 脚本的参数
 * @returns {{ output: string, stdout: string, stderr: string }} 合并后的进程输出
 */
function runLint(args) {
  const result = spawnSync(process.execPath, [LINT_SCRIPT, ...args], { encoding: 'utf-8' });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  return { output: stdout + stderr, stdout, stderr };
}

describe('lint-skills rule loader', () => {
  it('loads every bundled rule without file-URL import failures (default mode)', () => {
    const { output, stdout } = runLint(['--verbose']);

    assert.doesNotMatch(output, /failed to load rule/i,
      '规则加载失败（Windows 下通常是裸盘符路径未转换为 file:// URL）');

    const report = JSON.parse(stdout);
    assert.equal(report.results.length, 9, '扫描必须覆盖全部 9 个 skill');
  });

  it('loads token-rules without file-URL import failures (--include token)', () => {
    const { output } = runLint(['--include', 'token']);

    assert.doesNotMatch(output, /failed to load token-rules/i,
      'token-rules 加载失败（Windows 下通常是裸盘符路径未转换为 file:// URL）');
  });
});
