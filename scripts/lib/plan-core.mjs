// scripts/lib/plan-core.mjs
// 执行计划的 CRUD 与结构/一致性校验：createPlan/readPlan/writePlan/validatePlan，
// 以及 plan 内容 hash、依赖环检测、state summary 写入。仅依赖 plan-shared。
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeArtifactsHash, computeContractHash } from './hash.mjs';
import { getOverlayPaths } from './sdd-overlay.mjs';
import { readState } from './state-loader.mjs';
import {
  atomicWrite, EXECUTION_MODES, isNonEmptyText, isNullableHash, isObject,
  setStateField, stableJson,
} from './plan-shared.mjs';

const WAVE_STRATEGIES = new Set(['parallel', 'serial']);

/** 创建执行计划：读取状态、计算 artifacts/contract hash、校验结构并返回带 hash 的 plan。 */
export function createPlan(changeDir, input) {
  const state = readState(changeDir);
  const plan = {
    mode: input?.mode,
    source: input?.source,
    rationale: input?.rationale,
    waves: input?.waves,
    artifacts_hash: computeArtifactsHash(changeDir),
    contract_hash: computeContractHash(changeDir),
    workflow: state.workflow,
    revision: input?.revision ?? state.revision ?? 1,
  };
  if (input?.recommendation !== undefined) plan.recommendation = input.recommendation;
  if (input?.recommendationReceipt !== undefined) plan.recommendation_receipt = input.recommendationReceipt;
  if (input?.selection !== undefined) plan.selection = input.selection;
  const failures = validateStructure(plan);
  if (failures.length > 0) throw new Error(`Invalid execution plan: ${failures.join('; ')}`);
  plan.hash = hashPlan(plan);
  return plan;
}

