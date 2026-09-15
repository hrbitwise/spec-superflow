// scripts/lib/plan-review.mjs
// review receipt 证据链：读取当前 plan 的 receipt、校验 report 证据（物理目录、
// 软链、内容 sha256）、比对证据一致性、解析 wave 依赖阻塞。依赖 plan-core/plan-git。
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { getOverlayPaths, getPlanScopedPaths } from './sdd-overlay.mjs';
import { isNonEmptyText, isObject, isValidTimestamp, requireText, safeFileName } from './plan-shared.mjs';
import { readPlan } from './plan-core.mjs';
import { validateReviewRange } from './plan-git.mjs';

/**
 * Returns the current plan's receipt for one wave. Receipts from a previous
 * revision/hash are never evidence for the current plan.
 */
export function readCurrentReview(changeDir, waveId, plan = readPlan(changeDir)) {
  return readCurrentReviewEvidence(changeDir, waveId, plan).receipt;
}

/** 读取并校验某 wave 的当前 receipt 证据；证据失效时返回 blocker 说明而非静默吞掉。 */
export function readCurrentReviewEvidence(changeDir, waveId, plan = readPlan(changeDir)) {
  if (!plan) return { receipt: null, blocker: null };
  const currentScope = getPlanScopedPaths(changeDir, plan);
  const currentPath = join(currentScope.reviews, `${safeFileName(waveId)}.json`);
  const legacyPath = join(getOverlayPaths(changeDir).reviews, `${safeFileName(waveId)}.json`);
  // Newer callers may have written a scoped receipt, but the established
  // root receipt remains the compatibility source until a future format
  // migration. In either case the plan identity below is mandatory.
  const filePath = existsSync(currentPath) ? currentPath : legacyPath;
  if (!existsSync(filePath)) return { receipt: null, blocker: null };
  try {
    const receipt = JSON.parse(readFileSync(filePath, 'utf8'));
    if (receipt?.plan_hash !== plan.hash || receipt?.plan_revision !== plan.revision) return { receipt: null, blocker: null };
    const range = validateReviewRange(changeDir, receipt?.base, receipt?.head);
    if (receipt.base !== range.base || receipt.head !== range.head) return { receipt: null, blocker: null };
    // Reports remain evidence only while their safety and content identity can
    // be re-established. A missing hash is accepted for legacy receipts, but
    // all newly written receipts bind the report body to the review result.
    const evidence = validateReviewReportEvidence(changeDir, receipt.report);
    if (receipt.report_sha256 !== undefined && receipt.report_sha256 !== evidence.sha256) {
      throw new Error('review report evidence content no longer matches its receipt');
    }
    return { receipt, blocker: null };
  } catch (error) {
    // A corrupted pass receipt is treated as absent so the wave can be
    // reviewed again. A failed receipt is different: reopening it would erase
    // the repair-chain evidence and permit an unaudited retry.
    try {
      const receipt = JSON.parse(readFileSync(filePath, 'utf8'));
      if (receipt?.plan_hash === plan.hash && receipt?.plan_revision === plan.revision && receipt?.status === 'fail') {
        return { receipt: null, blocker: `failed review report evidence is invalid: ${error.message}` };
      }
    } catch {
      // An unreadable receipt has no trustworthy status to preserve.
    }
    return { receipt: null, blocker: null };
  }
}

/** 将 receipt 投影为可嵌入 repair/adjudication 记录的证据对象。 */
export function reviewEvidence(receipt, waveId) {
  return {
    status: receipt.status,
    base: receipt.base,
    head: receipt.head,
    report: receipt.report,
    report_sha256: receipt.report_sha256,
    plan_hash: receipt.plan_hash,
    plan_revision: receipt.plan_revision,
    wave_id: waveId,
    recorded_at: receipt.recorded_at,
  };
}

/** 逐字段比对存储证据与 receipt 是否指向同一次 review。 */
export function sameReviewEvidence(evidence, receipt, plan, waveId) {
  return evidence?.status === receipt?.status
    && evidence?.base === receipt?.base
    && evidence?.head === receipt?.head
    && evidence?.report === receipt?.report
    && evidence?.report_sha256 === receipt?.report_sha256
    && evidence?.plan_hash === plan.hash
    && evidence?.plan_revision === plan.revision
    && evidence?.wave_id === waveId
    && evidence?.recorded_at === receipt?.recorded_at;
}

