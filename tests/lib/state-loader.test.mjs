// tests/lib/state-loader.test.mjs
// Tests for scripts/lib/state-loader.mjs
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, renameSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawn, execSync } from 'node:child_process';

let tempDir;

describe('state-loader: readState()', () => {
  let stateLoader;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-state-test-'));
    const modulePath = join(process.cwd(), 'scripts/lib/state-loader.mjs');
    // Windows-safe dynamic import: bare Windows paths (D:\...) are not valid
    // ESM import specifiers, so convert to a file:// URL.
    stateLoader = await import(pathToFileURL(modulePath).href);
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns defaults when no state file exists', () => {
    const state = stateLoader.readState(tempDir);
    assert.equal(state.state, 'exploring');
    assert.equal(state.workflow, 'auto');
    assert.equal(state.batches_completed, 0);
    assert.equal(state.execution_mode, null);
    assert.equal(state.execution_plan_hash, null);
    assert.equal(state.execution_plan_revision, null);
  });

  it('infers change_name from directory when no state file', () => {
    const changeDir = join(tempDir, 'my-feature');
    const state = stateLoader.readState(changeDir);
    assert.equal(state.change_name, 'my-feature');
  });

  it('parses existing state file correctly', () => {
    const stateYaml = [
      'state: executing',
      'workflow: full',
      'artifacts_hash: sha256:abc123',
      'batches_completed: 3',
      'test_result: pass',
      'change_name: export-csv',
      'dp_0_confirmed: true',
      'dp_1_result: confirmed: add csv export',
    ].join('\n');

    writeFileSync(join(tempDir, '.spec-superflow.yaml'), stateYaml);

    const state = stateLoader.readState(tempDir);

    assert.equal(state.state, 'executing');
    assert.equal(state.workflow, 'full');
    assert.equal(state.artifacts_hash, 'sha256:abc123');
    assert.equal(state.batches_completed, 3);
    assert.equal(state.test_result, 'pass');
    assert.equal(state.change_name, 'export-csv');
    // 布尔按 YAML 标量语义回读为布尔（修复前错误地为字符串 'true'）
    assert.equal(state.dp_0_confirmed, true);
    assert.equal(state.dp_1_result, 'confirmed: add csv export');
  });

  it('handles null values in YAML', () => {
    const stateYaml = [
      'state: exploring',
      'artifacts_hash: null',
      'contract_hash: null',
      'dp_0_timestamp: null',
    ].join('\n');

    writeFileSync(join(tempDir, '.spec-superflow.yaml'), stateYaml);

    const state = stateLoader.readState(tempDir);

    assert.equal(state.artifacts_hash, null);
    assert.equal(state.contract_hash, null);
    assert.equal(state.dp_0_timestamp, null);
  });

  it('ignores comments and empty lines in YAML', () => {
    const stateYaml = [
      '# This is a comment',
      '',
      'state: specifying',
      '  ',
      '# Another comment',
      'workflow: tweak',
    ].join('\n');

    writeFileSync(join(tempDir, '.spec-superflow.yaml'), stateYaml);

    const state = stateLoader.readState(tempDir);

    assert.equal(state.state, 'specifying');
    assert.equal(state.workflow, 'tweak');
  });

  it('merges partial state file with defaults', () => {
    const stateYaml = 'state: approved-for-build\nworkflow: hotfix';

    writeFileSync(join(tempDir, '.spec-superflow.yaml'), stateYaml);

    const state = stateLoader.readState(tempDir);
    assert.equal(state.state, 'approved-for-build');
    assert.equal(state.workflow, 'hotfix');
    // Unspecified fields should use defaults
    assert.equal(state.batches_completed, 0);
    assert.equal(state.test_result, null);
  });
});