/** 读取执行计划文件；不存在返回 null，解析失败抛错。 */
export function readPlan(changeDir) {
  const filePath = getOverlayPaths(changeDir).executionPlan;
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read execution plan: ${error.message}`);
  }
}

/** 校验并原子写入执行计划（含 hash 一致性校验与 state summary 同步），返回重读后的 plan。 */
export function writePlan(changeDir, plan) {
  const failures = validateStructure(plan);
  const expectedHash = tryHashPlan(plan);
  if (expectedHash === null) failures.push('execution plan content cannot be hashed');
  else if (plan?.hash !== expectedHash) failures.push('execution plan content hash mismatch');
  if (failures.length > 0) throw new Error(`Invalid execution plan: ${failures.join('; ')}`);

  const paths = getOverlayPaths(changeDir);
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(paths.reviews, { recursive: true });
  atomicWrite(paths.executionPlan, `${JSON.stringify(plan, null, 2)}\n`);
  writeExecutionPlanSummary(changeDir, plan);
  return readPlan(changeDir);
}

/** 校验执行计划与 state、artifacts/contract hash、workflow、revision、recommendation 的一致性。 */
export function validatePlan(changeDir, plan) {
  const failures = validateStructure(plan);
  const actualHash = tryHashPlan(plan);
  if (actualHash === null) failures.push('execution plan content cannot be hashed');
  else if (plan?.hash !== actualHash) failures.push('execution plan content hash mismatch');

  const state = readState(changeDir);
  if (state.execution_plan_hash !== plan?.hash) {
    failures.push('execution plan summary does not match state');
  }
  if (state.execution_mode !== plan?.mode) {
    failures.push('execution plan mode does not match state');
  }
  if (plan?.artifacts_hash !== computeArtifactsHash(changeDir)) {
    failures.push('execution plan is stale: artifacts hash mismatch');
  }
  if (plan?.contract_hash !== computeContractHash(changeDir)) {
    failures.push('execution plan is stale: contract hash mismatch');
  }
  if (plan?.workflow !== state.workflow) {
    failures.push('execution plan workflow does not match state');
  }
  if (state.execution_plan_revision !== plan?.revision) {
    failures.push('execution plan revision does not match state');
  }
  if (state.revision != null && plan?.revision !== state.revision) {
    failures.push('execution plan revision does not match state');
  }
  if (plan?.workflow !== 'tweak') {
    if (plan?.recommendation === undefined) failures.push('execution plan recommendation is required for full/hotfix');
    if (plan?.recommendation_receipt === undefined) failures.push('execution plan recommendation receipt is required for full/hotfix');
    if (plan?.selection === undefined) failures.push('execution plan selection is required for full/hotfix');
  }
  if (plan?.recommendation_receipt !== undefined) {
    if (plan.recommendation_receipt.artifacts_hash !== plan.artifacts_hash) failures.push('execution plan recommendation receipt artifacts hash does not match plan');
    if (plan.recommendation_receipt.contract_hash !== plan.contract_hash) failures.push('execution plan recommendation receipt contract hash does not match plan');
    if (plan.recommendation_receipt.workflow !== plan.workflow) failures.push('execution plan recommendation receipt workflow does not match plan');
    if (stableJson(plan.recommendation_receipt.waves) !== stableJson(plan.waves)) failures.push('execution plan recommendation receipt waves do not match plan');
    if (stableJson(plan.recommendation_receipt.recommendation) !== stableJson(plan.recommendation)) failures.push('execution plan recommendation receipt does not match plan recommendation');
    const expectedRecommendationPlanRevision = plan.source === 'user-confirmed-revision'
      ? plan.revision - 1
      : null;
    if (plan.recommendation_receipt.execution_plan_revision_at_recommendation !== expectedRecommendationPlanRevision) {
      failures.push('execution plan recommendation receipt does not match the immediately prior plan revision');
    }
  }
  if (plan?.selection !== undefined && plan?.recommendation?.recommendation?.mode) {
    const followedRecommendation = plan.mode === plan.recommendation.recommendation.mode;
    if (plan.selection.followed_recommendation !== followedRecommendation) failures.push('execution plan selection does not match recommended mode');
    if (plan.selection.acknowledged_non_recommendation !== !followedRecommendation) failures.push('execution plan selection acknowledgement does not match recommended mode');
  }
  return { valid: failures.length === 0, failures, plan };
}

/** 校验 plan 结构：mode/source/rationale、recommendation/selection 形状、waves 唯一性与依赖合法性。 */
function validateStructure(plan) {
  const failures = [];
  if (!isObject(plan)) return ['execution plan must be an object'];
  if (!EXECUTION_MODES.includes(plan.mode)) failures.push('execution plan mode is invalid');
  if (typeof plan.source !== 'string' || !plan.source.trim()) failures.push('execution plan source is required');
  if (!isNonEmptyText(plan.rationale)) failures.push('execution plan rationale is required');
  if (plan.recommendation !== undefined) {
    if (!isObject(plan.recommendation)) {
      failures.push('execution plan recommendation must be an object');
    } else {
      if (!isObject(plan.recommendation.recommendation) || !EXECUTION_MODES.includes(plan.recommendation.recommendation.mode)) {
        failures.push('execution plan recommendation mode is invalid');
      }
      if (!Array.isArray(plan.recommendation.recommendation?.reasons) || plan.recommendation.recommendation.reasons.some(reason => !isNonEmptyText(reason))) {
        failures.push('execution plan recommendation reasons must be non-empty strings');
      }
      if (!isObject(plan.recommendation.facts)) failures.push('execution plan recommendation facts must be an object');
      if (!Array.isArray(plan.recommendation.available_modes) || plan.recommendation.available_modes.some(mode => !EXECUTION_MODES.includes(mode))) {
        failures.push('execution plan recommendation available_modes are invalid');
      }
    }
  }
  if (plan.recommendation_receipt !== undefined) {
    if (!isObject(plan.recommendation_receipt)) {
      failures.push('execution plan recommendation receipt must be an object');
    } else {
      if (!isObject(plan.recommendation_receipt.recommendation)) failures.push('execution plan recommendation receipt payload is required');
      if (!Array.isArray(plan.recommendation_receipt.waves)) failures.push('execution plan recommendation receipt waves must be an array');
      if (!isNullableHash(plan.recommendation_receipt.artifacts_hash)) failures.push('execution plan recommendation receipt artifacts hash is invalid');
      if (!isNullableHash(plan.recommendation_receipt.contract_hash)) failures.push('execution plan recommendation receipt contract hash is invalid');
      if (!isNonEmptyText(plan.recommendation_receipt.workflow)) failures.push('execution plan recommendation receipt workflow is invalid');
      if (plan.recommendation_receipt.execution_plan_revision_at_recommendation !== null
        && (!Number.isInteger(plan.recommendation_receipt.execution_plan_revision_at_recommendation)
          || plan.recommendation_receipt.execution_plan_revision_at_recommendation < 1)) {
        failures.push('execution plan recommendation receipt plan revision is invalid');
      }
      if (!isNonEmptyText(plan.recommendation_receipt.created_at)) failures.push('execution plan recommendation receipt timestamp is invalid');
      if (typeof plan.recommendation_receipt.hash !== 'string' || !plan.recommendation_receipt.hash.startsWith('sha256:')) failures.push('execution plan recommendation receipt hash is invalid');
    }
  }
  if (plan.selection !== undefined) {
    if (!isObject(plan.selection)) {
      failures.push('execution plan selection must be an object');
    } else {
      if (plan.selection.confirmed !== true) failures.push('execution plan selection must be confirmed');
      if (typeof plan.selection.followed_recommendation !== 'boolean') failures.push('execution plan selection must record recommendation alignment');
      if (typeof plan.selection.acknowledged_non_recommendation !== 'boolean') failures.push('execution plan selection must record non-recommendation acknowledgement');
      if (plan.selection.followed_recommendation === plan.selection.acknowledged_non_recommendation) {
        failures.push('execution plan selection acknowledgement conflicts with recommendation alignment');
      }
    }
  }
  if (!Array.isArray(plan.waves)) {
    failures.push('execution plan waves must be an array');
    return failures;
  }

  const ids = new Set();
  const taskOwners = new Map();
  for (const [index, wave] of plan.waves.entries()) {
    const label = `wave ${index + 1}`;
    if (!isObject(wave)) {
      failures.push(`${label} must be an object`);
      continue;
    }
    if (!isNonEmptyText(wave.id)) failures.push(`${label} id is required`);
    else if (ids.has(wave.id)) failures.push(`duplicate wave id '${wave.id}'`);
    else ids.add(wave.id);
    if (!WAVE_STRATEGIES.has(wave.strategy)) failures.push(`${label} strategy is invalid`);
    if (!Array.isArray(wave.tasks) || wave.tasks.length === 0) {
      failures.push(`${label} must include at least one task`);
    } else {
      if (wave.tasks.some(task => !isNonEmptyText(task))) failures.push(`${label} tasks must be non-empty strings`);
      for (const task of wave.tasks.filter(isNonEmptyText)) {
        const priorWaveId = taskOwners.get(task);
        if (priorWaveId !== undefined) {
          failures.push(`duplicate task id '${task}' appears in waves '${priorWaveId}' and '${wave.id}'`);
        } else {
          taskOwners.set(task, wave.id);
        }
      }
      if (wave.strategy === 'parallel' && new Set(wave.tasks).size !== wave.tasks.length) {
        failures.push(`parallel wave '${wave.id}' contains duplicate tasks`);
      }
    }
    if (!Array.isArray(wave.depends_on)) failures.push(`${label} depends_on must be an array`);
    else if (wave.depends_on.some(id => !isNonEmptyText(id))) failures.push(`${label} dependencies must be non-empty strings`);
  }

  for (const wave of plan.waves.filter(isObject)) {
    if (!Array.isArray(wave.depends_on) || !isNonEmptyText(wave.id)) continue;
    for (const dependency of wave.depends_on) {
      if (dependency === wave.id) failures.push(`wave '${wave.id}' cannot depend on itself`);
      else if (isNonEmptyText(dependency) && !ids.has(dependency)) {
        failures.push(`wave '${wave.id}' depends on unknown wave '${dependency}'`);
      }
    }
  }
  const canCheckCycles = plan.waves.every(wave => isObject(wave)
    && isNonEmptyText(wave.id) && Array.isArray(wave.depends_on));
  if (canCheckCycles && !failures.some(failure => /duplicate wave id|unknown wave|cannot depend on itself/.test(failure))
    && hasDependencyCycle(plan.waves)) {
    failures.push('execution plan waves contain a dependency cycle');
  }
  return failures;
}

/** 检测 waves 依赖图中是否存在环（DFS 三色标记）。 */
function hasDependencyCycle(waves) {
  const dependencies = new Map(waves.map(wave => [wave.id, wave.depends_on]));
  const visiting = new Set();
  const visited = new Set();
  const visit = id => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of dependencies.get(id) || []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return [...dependencies.keys()].some(visit);
}

/** 计算 plan 内容 hash（剔除 hash 字段后的 stableJson 的 sha256）。 */
export function hashPlan(plan) {
  const { hash, ...content } = plan;
  return `sha256:${createHash('sha256').update(stableJson(content)).digest('hex')}`;
}

/** 安全版 hashPlan：plan 非对象或序列化失败时返回 null。 */
function tryHashPlan(plan) {
  if (!isObject(plan)) return null;
  try {
    return hashPlan(plan);
  } catch {
    return null;
  }
}

/** 将 plan 的 revision/mode/hash 同步写入 change 目录的 .spec-superflow.yaml。 */
export function writeExecutionPlanSummary(changeDir, plan) {
  const statePath = join(changeDir, '.spec-superflow.yaml');
  const state = readState(changeDir);
  const original = existsSync(statePath)
    ? readFileSync(statePath, 'utf8')
    : `state: ${state.state}\nworkflow: ${state.workflow}\n`;
  const content = [
    ['revision', plan.revision],
    ['execution_mode', plan.mode],
    ['execution_plan_hash', plan.hash],
    ['execution_plan_revision', plan.revision],
  ].reduce((current, [field, value]) => setStateField(current, field, value), original);
  atomicWrite(statePath, content);
}