/** 校验存储的 review 证据：身份绑定、不可变 commit ID、report 内容 hash 一致。 */
export function validateStoredReviewEvidence(changeDir, plan, waveId, evidence, { expectedStatuses, label }) {
  if (!isObject(evidence) || !expectedStatuses.has(evidence.status)
    || evidence.plan_hash !== plan.hash || evidence.plan_revision !== plan.revision
    || evidence.wave_id !== waveId || !isNonEmptyText(evidence.base) || !isNonEmptyText(evidence.head)
    || !isNonEmptyText(evidence.report) || !/^sha256:[0-9a-f]{64}$/i.test(evidence.report_sha256 ?? '')
    || !isValidTimestamp(evidence.recorded_at)) {
    throw new Error(`${label} audit evidence is malformed`);
  }
  const range = validateReviewRange(changeDir, evidence.base, evidence.head);
  if (evidence.base !== range.base || evidence.head !== range.head) {
    throw new Error(`${label} must use immutable Git commit IDs`);
  }
  const report = validateReviewReportEvidence(changeDir, evidence.report);
  if (evidence.report !== report.path || evidence.report_sha256 !== report.sha256) {
    throw new Error(`${label} report content does not match its recorded hash`);
  }
}

/** 校验 review report 证据：路径安全、常规文件、非空、位于 reviews overlay 内，返回规范化路径与内容 sha256。 */
export function validateReviewReportEvidence(changeDir, report) {
  requireText(report, 'receipt.report');
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(report)) {
    throw new Error('Review report evidence path is unsafe');
  }

  const { changeRoot, reviewsDir } = getPhysicalReviewsDirectory(changeDir);
  const reportPath = isAbsolute(report) ? resolve(report) : resolve(changeRoot, report);

  let metadata;
  try {
    metadata = lstatSync(reportPath);
  } catch (error) {
    throw new Error(`Review report evidence cannot be read: ${error.message}`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error('Review report evidence must be a regular file');
  }
  if (metadata.size === 0) {
    throw new Error('Review report evidence must be non-empty');
  }
  const realReportPath = realpathSync(reportPath);
  const realOverlayRelativePath = relative(reviewsDir, realReportPath);
  if (realOverlayRelativePath === '' || realOverlayRelativePath === '..' || realOverlayRelativePath.startsWith(`..${sep}`) || isAbsolute(realOverlayRelativePath)) {
    throw new Error('Review report evidence must resolve inside the change review overlay');
  }
  return {
    path: relative(changeRoot, realReportPath),
    sha256: `sha256:${createHash('sha256').update(readFileSync(realReportPath)).digest('hex')}`,
  };
}

/** 解析 change 的物理 reviews 目录（逐级拒绝软链），返回 changeRoot 与 reviewsDir。 */
function getPhysicalReviewsDirectory(changeDir) {
  let changeRoot;
  try {
    changeRoot = realpathSync(changeDir);
  } catch (error) {
    throw new Error(`Review report evidence cannot resolve the change directory: ${error.message}`);
  }

  let directory = changeRoot;
  for (const component of ['.superpowers', 'sdd', 'reviews']) {
    directory = join(directory, component);
    let metadata;
    try {
      metadata = lstatSync(directory);
    } catch (error) {
      throw new Error(`Review report evidence cannot read the ${component} overlay directory: ${error.message}`);
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error('Review report evidence requires physical .superpowers/sdd/reviews overlay directories');
    }
  }
  return { changeRoot, reviewsDir: directory };
}

/** 列出 wave 的 depends_on 中尚无通过 receipt 的依赖项。 */
export function blockedDependencies(changeDir, plan, wave) {
  if (!Array.isArray(wave?.depends_on)) return [];
  return wave.depends_on.filter(dependency => readCurrentReview(changeDir, dependency, plan)?.status !== 'pass');
}
