// tests/lib/install-hook-command.test.mjs
// W1 任务 1.2 回归：Cursor/ZCode 安装器生成的 SessionStart hook 命令
// SHALL 为 bash "<正斜杠绝对路径>"：反斜杠全部归一、双引号包裹，
// 含空格路径不被截断，与 CodeBuddy 的 buildSessionStartCommand 对齐。
// 动态导入：实现未导出时仅对应用例失败，RED 证据可逐平台区分。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('W1/1.2 Cursor SessionStart hook 命令路径归一化', () => {
  it('Windows 风格路径转为正斜杠并以双引号包裹', async () => {
    const { buildSessionStartCommand } = await import('../../scripts/install-cursor.mjs');
    assert.equal(
      buildSessionStartCommand('C:\\Users\\me\\bin\\session-start'),
      'bash "C:/Users/me/bin/session-start"',
    );
    // 路径含空格：整体被双引号包裹，不被截断。
    assert.equal(
      buildSessionStartCommand('C:\\Users\\me\\my project\\bin\\session-start'),
      'bash "C:/Users/me/my project/bin/session-start"',
    );
    // POSIX 路径输入保持不变（归一化为 no-op）。
    assert.equal(
      buildSessionStartCommand('/home/me/.cursor/spec-superflow/hooks/session-start'),
      'bash "/home/me/.cursor/spec-superflow/hooks/session-start"',
    );
  });
});

describe('W1/1.2 ZCode SessionStart hook 命令路径归一化', () => {
  it('Windows 风格路径转为正斜杠并以双引号包裹', async () => {
    const { buildSessionStartCommand } = await import('../../scripts/install-zcode.mjs');
    assert.equal(
      buildSessionStartCommand('C:\\Users\\me\\bin\\session-start'),
      'bash "C:/Users/me/bin/session-start"',
    );
    assert.equal(
      buildSessionStartCommand('C:\\Users\\me\\my project\\bin\\session-start'),
      'bash "C:/Users/me/my project/bin/session-start"',
    );
    assert.equal(
      buildSessionStartCommand('/home/me/.zcode/spec-superflow/hooks/session-start'),
      'bash "/home/me/.zcode/spec-superflow/hooks/session-start"',
    );
  });
});
