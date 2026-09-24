// scripts/lib/state-loader.mjs — lightweight .spec-superflow.yaml state file reader/writer
import fs from 'node:fs';
import path from 'node:path';
// 复用 plan-shared 的原子写（同目录 temp + rename），避免崩溃留下半截状态文件
import { atomicWrite } from './plan-shared.mjs';

const STATE_FILE = '.spec-superflow.yaml';

const BUILTIN_DEFAULTS = {
  state: 'exploring',
  workflow: 'auto',
  revision: null,
  artifacts_hash: null,
  contract_hash: null,
  execution_mode: null,
  execution_plan_hash: null,
  execution_plan_revision: null,
  batches_completed: 0,
  test_result: null,
  spec_merged: false,
  spec_publication_receipt: null,
  change_name: null,
  last_transition: null,
  last_transition_from: null,
  last_transition_to: null,
  dp_0_decisions: null,
  dp_0_result: null,
  dp_0_confirmed: null,
  dp_0_timestamp: null,
  dp_1_decisions: null,
  dp_1_result: null,
  dp_1_confirmed: null,
  dp_1_timestamp: null,
  dp_2_decisions: null,
  dp_2_result: null,
  dp_2_confirmed: null,
  dp_2_timestamp: null,
  dp_3_decisions: null,
  dp_3_result: null,
  dp_3_confirmed: null,
  dp_3_timestamp: null,
  dp_4_result: null,
  dp_4_timestamp: null,
  dp_5_result: null,
  dp_5_timestamp: null,
  dp_5_decisions: null,
  dp_5_confirmed: null,
  dp_6_decisions: null,
  dp_6_result: null,
  dp_6_confirmed: null,
  dp_6_timestamp: null,
  dp_7_decisions: null,
  dp_7_result: null,
  dp_7_confirmed: null,
  dp_7_timestamp: null,
};

/**
 * Read state file, merging with built-in defaults.
 * Returns a complete state object even if the file doesn't exist.
 */