describe('state-loader: writeState()', () => {
  let stateLoader;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-state-write-'));
    const modulePath = join(process.cwd(), 'scripts/lib/state-loader.mjs');
    // Windows-safe dynamic import: bare Windows paths (D:\...) are not valid
    // ESM import specifiers, so convert to a file:// URL.
    stateLoader = await import(pathToFileURL(modulePath).href);
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes state file with correct structure', () => {
    const state = {
      state: 'executing',
      workflow: 'full',
      artifacts_hash: 'sha256:def456',
      contract_hash: null,
      batches_completed: 2,
      test_result: null,
      change_name: 'test-change',
      dp_0_confirmed: 'true',
    };

    stateLoader.writeState(tempDir, state);

    const filePath = join(tempDir, '.spec-superflow.yaml');
    assert.ok(existsSync(filePath));

    const content = readFileSync(filePath, 'utf-8');
    assert.ok(content.includes('state: executing'));
    assert.ok(content.includes('workflow: full'));
    assert.ok(content.includes('artifacts_hash: sha256:def456'));
    assert.ok(content.includes('contract_hash: null'));
    assert.ok(content.includes('batches_completed: 2'));
    assert.ok(content.includes('execution_plan_hash: null'));
    assert.ok(content.includes('execution_plan_revision: null'));
    assert.ok(content.includes('change_name: test-change'));
    assert.ok(content.includes('dp_0_confirmed: true'));
  });

  it('writes all DP fields (0-7)', () => {
    const state = {
      state: 'closing',
      dp_0_decisions: 'scope: csv export only, tech: nestjs',
      dp_0_result: 'confirmed: scope ok',
      dp_0_confirmed: 'true',
      dp_0_timestamp: '2026-07-01T08:00:00Z',
      dp_1_result: 'confirmed: csv export',
      dp_2_result: 'approved: artifacts ok',
      dp_3_result: 'contract signed',
      dp_4_result: 'execution started',
      dp_5_result: null,
      dp_6_result: null,
      dp_7_result: null,
    };

    stateLoader.writeState(tempDir, state);

    const content = readFileSync(join(tempDir, '.spec-superflow.yaml'), 'utf-8');
    assert.ok(content.includes('dp_0_decisions: scope: csv export only, tech: nestjs'));
    assert.ok(content.includes('dp_0_result: confirmed: scope ok'));
    assert.ok(content.includes('dp_0_confirmed: true'));
    assert.ok(content.includes('dp_1_result: confirmed: csv export'));
    assert.ok(content.includes('dp_5_result: null'));
  });

  it('round-trips dp_0_result when updated through state loader', () => {
    stateLoader.writeState(tempDir, {
      state: 'exploring',
      dp_0_decisions: 'scope confirmed',
      dp_0_confirmed: 'true',
    });

    stateLoader.updateField(tempDir, 'dp_0_result', 'confirmed: manual');

    const content = readFileSync(join(tempDir, '.spec-superflow.yaml'), 'utf-8');
    const state = stateLoader.readState(tempDir);

    assert.ok(content.includes('dp_0_result: confirmed: manual'));
    assert.equal(state.dp_0_result, 'confirmed: manual');
  });

  it('round-trips state through write then read', () => {
    const original = {
      state: 'bridging',
      workflow: 'hotfix',
      artifacts_hash: 'sha256:xyz789',
      batches_completed: 0,
      dp_1_result: 'confirmed: refactor auth',
      dp_1_timestamp: '2026-07-01T10:00:00Z',
    };

    stateLoader.writeState(tempDir, original);
    const read = stateLoader.readState(tempDir);

    assert.equal(read.state, original.state);
    assert.equal(read.workflow, original.workflow);
    assert.equal(read.artifacts_hash, original.artifacts_hash);
    assert.equal(read.batches_completed, original.batches_completed);
    assert.equal(read.dp_1_result, original.dp_1_result);
    assert.equal(read.dp_1_timestamp, original.dp_1_timestamp);
  });
});

