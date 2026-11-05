import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8').replace(/\r\n/g, '\n');

describe('release job contract', () => {
  it('is release-only: tag-gated verification plus GitHub Release, no npm publish', () => {
    const releaseJob = workflow.indexOf('\n  release:\n');
    const githubRelease = workflow.indexOf('name: Create GitHub Release');

    assert.ok(releaseJob >= 0, 'workflow must define a release job');
    assert.match(workflow.slice(releaseJob), /if: startsWith\(github\.ref, 'refs\/tags\/v'\)/);
    assert.ok(githubRelease > releaseJob, 'GitHub Release creation must stay in the release job');

    // npm 包以本地发布至阿里云私有 registry 为准，CI 不持有 npm 凭据。
    const releaseSection = workflow.slice(releaseJob);
    assert.doesNotMatch(releaseSection, /name: Publish to npm/, 'CI must not publish to npm');
    assert.doesNotMatch(workflow, /NPM_TOKEN/, 'CI must not consume an NPM_TOKEN secret');
    assert.doesNotMatch(releaseSection, /id-token: write/, 'provenance publishing permission is not needed');
    assert.doesNotMatch(releaseSection, /registry-url: https:\/\/registry\.npmjs\.org/, 'release job must not authenticate against npmjs.org');
  });

  it('keeps the skill ↔ CLI consistency gate inside the release job', () => {
    const releaseJob = workflow.indexOf('\n  release:\n');
    const releaseSection = workflow.slice(releaseJob);
    assert.match(releaseSection, /spec-superflow\.mjs doctor skills/);
  });

  it('documents the Aliyun private registry as the manual publish channel', () => {
    assert.match(workflow.slice(Math.max(0, releaseCommentAnchor(workflow) - 200), releaseCommentAnchor(workflow) + 400),
      /阿里云私有 registry/);
  });

  function releaseCommentAnchor(text) {
    return text.indexOf('Release job：npm 包以本地发布');
  }
});
