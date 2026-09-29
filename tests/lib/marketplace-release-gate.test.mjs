import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8').replace(/\r\n/g, '\n');

// 原 marketplace release gate 已随「npm 发布改走阿里云私有云本地发布」移除，
// release job 收敛为 Release-only：tag 上验证构建/测试并创建 GitHub Release。
describe('release-only job contract', () => {
  it('tag 触发的 release job 仅做验证与 GitHub Release，不在 CI 发布 npm', () => {
    const releaseJob = workflow.indexOf('\n  release:\n');
    const githubRelease = workflow.indexOf('name: Create GitHub Release');

    assert.ok(releaseJob >= 0, 'workflow must define a release job');
    assert.match(workflow.slice(releaseJob), /if: startsWith\(github\.ref, 'refs\/tags\/v'\)/);
    assert.ok(githubRelease > releaseJob, 'release job must create a GitHub Release');

    // CI 不再承担 npm 发布与 marketplace 远程校验
    assert.equal(workflow.indexOf('name: Verify marketplace release gate'), -1);
    assert.equal(workflow.indexOf('name: Publish to npm'), -1);
    assert.doesNotMatch(workflow, /npm publish/);
    assert.doesNotMatch(workflow, /id-token: write/);
  });
});