describe('state-loader: rebuildState()', () => {
  let stateLoader;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-state-rebuild-'));
    const modulePath = join(process.cwd(), 'scripts/lib/state-loader.mjs');
    stateLoader = await import(pathToFileURL(modulePath).href);
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('clears execution_plan_hash when artifacts hash changes', async () => {
    const changeDir = join(tempDir, 'rebuild-hash-change');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(changeDir, { recursive: true });
    mkdirSync(join(changeDir, 'specs'), { recursive: true });

    // Create initial artifacts
    writeFileSync(join(changeDir, 'proposal.md'), '## Why\nInitial context for rebuild.\n## What Changes\n- Initial.\n');
    writeFileSync(join(changeDir, 'design.md'), '# Design\n');
    writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Task\n');
    writeFileSync(join(changeDir, 'execution-contract.md'), '# Contract\n');

    const { computeArtifactsHash, computeContractHash } = await import(pathToFileURL(join(process.cwd(), 'scripts/lib/hash.mjs')).href);

    // Set up state with execution_plan_hash
    const initialState = {
      state: 'executing',
      revision: 1,
      artifacts_hash: 'sha256:old_hash',
      contract_hash: 'sha256:old_contract',
      execution_plan_hash: 'sha256:plan_hash',
      execution_plan_revision: 1,
    };
    stateLoader.writeState(changeDir, initialState);

    // Rebuild state
    const rebuilt = stateLoader.rebuildState(changeDir, { computeArtifactsHash, computeContractHash });

    // artifacts_hash should be updated
    assert.notEqual(rebuilt.artifacts_hash, 'sha256:old_hash');
    // plan summary fields should be cleared because artifacts changed
    assert.equal(rebuilt.revision, null);
    assert.equal(rebuilt.execution_plan_hash, null);
    assert.equal(rebuilt.execution_plan_revision, null);
  });

  it('preserves execution_plan_hash when artifacts hash is unchanged', async () => {
    const changeDir = join(tempDir, 'rebuild-hash-same');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(changeDir, { recursive: true });
    mkdirSync(join(changeDir, 'specs'), { recursive: true });

    writeFileSync(join(changeDir, 'proposal.md'), '## Why\nContext for same hash.\n## What Changes\n- Same.\n');
    writeFileSync(join(changeDir, 'design.md'), '# Design\n');
    writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Task\n');
    writeFileSync(join(changeDir, 'execution-contract.md'), '# Contract\n');

    const { computeArtifactsHash, computeContractHash } = await import(pathToFileURL(join(process.cwd(), 'scripts/lib/hash.mjs')).href);
    const currentArtifactsHash = computeArtifactsHash(changeDir);

    // Set up state with matching artifacts hash
    const initialState = {
      state: 'executing',
      revision: 1,
      artifacts_hash: currentArtifactsHash,
      contract_hash: 'sha256:contract',
      execution_plan_hash: 'sha256:plan_hash',
      execution_plan_revision: 1,
    };
    stateLoader.writeState(changeDir, initialState);

    // Rebuild state
    const rebuilt = stateLoader.rebuildState(changeDir, { computeArtifactsHash, computeContractHash });

    // plan summary fields should be preserved
    assert.equal(rebuilt.revision, 1);
    assert.equal(rebuilt.execution_plan_hash, 'sha256:plan_hash');
    assert.equal(rebuilt.execution_plan_revision, 1);
  });
});

describe('state-loader: updateField()', () => {
  let stateLoader;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-state-update-'));
    const modulePath = join(process.cwd(), 'scripts/lib/state-loader.mjs');
    // Windows-safe dynamic import: bare Windows paths (D:\...) are not valid
    // ESM import specifiers, so convert to a file:// URL.
    stateLoader = await import(pathToFileURL(modulePath).href);
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('updates a single field without affecting others', () => {
    // Initialize with some state
    stateLoader.writeState(tempDir, {
      state: 'exploring',
      workflow: 'full',
      batches_completed: 0,
    });

    stateLoader.updateField(tempDir, 'state', 'specifying');
    stateLoader.updateField(tempDir, 'batches_completed', 3);

    const state = stateLoader.readState(tempDir);
    assert.equal(state.state, 'specifying');
    assert.equal(state.batches_completed, 3);
    // workflow should still be 'full'
    assert.equal(state.workflow, 'full');
  });
});