export function readState(changeDir) {
  const filePath = path.join(changeDir, STATE_FILE);
  if (!fs.existsSync(filePath)) {
    return { ...BUILTIN_DEFAULTS, change_name: path.basename(changeDir) };
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = parseYaml(raw);
  return { ...BUILTIN_DEFAULTS, ...parsed };
}

/**
 * Write state object to .spec-superflow.yaml.
 */
export function writeState(changeDir, state) {
  const filePath = path.join(changeDir, STATE_FILE);
  const lines = [];
  lines.push('# .spec-superflow.yaml — lightweight state machine');
  lines.push('# Derived data. Always rebuildable from artifacts. Lost/corrupt → fall back to content-level detection.');
  lines.push('');
  lines.push('# === Core state ===');
  lines.push(`state: ${state.state || 'exploring'}`);
  lines.push(`workflow: ${state.workflow || 'auto'}`);
  lines.push(`revision: ${state.revision ?? 'null'}`);
  lines.push('');
  lines.push('# === Hashes (fast staleness detection) ===');
  lines.push(`artifacts_hash: ${state.artifacts_hash ?? 'null'}`);
  lines.push(`contract_hash: ${state.contract_hash ?? 'null'}`);
  lines.push('');
  lines.push('# === Execution progress ===');
  lines.push(`execution_mode: ${state.execution_mode ?? 'null'}`);
  lines.push(`execution_plan_hash: ${state.execution_plan_hash ?? 'null'}`);
  lines.push(`execution_plan_revision: ${state.execution_plan_revision ?? 'null'}`);
  lines.push(`batches_completed: ${state.batches_completed ?? 0}`);
  lines.push(`test_result: ${state.test_result ?? 'null'}`);
  lines.push(`spec_merged: ${state.spec_merged ?? false}`);
  lines.push(`spec_publication_receipt: ${state.spec_publication_receipt ?? 'null'}`);
  lines.push('');
  lines.push('# === Metadata ===');
  lines.push(`change_name: ${state.change_name ?? path.basename(changeDir)}`);
  lines.push(`last_transition: ${state.last_transition ?? 'null'}`);
  lines.push(`last_transition_from: ${state.last_transition_from ?? 'null'}`);
  lines.push(`last_transition_to: ${state.last_transition_to ?? 'null'}`);
  lines.push('');
  lines.push('# === Decision points ===');
  lines.push(`dp_0_decisions: ${state.dp_0_decisions ?? 'null'}`);
  lines.push(`dp_0_result: ${state.dp_0_result ?? 'null'}`);
  lines.push(`dp_0_confirmed: ${state.dp_0_confirmed ?? 'null'}`);
  lines.push(`dp_0_timestamp: ${state.dp_0_timestamp ?? 'null'}`);
  lines.push(`dp_1_decisions: ${state.dp_1_decisions ?? 'null'}`);
  lines.push(`dp_1_result: ${state.dp_1_result ?? 'null'}`);
  lines.push(`dp_1_confirmed: ${state.dp_1_confirmed ?? 'null'}`);
  lines.push(`dp_1_timestamp: ${state.dp_1_timestamp ?? 'null'}`);
  lines.push(`dp_2_decisions: ${state.dp_2_decisions ?? 'null'}`);
  lines.push(`dp_2_result: ${state.dp_2_result ?? 'null'}`);
  lines.push(`dp_2_confirmed: ${state.dp_2_confirmed ?? 'null'}`);
  lines.push(`dp_2_timestamp: ${state.dp_2_timestamp ?? 'null'}`);
  lines.push(`dp_3_decisions: ${state.dp_3_decisions ?? 'null'}`);
  lines.push(`dp_3_result: ${state.dp_3_result ?? 'null'}`);
  lines.push(`dp_3_confirmed: ${state.dp_3_confirmed ?? 'null'}`);
  lines.push(`dp_3_timestamp: ${state.dp_3_timestamp ?? 'null'}`);
  lines.push(`dp_4_result: ${state.dp_4_result ?? 'null'}`);
  lines.push(`dp_4_timestamp: ${state.dp_4_timestamp ?? 'null'}`);
  lines.push(`dp_5_result: ${state.dp_5_result ?? 'null'}`);
  lines.push(`dp_5_timestamp: ${state.dp_5_timestamp ?? 'null'}`);
  lines.push(`dp_5_decisions: ${state.dp_5_decisions ?? 'null'}`);
  lines.push(`dp_5_confirmed: ${state.dp_5_confirmed ?? 'null'}`);
  lines.push(`dp_6_decisions: ${state.dp_6_decisions ?? 'null'}`);
  lines.push(`dp_6_result: ${state.dp_6_result ?? 'null'}`);
  lines.push(`dp_6_confirmed: ${state.dp_6_confirmed ?? 'null'}`);
  lines.push(`dp_6_timestamp: ${state.dp_6_timestamp ?? 'null'}`);
  lines.push(`dp_7_decisions: ${state.dp_7_decisions ?? 'null'}`);
  lines.push(`dp_7_result: ${state.dp_7_result ?? 'null'}`);
  lines.push(`dp_7_confirmed: ${state.dp_7_confirmed ?? 'null'}`);
  lines.push(`dp_7_timestamp: ${state.dp_7_timestamp ?? 'null'}`);

  // 原子落盘：temp + rename，崩溃或 rename 失败时目标文件保持上一完整版本；
  // rename 失败错误直接向上抛出（atomicWrite 内部不吞错，writeState/updateField 亦不捕获）
  atomicWrite(filePath, lines.join('\n') + '\n');
}

/**
 * Update a single field in the state file.
 */
export function updateField(changeDir, field, value) {
  const state = readState(changeDir);
  state[field] = value;
  writeState(changeDir, state);
}

/**
 * Rebuild state file from artifacts — recomputes hashes.
 * Requires hash functions to be passed in (avoids circular dependency).
 */
export function rebuildState(changeDir, { computeArtifactsHash, computeContractHash }) {
  const state = readState(changeDir);
  const oldArtifactsHash = state.artifacts_hash;
  state.artifacts_hash = computeArtifactsHash(changeDir);
  state.contract_hash = computeContractHash(changeDir);

  // artifacts hash 变化时，清空依赖旧 hash 的 plan 字段
  if (oldArtifactsHash !== state.artifacts_hash) {
    state.revision = null;
    state.execution_plan_hash = null;
    state.execution_plan_revision = null;
  }

  writeState(changeDir, state);
  return state;
}

// Minimal YAML parser — top-level fields only, zero dependencies.
// Handles strings, null, booleans, integers. No nested structures needed.
function parseYaml(content) {
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(\w[\w_]*):\s*(.*)/);
    if (match) {
      const val = match[2].trim();
      if (val === 'null' || val === '') {
        result[match[1]] = null;
      } else if (val === 'true' || val === 'false') {
        // 布尔按 YAML 标量语义解析，保证 _confirmed 字段以布尔形态回读
        result[match[1]] = val === 'true';
      } else if (/^\d+$/.test(val)) {
        result[match[1]] = parseInt(val, 10);
      } else {
        result[match[1]] = val;
      }
    }
  }
  return result;
}
