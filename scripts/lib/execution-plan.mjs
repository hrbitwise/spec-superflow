// scripts/lib/execution-plan.mjs
// Facade：对外公共 API 保持稳定（12 个导出不变），实现已按职责拆分为
// plan-shared / plan-core / plan-git / plan-review / plan-repair /
// plan-adjudication / plan-resync。本文件仅保留跨簇编排者 recordReview 与
// describeWaves。
//
// 依赖方向（严格 DAG，无环）：
//   plan-shared ← plan-core ← plan-git ← plan-review ← plan-repair
//     ← plan-adjudication ← plan-resync
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getOverlayPaths, getPlanScopedPaths } from './sdd-overlay.mjs';
import { atomicWrite, requireText, REVIEW_STATUSES, safeFileName } from './plan-shared.mjs';
import { readPlan, validatePlan } from './plan-core.mjs';
import { assertReviewHeadBranch, validateReviewRange, warnIfCwdOutsideIsolation } from './plan-git.mjs';
import {
  blockedDependencies, readCurrentReviewEvidence, validateReviewReportEvidence,
} from './plan-review.mjs';
import {
  describeRepairState, readRepairState, updateRepairState, validateRepairContinuity,
} from './plan-repair.mjs';
import {
  consumeAdjudication, describeAdjudication, readActiveAdjudication,
} from './plan-adjudication.mjs';

export { EXECUTION_MODES } from './plan-shared.mjs';
export { createPlan, readPlan, validatePlan, writePlan } from './plan-core.mjs';
export { createGitRangeValidator, isSubpath } from './plan-git.mjs';
export { readCurrentReview } from './plan-review.mjs';
export { adjudicateWave } from './plan-adjudication.mjs';
export { resyncPlan } from './plan-resync.mjs';

/** 记录某 wave 的 review receipt：校验依赖/证据/git range，更新 repair state 并消费 adjudication 授权。 */
export function recordReview(changeDir, waveId, receipt, options = {}) {
  const plan = readPlan(changeDir);
  const validation = validatePlan(changeDir, plan);
  if (!validation.valid) throw new Error(`Cannot record a review for an invalid execution plan: ${validation.failures.join('; ')}`);
  const wave = Array.isArray(plan?.waves) && plan.waves.find(candidate => candidate?.id === waveId);
  if (!wave) throw new Error(`Review receipt references unknown wave '${waveId}'`);
  const blockedBy = blockedDependencies(changeDir, plan, wave);
  if (blockedBy.length > 0) {
    throw new Error(`Wave '${waveId}' cannot be reviewed before dependencies have passing receipts: ${blockedBy.join(', ')}`);
  }
  if (!REVIEW_STATUSES.has(receipt?.status)) {
    throw new Error("Review receipt status must be 'pass' or 'fail'");
  }
  for (const field of ['base', 'head']) requireText(receipt?.[field], `receipt.${field}`);
  const paths = getOverlayPaths(changeDir);
  const planPaths = getPlanScopedPaths(changeDir, plan);
  mkdirSync(paths.reviews, { recursive: true });
  mkdirSync(planPaths.reviews, { recursive: true });
  const reportEvidence = validateReviewReportEvidence(changeDir, receipt?.report);
  const { base, head } = validateReviewRange(changeDir, receipt.base, receipt.head);
  warnIfCwdOutsideIsolation(changeDir);
  assertReviewHeadBranch(changeDir, head, options.runGit);
  const currentReview = readCurrentReviewEvidence(changeDir, waveId, plan);
  if (currentReview.blocker) {
    throw new Error(`Wave '${waveId}' cannot be reviewed while its failed report evidence is invalid: ${currentReview.blocker}`);
  }
  const previousReceipt = currentReview.receipt;
  const previousRepair = readRepairState(
    changeDir,
    plan,
    waveId,
    previousReceipt?.status === 'fail' ? previousReceipt : null,
  );
  let authorization = null;
  if (previousRepair?.status === 'adjudication-required') {
    authorization = readActiveAdjudication(changeDir, plan, waveId, previousRepair, previousReceipt);
    if (!authorization) {
      throw new Error(`Wave '${waveId}' requires adjudication before another review can be recorded`);
    }
  }
  if (previousReceipt?.status === 'pass') {
    throw new Error(`Wave '${waveId}' already has a passing review receipt`);
  }
  validateRepairContinuity(
    previousReceipt,
    previousRepair,
    { status: receipt.status, base, head, report: reportEvidence.path },
    { allowRepeatedRange: authorization === null },
  );

  const savedReceipt = {
    status: receipt.status,
    base,
    head,
    report: reportEvidence.path,
    report_sha256: reportEvidence.sha256,
    plan_hash: plan.hash,
    plan_revision: plan.revision,
    recorded_at: new Date().toISOString(),
  };
  // Keep the established root receipt as a compatibility mirror, while the
  // authoritative current-plan copy preserves history across plan revisions.
  // Both retain the same receipt shape, including report integrity evidence.
  const serializedReceipt = `${JSON.stringify(savedReceipt, null, 2)}\n`;
  atomicWrite(join(paths.reviews, `${safeFileName(waveId)}.json`), serializedReceipt);
  atomicWrite(join(planPaths.reviews, `${safeFileName(waveId)}.json`), serializedReceipt);
  updateRepairState(changeDir, plan, waveId, previousRepair, previousReceipt, savedReceipt);
  if (authorization) consumeAdjudication(changeDir, plan, waveId, authorization.id, savedReceipt);
  if (savedReceipt.status === 'pass') {
    // Task briefs, diff packages, and progress notes are regenerable for this
    // exact plan. Receipt and repair evidence deliberately live beside, not in,
    // this directory and must remain available to closing/repair guards.
    rmSync(getPlanScopedPaths(changeDir, plan).workspace, { recursive: true, force: true });
  }
  return savedReceipt;
}

/**
 * Machine-readable execution status used by `ssf execution show`. A wave is
 * eligible when it has no current receipt, or its current receipt failed and
 * is therefore retryable, and all declared dependencies have passing receipts.
 */
export function describeWaves(changeDir, plan = readPlan(changeDir)) {
  if (!plan || !Array.isArray(plan.waves)) return [];
  return plan.waves.map(wave => {
    const review = readCurrentReviewEvidence(changeDir, wave.id, plan);
    const receipt = review.receipt;
    const blockers = [
      ...blockedDependencies(changeDir, plan, wave),
      ...(review.blocker ? [review.blocker] : []),
    ];
    let repair;
    try {
      repair = describeRepairState(changeDir, plan, wave.id, receipt);
    } catch (error) {
      blockers.push(`repair state evidence is invalid: ${error.message}`);
      repair = {
        status: 'invalid', failure_count: 0, previous_head: null,
        previous_report: null, failures: [],
      };
    }
    const adjudication = describeAdjudication(changeDir, plan, wave.id, repair, receipt);
    const retryable = blockers.length === 0 && receipt?.status === 'fail'
      && (repair.status !== 'adjudication-required' || adjudication?.active === true);
    return {
      id: wave.id,
      strategy: wave.strategy,
      tasks: wave.tasks,
      depends_on: wave.depends_on,
      eligible: (receipt === null || retryable) && blockers.length === 0,
      retryable,
      receipt,
      blockers,
      repair,
      ...(adjudication ? { adjudication } : {}),
    };
  });
}