describe('state-loader: DP _decisions/_confirmed 白名单字段持久化', () => {
  let stateLoader;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-state-dp-'));
    const modulePath = join(process.cwd(), 'scripts/lib/state-loader.mjs');
    stateLoader = await import(pathToFileURL(modulePath).href);
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('writeState/readState 完整回读 dp_1/2/3/6/7 的 decisions 与 confirmed', () => {
    const dir = join(tempDir, 'dp-roundtrip');
    mkdirSync(dir, { recursive: true });
    const written = {
      dp_1_decisions: 'scope: keep csv only', dp_1_confirmed: true,
      dp_2_decisions: 'artifacts: spec reviewed', dp_2_confirmed: false,
      dp_3_decisions: 'contract: clauses confirmed', dp_3_confirmed: true,
      dp_6_decisions: 'verify: bounded checks', dp_6_confirmed: true,
      dp_7_decisions: 'close: receipt archived', dp_7_confirmed: false,
    };

    stateLoader.writeState(dir, { state: 'specifying', ...written });
    const read = stateLoader.readState(dir);

    for (const [field, value] of Object.entries(written)) {
      assert.equal(read[field], value, `${field} 回读值不一致`);
      assert.equal(typeof read[field], typeof value, `${field} 回读类型不一致`);
    }
  });

  it('updateField 逐字段写入后可回读，布尔保持布尔形态', () => {
    const dir = join(tempDir, 'dp-update');
    mkdirSync(dir, { recursive: true });
    stateLoader.writeState(dir, { state: 'exploring' });

    stateLoader.updateField(dir, 'dp_1_decisions', 'via updateField');
    stateLoader.updateField(dir, 'dp_1_confirmed', true);
    stateLoader.updateField(dir, 'dp_2_confirmed', false);

    const read = stateLoader.readState(dir);
    assert.equal(read.dp_1_decisions, 'via updateField');
    assert.equal(read.dp_1_confirmed, true);
    assert.equal(typeof read.dp_1_confirmed, 'boolean');
    assert.equal(read.dp_2_confirmed, false);
    assert.equal(typeof read.dp_2_confirmed, 'boolean');
  });
});

