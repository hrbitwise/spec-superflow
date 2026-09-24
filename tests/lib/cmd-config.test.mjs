import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'scripts/spec-superflow.mjs');
let tempDir;

before(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'ssf-cmd-config-test-'));
});

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeConfig(config) {
  writeFileSync(join(tempDir, 'spec-superflow.config.json'), JSON.stringify(config));
}

function runSsf(args) {
  try {
    return {
      exitCode: 0,
      stdout: execFileSync(process.execPath, [CLI, ...args], {
        cwd: tempDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      }), stderr: '',
    };
  } catch (error) {
    return {
      exitCode: error.status ?? 1,
      stdout: error.stdout?.toString() ?? '',
      stderr: error.stderr?.toString() ?? error.message,
    };
  }
}

describe('ssf config --resolve-model', () => {
  it('documents model profile resolution in CLI help', () => {
    const result = runSsf(['--help']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /config --resolve-model <profile>/);
    assert.match(result.stdout, /without switching models/);
  });

  it('prints configured standard model profile JSON through the dispatcher', () => {
    writeConfig({ models: { standard: 'vendor-standard', strong: 'vendor-strong' } });
    const result = runSsf(['config', '--resolve-model', 'standard']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepStrictEqual(JSON.parse(result.stdout), {
      profile: 'standard', model: 'vendor-standard', configured: true,
    });
  });

  it('prints configured strong model profile JSON through the dispatcher', () => {
    writeConfig({ models: { standard: 'vendor-standard', strong: 'vendor-strong' } });
    const result = runSsf(['config', '--resolve-model', 'strong']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepStrictEqual(JSON.parse(result.stdout), {
      profile: 'strong', model: 'vendor-strong', configured: true,
    });
  });

  it('prints a valid unmapped result', () => {
    writeConfig({ models: {} });
    const unmapped = runSsf(['config', '--resolve-model', 'review']);
    assert.equal(unmapped.exitCode, 0, unmapped.stderr);
    assert.deepStrictEqual(JSON.parse(unmapped.stdout), {
      profile: 'review', model: null, configured: false,
    });
  });

  it('rejects an unknown profile with supported names in stderr', () => {
    const unknown = runSsf(['config', '--resolve-model', 'fast']);
    assert.equal(unknown.exitCode, 1);
    assert.match(unknown.stderr,
      /Unknown model profile 'fast'.*mechanical.*standard.*strong.*review/);
  });

  it('rejects a blank mapped profile with an actionable config path in stderr', () => {
    writeConfig({ models: { review: '' } });
    const blank = runSsf(['config', '--resolve-model', 'review']);
    assert.equal(blank.exitCode, 1);
    assert.match(blank.stderr, /models\.review must be a non-empty string/);
  });

  it('rejects a non-string mapped profile with an actionable config path in stderr', () => {
    writeConfig({ models: { strong: 42 } });
    const nonString = runSsf(['config', '--resolve-model', 'strong']);
    assert.equal(nonString.exitCode, 1);
    assert.match(nonString.stderr, /models\.strong must be a non-empty string/);
  });

  it('rejects a missing profile argument and preserves normal config lookup', () => {
    assert.equal(runSsf(['config', '--resolve-model']).exitCode, 2);
    writeConfig({ models: {} });
    assert.equal(runSsf(['config', '--get', 'execution.inlineThreshold']).stdout.trim(), '3');
  });
});

describe('ssf config --set 原型污染防护', () => {
  // 在独立 cwd 下运行 config，便于断言配置文件未被创建
  function runConfig(cwd, args) {
    try {
      const stdout = execFileSync(process.execPath, [CLI, 'config', ...args],
        { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      return { exitCode: 0, stdout, stderr: '' };
    } catch (error) {
      return {
        exitCode: error.status ?? 1,
        stdout: error.stdout?.toString() ?? '',
        stderr: error.stderr?.toString() ?? error.message,
      };
    }
  }

  it('拒绝直接 __proto__ 污染键：退出码 2、stderr 含键名、不写盘', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ssf-config-proto-'));
    try {
      const result = runConfig(cwd, ['--set', '__proto__.polluted=yes']);
      assert.equal(result.exitCode, 2);
      assert.ok(result.stderr.includes('__proto__'));
      assert.equal(existsSync(join(cwd, 'spec-superflow.config.json')), false);
      assert.equal({}.polluted, undefined);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('拒绝嵌套路径中的危险段 a.constructor.prototype.polluted：退出码 2、不写盘', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ssf-config-nested-'));
    try {
      const result = runConfig(cwd, ['--set', 'a.constructor.prototype.polluted=yes']);
      assert.equal(result.exitCode, 2);
      assert.ok(result.stderr.includes('constructor') || result.stderr.includes('prototype'));
      assert.equal(existsSync(join(cwd, 'spec-superflow.config.json')), false);
      assert.equal({}.polluted, undefined);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('正常嵌套键 verification.language=zh 行为不变，正常写盘', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ssf-config-normal-'));
    try {
      const result = runConfig(cwd, ['--set', 'verification.language=zh']);
      assert.equal(result.exitCode, 0, result.stderr);
      const written = JSON.parse(readFileSync(join(cwd, 'spec-superflow.config.json'), 'utf8'));
      assert.equal(written.verification.language, 'zh');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
