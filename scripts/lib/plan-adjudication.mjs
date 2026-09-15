// scripts/lib/plan-adjudication.mjs
// adjudication（人工裁决）证据链：授权记录台账的读写、证据校验、授权消费。
// 一个 adjudication-required 的 repair 链必须经人工授权才能再记录 review。
// 依赖 plan-core/plan-review/plan-repair。
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPlanScopedPaths } from './sdd-overlay.mjs';
import {
  atomicWrite, isNonEmptyText, isValidTimestamp, MAX_REPAIR_FAILURES,
  requireText, REVIEW_STATUSES, safeFileName,
} from './plan-shared.mjs';
import { readPlan, validatePlan } from './plan-core.mjs';
import {
  readCurrentReviewEvidence, reviewEvidence, sameReviewEvidence,
  validateStoredReviewEvidence,
} from './plan-review.mjs';
import { readRepairState, validateRepairStateEvidence } from './plan-repair.mjs';

/**
 * Persists an explicit human decision that authorizes exactly one additional
 * review for the current adjudication-required repair chain.
 */
export function adjudicateWave(changeDir, waveId, input) {
  const plan = readPlan(changeDir);
  const validation = validatePlan(changeDir, plan);
  if (!validation.valid) throw new Error(`Cannot adjudicate an invalid execution plan: ${validation.failures.join('; ')}`);
  const wave = Array.isArray(plan?.waves) && plan.waves.find(candidate => candidate?.id === waveId);
  if (!wave) throw new Error(`Adjudication references unknown wave '${waveId}'`);
  if (input?.decision !== 'allow-review') throw new Error("Adjudication decision must be 'allow-review'");
  if (input?.confirmed !== true) throw new Error('Adjudication requires confirmed human review of the failure chain');
  requireText(input?.reason, 'adjudication.reason');
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(input.reason)) {
    throw new Error('Adjudication reason must not contain control characters or line separators');
  }

  const currentReview = readCurrentReviewEvidence(changeDir, waveId, plan);
  if (currentReview.blocker) {
    throw new Error(`Wave '${waveId}' cannot be adjudicated while its failed report evidence is invalid: ${currentReview.blocker}`);
  }
  const receipt = currentReview.receipt;
  const repair = readRepairState(changeDir, plan, waveId, receipt);
  if (receipt?.status !== 'fail' || repair?.status !== 'adjudication-required') {
    throw new Error(`Wave '${waveId}' is not adjudication-required`);
  }
  if (readActiveAdjudication(changeDir, plan, waveId, repair, receipt)) {
    throw new Error(`Wave '${waveId}' already has an active review authorization`);
  }

  const ledger = readAdjudicationLedger(changeDir, plan, waveId) ?? {
    plan_hash: plan.hash,
    plan_revision: plan.revision,
    wave_id: waveId,
    adjudications: [],
  };
  const authorization = {
    id: randomUUID(),
    status: 'authorized',
    decision: input.decision,
    confirmed: true,
    reason: input.reason.trim(),
    failure_count: repair.failure_count,
    previous_head: repair.previous_head,
    previous_report: repair.previous_report,
    failed_receipt: adjudicationReceiptEvidence(receipt, waveId),
    authorized_at: new Date().toISOString(),
  };
  ledger.adjudications.push(authorization);
  writeAdjudicationLedger(changeDir, plan, waveId, ledger);
  return { ...authorization, active: true };
}

/** 将 fail receipt 投影为 adjudication 台账中的失败证据（reviewEvidence 的别名）。 */
function adjudicationReceiptEvidence(receipt, waveId) {
  return reviewEvidence(receipt, waveId);
}

/** 计算 wave 的 adjudication 台账文件路径（按 plan 身份隔离）。 */
function adjudicationPath(changeDir, plan, waveId) {
  return join(getPlanScopedPaths(changeDir, plan).adjudications, `${safeFileName(waveId)}.json`);
}

/** 读取并校验 adjudication 台账；不存在返回 null，损坏抛错。 */
export function readAdjudicationLedger(changeDir, plan, waveId) {
  if (!plan) return null;
  const filePath = adjudicationPath(changeDir, plan, waveId);
  if (!existsSync(filePath)) return null;
  try {
    const ledger = JSON.parse(readFileSync(filePath, 'utf8'));
    if (ledger?.plan_hash !== plan.hash || ledger?.plan_revision !== plan.revision
      || ledger?.wave_id !== waveId || !Array.isArray(ledger.adjudications)) {
      throw new Error('adjudication ledger identity or entries are invalid');
    }
    validateAdjudicationLedgerEvidence(changeDir, plan, waveId, ledger);
    return ledger;
  } catch (error) {
    throw new Error(`Unable to read adjudication evidence: ${error.message}`);
  }
}

