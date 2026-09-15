// scripts/lib/plan-repair.mjs
// repair 状态链：fail receipt 的连续性校验、repair state 读写与证据校验、
// adjudication 阈值（MAX_REPAIR_FAILURES）判定。依赖 plan-review/plan-git。
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getPlanScopedPaths } from './sdd-overlay.mjs';
import { atomicWrite, isNonEmptyText, MAX_REPAIR_FAILURES, safeFileName } from './plan-shared.mjs';
import { reviewEvidence, sameReviewEvidence, validateReviewReportEvidence } from './plan-review.mjs';
import { validateReviewRange } from './plan-git.mjs';

/** 校验 repair review 的 range 连续性：base 必须等于上一轮 review 的 head。 */
export function validateRepairContinuity(previousReceipt, previousRepair, nextReceipt, { allowRepeatedRange = true } = {}) {
  if (previousReceipt?.status !== 'fail') return;
  const previousHead = previousRepair?.previous_head ?? previousReceipt.head;
  if (!previousHead) throw new Error('Repair state is missing the previous review head');

  if (!allowRepeatedRange && nextReceipt.base === nextReceipt.head) {
    throw new Error('Authorized repair review must include a non-empty Git range; base and head must differ');
  }

  // A failed re-review must examine a repair that starts at the prior review
  // head. Outside adjudication, a pass may also certify the exact original
  // range to preserve the established fail→pass receipt flow. A human
  // authorization disables that compatibility exception.
  const repeatsPreviousRange = allowRepeatedRange && nextReceipt.status === 'pass'
    && nextReceipt.base === previousReceipt.base
    && nextReceipt.head === previousReceipt.head;
  if (nextReceipt.base !== previousHead && !repeatsPreviousRange) {
    throw new Error('Repair review base must equal the previous review head so repair ranges are continuous');
  }
}

