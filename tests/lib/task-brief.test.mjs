import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const TASK_BRIEF = join(ROOT, 'scripts', 'task-brief');
const tempDirs = [];

// scripts/task-brief 是 bash 脚本；本地 Windows 环境若无 bash 则跳过，
// CI windows-latest runner 自带 Git Bash 不受影响。
const hasBash = !spawnSync('bash', ['--version'], { stdio: 'ignore' }).error;
const skipNoBash = hasBash ? false : 'bash not available on this machine';

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('task-brief', () => {
  it('continues to extract a legacy Task heading', { skip: skipNoBash }, () => {
    const directory = mkdtempSync(join(tmpdir(), 'ssf-task-brief-'));
    tempDirs.push(directory);
    const tasksPath = join(directory, 'tasks.md');
    const outputPath = join(directory, 'task-1.1-brief.md');
    writeFileSync(tasksPath, [
      '## Task 1.1: Legacy task',
      '',
      'Keep this task detail.',
      '',
      '## Task 1.2: Another task',
      '',
      'Do not include this detail.',
      '',
    ].join('\n'));

    execFileSync('bash', [TASK_BRIEF, tasksPath, '1.1', outputPath], { encoding: 'utf8' });

    const brief = readFileSync(outputPath, 'utf8');
    assert.match(brief, /Legacy task/);
    assert.doesNotMatch(brief, /Another task/);
  });

  it('extracts one checkbox task from the current tasks template', { skip: skipNoBash }, () => {
    const directory = mkdtempSync(join(tmpdir(), 'ssf-task-brief-'));
    tempDirs.push(directory);
    const tasksPath = join(directory, 'tasks.md');
    const outputPath = join(directory, 'task-1.1-brief.md');
    writeFileSync(tasksPath, [
      '# 实现任务',
      '',
      '## 任务',
      '',
      '- [ ] **1.1 建立种子副本夹具**：修改 `tests/helpers/git-fixture.mjs`；证明：`node --test tests/lib/task-brief.test.mjs`。',
      '- [ ] **1.2 迁移重型测试**：修改 `tests/lib/cmd-execution.test.mjs`；证明：`npm test`。',
      '',
      '## 实施备注',
      '',
      '- 保留隔离边界。',
      '',
    ].join('\n'));

    execFileSync('bash', [TASK_BRIEF, tasksPath, '1.1', outputPath], { encoding: 'utf8' });

    const brief = readFileSync(outputPath, 'utf8');
    assert.match(brief, /建立种子副本夹具/);
    assert.doesNotMatch(brief, /迁移重型测试/);
  });
});