describe('state-loader: 原子写入（atomic-state）', () => {
  let stateLoader;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-state-atomic-'));
    const modulePath = join(process.cwd(), 'scripts/lib/state-loader.mjs');
    // Windows-safe dynamic import: bare Windows paths (D:\...) are not valid
    // ESM import specifiers, so convert to a file:// URL.
    stateLoader = await import(pathToFileURL(modulePath).href);
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // 轮询等待外部占用锁生效/释放，避免固定 sleep 造成抖动
  async function waitFor(predicate, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
      try {
        if (predicate()) return;
      } catch (error) {
        lastError = error;
      }
      await sleep(40);
    }
    throw new Error(`等待${label}超时${lastError ? `：${lastError.code || lastError.message}` : ''}`);
  }

  it('rename 失败时 updateField 抛错且目标文件保持旧内容', { skip: process.platform !== 'win32' && '占用锁注入仅支持 Windows（FileShare 不含 Delete）' }, async () => {
    const dir = join(tempDir, 'rename-fail');
    mkdirSync(dir, { recursive: true });
    stateLoader.writeState(dir, { state: 'exploring', change_name: 'keep-old' });
    const filePath = join(dir, '.spec-superflow.yaml');
    const oldBytes = readFileSync(filePath);

    // 外部进程以「共享读写、不共享删除」方式占用目标文件：rename 需要 DELETE 访问会被拒（EPERM），
    // 而旧实现的直接 writeFileSync 因共享读写反而能成功——以此区分原子写与旧的直写覆盖。
    const script = `$fs=[System.IO.File]::Open('${filePath}',[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::ReadWrite); Start-Sleep -Seconds 30; $fs.Close()`;
    const locker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'ignore',
    });

    try {
      // 等待占用句柄生效：探测 rename 失败即锁已生效；探测期间若意外 rename 成功则恢复旧内容
      await waitFor(() => {
        const probe = join(dir, 'probe.tmp');
        writeFileSync(probe, 'probe');
        try {
          renameSync(probe, filePath);
          writeFileSync(filePath, oldBytes); // 锁未生效，恢复夹具继续等待
          return false;
        } catch {
          return true;
        }
      }, 10000, '占用锁生效');
      assert.equal(locker.exitCode, null, '持锁进程不应提前退出');

      // rename 失败错误必须经 writeState/updateField 上抛，不能静默成功
      assert.throws(
        () => stateLoader.updateField(dir, 'state', 'executing'),
        /EPERM|EACCES|EBUSY|permission|busy/i,
      );
    } finally {
      locker.kill();
    }

    // 等待句柄释放后读回：目标文件必须逐字节保持上一完整版本
    await waitFor(() => {
      const fd = openSync(filePath, 'r+');
      closeSync(fd);
      return true;
    }, 10000, '占用锁释放');

    const keptBytes = readFileSync(filePath);
    assert.ok(Buffer.compare(keptBytes, oldBytes) === 0, 'rename 失败后目标文件必须保持旧版内容');
    assert.equal(stateLoader.readState(dir).state, 'exploring');
  });

  it('正常写入文本与修复前逐字节一致（字段/顺序/单个结尾换行）', async () => {
    // 取修复前 main（bdd80c9，359a9b4 修复之前）的 state-loader 源码作为对照实现；
    // 不能用 HEAD：修复后版本依赖 plan-shared.mjs，拷到临时目录 import 会 ERR_MODULE_NOT_FOUND
    const oldSource = execSync('git show bdd80c9:scripts/lib/state-loader.mjs', { encoding: 'utf8' });
    const oldModuleFile = join(tempDir, 'old-state-loader.mjs');
    writeFileSync(oldModuleFile, oldSource);
    const oldLoader = await import(pathToFileURL(oldModuleFile).href);

    // 覆盖全部字段、多类型值与非 ASCII 文本，验证字段/顺序/UTF-8 编码不变
    const state = {
      state: 'executing',
      workflow: 'full',
      revision: 2,
      artifacts_hash: 'sha256:abcdef',
      contract_hash: 'sha256:012345',
      execution_mode: 'inline',
      execution_plan_hash: 'sha256:plan',
      execution_plan_revision: 1,
      batches_completed: 3,
      test_result: 'pass',
      spec_merged: false,
      spec_publication_receipt: null,
      change_name: '字节一致-变更',
      last_transition: '2026-09-24T00:00:00Z',
      last_transition_from: 'exploring',
      last_transition_to: 'specifying',
      dp_0_decisions: '范围：仅导出 CSV；技术：nestjs',
      dp_0_result: 'confirmed: scope 范围',
      dp_0_confirmed: true,
      dp_0_timestamp: '2026-09-24T01:00:00Z',
      dp_1_decisions: 'artifacts: spec reviewed',
      dp_1_result: 'confirmed: tech',
      dp_1_confirmed: false,
      dp_1_timestamp: '2026-09-24T02:00:00Z',
    };
    for (let i = 2; i <= 7; i++) {
      state[`dp_${i}_decisions`] = `dp${i} 决策内容`;
      state[`dp_${i}_result`] = `confirmed: dp${i}`;
      state[`dp_${i}_confirmed`] = i % 2 === 0;
      state[`dp_${i}_timestamp`] = `2026-09-24T0${i}:00:00Z`;
    }

    const oldDir = join(tempDir, 'old-out');
    const newDir = join(tempDir, 'new-out');
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(newDir, { recursive: true });
    oldLoader.writeState(oldDir, state);
    stateLoader.writeState(newDir, state);

    const oldBytes = readFileSync(join(oldDir, '.spec-superflow.yaml'));
    const newBytes = readFileSync(join(newDir, '.spec-superflow.yaml'));
    assert.ok(Buffer.compare(oldBytes, newBytes) === 0, '原子写输出必须与修复前逐字节一致');
    // 文件必须以单个换行结尾
    assert.equal(newBytes[newBytes.length - 1], 0x0a, '文件必须以换行结尾');
    assert.notEqual(newBytes[newBytes.length - 2], 0x0a, '结尾只允许一个换行');
  });
});