/** 校验 adjudication 台账证据：条目形状、failure_count 递进、与 repair 链双向绑定。 */
export function validateAdjudicationLedgerEvidence(changeDir, plan, waveId, ledger) {
  if (!Array.isArray(ledger?.adjudications) || ledger.adjudications.length === 0) {
    throw new Error('adjudication ledger must contain at least one audit entry');
  }
  const repair = readRepairState(changeDir, plan, waveId);
  if (!repair || !Array.isArray(repair.failures) || repair.failures.length === 0) {
    throw new Error('adjudication ledger has no repair chain to bind its entries');
  }
  const ids = new Set();
  let previousFailureCount = 0;
  for (const [index, entry] of ledger.adjudications.entries()) {
    const label = `Adjudication entry ${index + 1}`;
    if (!isNonEmptyText(entry?.id) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry.id)) {
      throw new Error(`${label} id is invalid`);
    }
    if (ids.has(entry.id)) throw new Error(`${label} id is duplicated`);
    ids.add(entry.id);
    if (!['authorized', 'consumed'].includes(entry.status) || entry.decision !== 'allow-review'
      || entry.confirmed !== true || !isNonEmptyText(entry.reason)
      || entry.reason !== entry.reason.trim() || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(entry.reason)
      || !isValidTimestamp(entry.authorized_at)
      || !Number.isInteger(entry.failure_count) || entry.failure_count < MAX_REPAIR_FAILURES
      || !isNonEmptyText(entry.previous_head) || !isNonEmptyText(entry.previous_report)) {
      throw new Error(`${label} audit evidence is malformed`);
    }
    if (entry.failure_count <= previousFailureCount) {
      throw new Error(`${label} failure count must advance through the repair chain`);
    }
    previousFailureCount = entry.failure_count;
    validateStoredReviewEvidence(changeDir, plan, waveId, entry.failed_receipt, {
      expectedStatuses: new Set(['fail']),
      label: `${label} failed receipt`,
    });
    if (entry.previous_head !== entry.failed_receipt.head
      || entry.previous_report !== entry.failed_receipt.report) {
      throw new Error(`${label} repair identity does not match its failed receipt`);
    }
    const adjudicatedFailure = repair.failures[entry.failure_count - 1];
    if (!adjudicatedFailure) {
      throw new Error(`${label} failure count does not identify an existing repair chain failure`);
    }
    if (!sameReviewEvidence(entry.failed_receipt, adjudicatedFailure, plan, waveId)) {
      throw new Error(`${label} failed receipt does not match the identified repair chain failure`);
    }
    if (entry.status === 'authorized') {
      if (entry.consumed_at !== undefined || entry.review !== undefined) {
        throw new Error(`${label} authorized evidence must not contain consumed review fields`);
      }
      if (index !== ledger.adjudications.length - 1) {
        throw new Error(`${label} authorized evidence must be the latest ledger entry`);
      }
      continue;
    }
    if (!isValidTimestamp(entry.consumed_at) || Date.parse(entry.consumed_at) < Date.parse(entry.authorized_at)) {
      throw new Error(`${label} consumption timestamp is invalid`);
    }
    validateStoredReviewEvidence(changeDir, plan, waveId, entry.review, {
      expectedStatuses: REVIEW_STATUSES,
      label: `${label} consumed review`,
    });
    if (entry.review.base !== entry.previous_head || entry.review.base === entry.review.head) {
      throw new Error(`${label} consumed review must be a non-empty range continuous from the adjudicated head`);
    }
    const expectedReview = entry.review.status === 'fail'
      ? repair.failures[entry.failure_count]
      : repair.resolution;
    if (!expectedReview || !sameReviewEvidence(entry.review, expectedReview, plan, waveId)) {
      throw new Error(`${label} consumed review does not match the next repair chain outcome`);
    }
  }
}

/** 原子写入 adjudication 台账。 */
export function writeAdjudicationLedger(changeDir, plan, waveId, ledger) {
  const directory = getPlanScopedPaths(changeDir, plan).adjudications;
  mkdirSync(directory, { recursive: true });
  atomicWrite(adjudicationPath(changeDir, plan, waveId), `${JSON.stringify(ledger, null, 2)}\n`);
}

/** 返回当前仍活跃的 adjudication 授权（未消费且与 repair/receipt 证据一致），否则 null。 */
export function readActiveAdjudication(changeDir, plan, waveId, repair, receipt) {
  const latest = readAdjudicationLedger(changeDir, plan, waveId)?.adjudications.at(-1);
  if (!latest || latest.status !== 'authorized' || latest.decision !== 'allow-review' || latest.confirmed !== true) return null;
  if (repair?.status !== 'adjudication-required' || receipt?.status !== 'fail') return null;
  validateRepairStateEvidence(changeDir, plan, waveId, repair, receipt);
  if (latest.failure_count !== repair.failure_count
    || latest.previous_head !== repair.previous_head
    || latest.previous_report !== repair.previous_report
    || !sameReviewEvidence(latest.failed_receipt, receipt, plan, waveId)) return null;
  return latest;
}

/** 返回最新一条 adjudication 的展示形态（附加 active 标志）；无台账返回 null。 */
export function describeAdjudication(changeDir, plan, waveId, repair, receipt) {
  const latest = readAdjudicationLedger(changeDir, plan, waveId)?.adjudications.at(-1);
  if (!latest) return null;
  return { ...latest, active: readActiveAdjudication(changeDir, plan, waveId, repair, receipt)?.id === latest.id };
}

/** 将指定授权标记为已消费，并把本次 review 证据回填到台账条目。 */
export function consumeAdjudication(changeDir, plan, waveId, authorizationId, receipt) {
  const ledger = readAdjudicationLedger(changeDir, plan, waveId);
  const authorization = ledger?.adjudications.find(candidate => candidate.id === authorizationId);
  if (!authorization || authorization.status !== 'authorized') return;
  authorization.status = 'consumed';
  authorization.consumed_at = new Date().toISOString();
  authorization.review = reviewEvidence(receipt, waveId);
  writeAdjudicationLedger(changeDir, plan, waveId, ledger);
}