/** 根据新 receipt 更新 wave 的 repair state（fail 累计 / pass 解决 / 首过清理），返回新状态。 */
export function updateRepairState(changeDir, plan, waveId, previousRepair, previousReceipt, receipt) {
  const paths = getPlanScopedPaths(changeDir, plan);
  mkdirSync(paths.repairState, { recursive: true });
  const statePath = join(paths.repairState, `${safeFileName(waveId)}.json`);
  const now = new Date().toISOString();
  const priorFailures = Array.isArray(previousRepair?.failures) ? previousRepair.failures : [];
  let state;

  if (receipt.status === 'fail') {
    const failures = [...priorFailures, reviewEvidence(receipt, waveId)];
    state = {
      plan_hash: plan.hash,
      plan_revision: plan.revision,
      wave_id: waveId,
      status: failures.length >= MAX_REPAIR_FAILURES ? 'adjudication-required' : 'repairing',
      failure_count: failures.length,
      previous_head: receipt.head,
      previous_report: receipt.report,
      failures,
      updated_at: now,
    };
  } else if (previousReceipt?.status === 'fail' || previousRepair?.failure_count > 0) {
    state = {
      plan_hash: plan.hash,
      plan_revision: plan.revision,
      wave_id: waveId,
      status: 'resolved',
      failure_count: priorFailures.length,
      previous_head: receipt.head,
      previous_report: previousRepair?.previous_report ?? priorFailures.at(-1)?.report ?? null,
      failures: priorFailures,
      resolution: reviewEvidence(receipt, waveId),
      updated_at: now,
    };
  } else {
    // A first-pass receipt does not begin a repair chain. Do not manufacture
    // repair evidence for it, but still leave no stale state for this wave.
    if (existsSync(statePath)) rmSync(statePath, { force: true });
    return null;
  }
  atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

/** 读取 wave 的 repair state 并校验其证据一致性；不存在返回 null。 */
export function readRepairState(changeDir, plan, waveId, currentReceipt = null) {
  if (!plan) return null;
  const statePath = join(getPlanScopedPaths(changeDir, plan).repairState, `${safeFileName(waveId)}.json`);
  if (!existsSync(statePath)) return null;
  let state;
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read repair state: ${error.message}`);
  }
  validateRepairStateEvidence(changeDir, plan, waveId, state, currentReceipt);
  return state;
}

/** 校验 repair state 证据：身份绑定、状态与失败数匹配、失败链 range 连续、report hash 一致。 */
export function validateRepairStateEvidence(changeDir, plan, waveId, state, currentReceipt = null) {
  if (state?.plan_hash !== plan.hash || state?.plan_revision !== plan.revision || state?.wave_id !== waveId) {
    throw new Error('Repair state plan or wave identity does not match the current execution plan');
  }
  if (!['repairing', 'resolved', 'adjudication-required'].includes(state.status)) {
    throw new Error('Repair state status is invalid');
  }
  if (!Number.isInteger(state.failure_count) || state.failure_count < 1 || !Array.isArray(state.failures)
    || state.failures.length !== state.failure_count || !isNonEmptyText(state.previous_head)
    || !isNonEmptyText(state.previous_report)) {
    throw new Error('Repair state failure history is malformed');
  }
  if (state.status === 'repairing' && state.failure_count >= MAX_REPAIR_FAILURES) {
    throw new Error('Repair state status does not match its failure count');
  }
  if (state.status === 'adjudication-required' && state.failure_count < MAX_REPAIR_FAILURES) {
    throw new Error('Repair state status does not meet the adjudication threshold');
  }

  let previousFailure = null;
  for (const [index, failure] of state.failures.entries()) {
    const label = `Repair state failure ${index + 1}`;
    if (failure?.status !== 'fail' || failure?.plan_hash !== plan.hash
      || failure?.plan_revision !== plan.revision || failure?.wave_id !== waveId) {
      throw new Error(`${label} plan or wave binding is invalid`);
    }
    if (!isNonEmptyText(failure.base) || !isNonEmptyText(failure.head)
      || !isNonEmptyText(failure.report) || !/^sha256:[0-9a-f]{64}$/i.test(failure.report_sha256 ?? '')
      || !isNonEmptyText(failure.recorded_at) || Number.isNaN(Date.parse(failure.recorded_at))) {
      throw new Error(`${label} evidence is malformed`);
    }
    const range = validateReviewRange(changeDir, failure.base, failure.head);
    if (failure.base !== range.base || failure.head !== range.head) {
      throw new Error(`${label} must use immutable Git commit IDs`);
    }
    if (previousFailure && failure.base !== previousFailure.head) {
      throw new Error(`${label} base must equal the previous failure head so repair ranges are continuous`);
    }
    const report = validateReviewReportEvidence(changeDir, failure.report);
    if (failure.report !== report.path || failure.report_sha256 !== report.sha256) {
      throw new Error(`${label} report content does not match its recorded hash`);
    }
    previousFailure = failure;
  }

  const finalFailure = state.failures.at(-1);
  if (state.status === 'resolved') {
    const resolution = state.resolution;
    if (resolution?.status !== 'pass' || resolution?.plan_hash !== plan.hash
      || resolution?.plan_revision !== plan.revision || resolution?.wave_id !== waveId
      || !isNonEmptyText(resolution.base) || !isNonEmptyText(resolution.head)
      || !isNonEmptyText(resolution.report) || !/^sha256:[0-9a-f]{64}$/i.test(resolution.report_sha256 ?? '')
      || !isNonEmptyText(resolution.recorded_at) || Number.isNaN(Date.parse(resolution.recorded_at))) {
      throw new Error('Repair state resolution evidence is malformed');
    }
    const resolutionRange = validateReviewRange(changeDir, resolution.base, resolution.head);
    if (resolution.base !== resolutionRange.base || resolution.head !== resolutionRange.head) {
      throw new Error('Repair state resolution must use immutable Git commit IDs');
    }
    const resolutionReport = validateReviewReportEvidence(changeDir, resolution.report);
    if (resolution.report !== resolutionReport.path || resolution.report_sha256 !== resolutionReport.sha256) {
      throw new Error('Repair state resolution report content does not match its recorded hash');
    }
    if (state.previous_head !== resolution.head || state.previous_report !== finalFailure.report) {
      throw new Error('Resolved repair state does not match its resolution and final failure evidence');
    }
  } else if (state.previous_head !== finalFailure.head || state.previous_report !== finalFailure.report) {
    throw new Error('Repair state previous evidence does not match its final failure');
  }
  if (currentReceipt && !sameReviewEvidence(finalFailure, currentReceipt, plan, waveId)) {
    throw new Error('Repair state final failure does not match the current failed receipt');
  }
}

/** 返回 wave 的 repair 展示状态；无 state 时按 receipt 推导（legacy fail 兼容 / not-needed）。 */
export function describeRepairState(changeDir, plan, waveId, receipt) {
  const state = readRepairState(
    changeDir,
    plan,
    waveId,
    receipt?.status === 'fail' ? receipt : null,
  );
  if (state) return state;
  if (receipt?.status === 'fail') {
    // A valid legacy fail receipt predates repair-state. It remains retryable
    // for compatibility, but has no fabricated audit history.
    return {
      status: 'repairing', failure_count: 1, previous_head: receipt.head,
      previous_report: receipt.report, failures: [],
    };
  }
  return {
    status: 'not-needed', failure_count: 0, previous_head: null,
    previous_report: null, failures: [],
  };
}
