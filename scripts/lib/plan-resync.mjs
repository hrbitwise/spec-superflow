// scripts/lib/plan-resync.mjs
// 执行计划 resync：刷新 artifacts_hash 引用、重算 plan hash 与 overlay 封印，
// 迁移 receipts/adjudications/repair-state/checkpoints/handoffs/workspace 到新的
// plan 身份目录，全程 undo log 保护，失败时逆序恢复。依赖全部其他 plan 子模块。
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { computeArtifactsHash } from './hash.mjs';
import { hashReceipt } from './execution-recommendation.mjs';
import { getOverlayPaths, getPlanScopedPaths } from './sdd-overlay.mjs';
import { atomicWrite, isNonEmptyText, isObject } from './plan-shared.mjs';
import { hashPlan, readPlan, writeExecutionPlanSummary } from './plan-core.mjs';
import { readCurrentReviewEvidence } from './plan-review.mjs';
import { validateRepairStateEvidence } from './plan-repair.mjs';
import { validateAdjudicationLedgerEvidence } from './plan-adjudication.mjs';

/**
 * Resolves a stale plan (see changes/plan-resync): refreshes the plan's
 * artifacts_hash reference to the current artifacts snapshot, recomputes the
 * plan content hash, refreshes the recommendation overlay seal, migrates both
 * receipt stores' plan_hash fields plus repair-state records, and appends an
 * audit record to the progress ledger. The revision — and with it the
 * plan-scoped directory identity — deliberately stays unchanged.
 *
 * Migration order (review-findings-fix R1/R4): every record first, the plan
 * file last. Each step appends {path, previousContent} to an undo log, so a
 * failure at any point replays the log in reverse and restores the exact
 * pre-resync state: plan untouched means the system is still in its original
 * self-consistent stale state.
 */
export function resyncPlan(changeDir, { reason } = {}) {
  if (!isNonEmptyText(reason)) throw new Error('resync requires a reason describing the non-semantic correction');
  const plan = readPlan(changeDir);
  if (!plan) throw new Error(`No execution plan exists in '${changeDir}'; create one before resyncing`);

  const currentArtifactsHash = computeArtifactsHash(changeDir);
  if (plan.artifacts_hash === currentArtifactsHash) {
    throw new Error('Execution plan is not stale: no need to resync until its artifacts hash differs from the current snapshot');
  }

  const reviewEvidenceByWave = (plan.waves ?? []).map(wave => ({
    wave,
    review: readCurrentReviewEvidence(changeDir, wave.id, plan),
  }));
  const invalidReview = reviewEvidenceByWave.find(({ review }) => review.blocker);
  if (invalidReview) {
    throw new Error(`Cannot resync while wave '${invalidReview.wave.id}' has invalid review evidence: ${invalidReview.review.blocker}`);
  }
  const failedWaves = reviewEvidenceByWave
    .filter(({ review }) => review.receipt?.status === 'fail')
    .map(({ wave }) => wave.id);
  if (failedWaves.length > 0) {
    throw new Error(`Cannot resync while repair chains are open; waves with fail receipts must close their repair loop first: ${failedWaves.join(', ')}`);
  }

  const undoLog = [];
  const writeWithUndo = (targetPath, content) => {
    // 撤销语义要求"写入前必然已读"：旧内容留存于内存，恢复时可用。
    const previousContent = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : null;
    atomicWrite(targetPath, content);
    undoLog.push({ path: targetPath, previousContent });
  };

  try {
    const previousArtifactsHash = plan.artifacts_hash;
    const previousPlan = structuredClone(plan);
    const previousIdentity = getPlanScopedPaths(changeDir, previousPlan);

    // The frozen receipt inside the plan references the artifacts snapshot it
    // certified; resync deliberately refreshes that reference together with
    // the plan itself. The receipt's content hash covers every field including
    // artifacts_hash, so the seal must be recomputed.
    if (isObject(plan.recommendation_receipt)) {
      plan.recommendation_receipt.artifacts_hash = currentArtifactsHash;
      plan.recommendation_receipt.hash = hashReceipt(plan.recommendation_receipt);
    }
    delete plan.hash;
    plan.artifacts_hash = currentArtifactsHash;
    plan.hash = hashPlan(plan);
    // revision 不变，但身份含 hash，因此 plan-scoped 目录搬移到新 identity。
    const migratedIdentity = getPlanScopedPaths(changeDir, plan);

    // 决策 4：overlay 是迁移循环的第一项——更新 artifacts_hash 并重算封印。
    const overlayPath = getOverlayPaths(changeDir).executionRecommendation;
    if (existsSync(overlayPath)) {
      let overlay;
      try {
        overlay = JSON.parse(readFileSync(overlayPath, 'utf8'));
      } catch (error) {
        throw new Error(`Unable to read execution recommendation overlay for resync: ${error.message}`);
      }
      if (isObject(overlay)) {
        overlay.artifacts_hash = currentArtifactsHash;
        overlay.hash = hashReceipt(overlay);
        writeWithUndo(overlayPath, `${JSON.stringify(overlay, null, 2)}\n`);
      }
    }

    // 逐项迁移 root reviews + plan-scoped reviews（读旧→改写→写→记撤销），
    // 并在新身份目录补齐目标副本。
    migrateReceiptsPlanHashWithUndo(
      [getOverlayPaths(changeDir).reviews, previousIdentity.reviews],
      new Set([getOverlayPaths(changeDir).reviews, migratedIdentity.reviews]),
      writeWithUndo,
      plan,
      previousPlan.hash,
    );
    // Validate and migrate adjudications while their referenced repair-state
    // chain is still available under the previous plan identity.
    migratePlanScopedEvidenceDirectoryWithUndo(
      previousIdentity.adjudications,
      migratedIdentity.adjudications,
      writeWithUndo,
      undoLog,
      record => migrateAdjudicationLedgerRecord(changeDir, record, previousPlan, plan),
    );
    migratePlanScopedEvidenceDirectoryWithUndo(
      previousIdentity.repairState,
      migratedIdentity.repairState,
      writeWithUndo,
      undoLog,
      record => migrateRepairStateRecord(changeDir, record, previousPlan, plan),
    );

    // Checkpoints, handoffs, and the workspace carry no plan_hash field of
    // their own: readers resolve them purely by the plan-scoped directory
    // identity. Move every remaining record subdirectory onto the resynced
    // identity; moves join the undo log as restore closures.
    migratePlanScopedDirectoryWithUndo(previousIdentity.checkpoints, migratedIdentity.checkpoints, undoLog);
    migratePlanScopedDirectoryWithUndo(previousIdentity.handoffs, migratedIdentity.handoffs, undoLog);
    migratePlanScopedDirectoryWithUndo(previousIdentity.workspace, migratedIdentity.workspace, undoLog);
    removeDirIfEmpty(previousIdentity.planRoot);

    // 决策 2：plan 文件收尾——plan 未动 = 系统仍处原始 stale 态的判据始终成立。
    // C1：plan 与 state summary 两个尾部写入也纳入撤销保护——旧内容读自磁盘
    // （写前必读），后续任何失败都按 undoLog 逆序恢复为 resync 前内容，杜绝
    // "plan 已落新 hash 而 receipts/overlay 恢复旧值"的死锁复发状态。
    writeWithUndo(getOverlayPaths(changeDir).executionPlan, `${JSON.stringify(plan, null, 2)}\n`);
    const summaryPath = join(changeDir, '.spec-superflow.yaml');
    const previousSummaryContent = existsSync(summaryPath) ? readFileSync(summaryPath, 'utf8') : null;
    writeExecutionPlanSummary(changeDir, plan);
    undoLog.push({ path: summaryPath, previousContent: previousSummaryContent });

    // 取舍声明（review-findings-fix C1）：progress.md 是 append 型审计日志，其
    // 追加失败不回滚已成功的 plan/summary 迁移——审计日志缺少一行不影响 plan 与
    // receipts 的一致性（收尾锚点不变式只依赖前序写入），故仅告警不中断。
    try {
      appendProgressAudit(changeDir, [
        '## Execution Plan Resync',
        `- recorded_at: ${new Date().toISOString()}`,
        `- reason: ${reason}`,
        `- previous_artifacts_hash: ${previousArtifactsHash}`,
        `- artifacts_hash: ${currentArtifactsHash}`,
        `- plan_hash: ${plan.hash}`,
        `- plan_revision: ${plan.revision}`,
      ]);
    } catch (auditError) {
      process.stderr.write(`WARN: resync 完成但 progress.md 审计追加失败（append-only 审计缺一行，不回滚）：${auditError.message}\n`);
    }
    return readPlan(changeDir);
  } catch (error) {
    try {
      restoreUndoLog(undoLog);
    } catch (restoreError) {
      // M2：原始错误在前，恢复失败清单追加在后，不顶替根因。
      error.message = `${error.message}; ${restoreError.message}`;
    }
    throw error;
  }
}

// 按 undoLog 逆序恢复：文件项写回旧内容（或删除新增文件），目录搬移项调用
// restore 闭包。单个恢复动作失败不静默——聚合进清单后抛出复合错误。
function restoreUndoLog(undoLog) {
  const restorationFailures = [];
  for (const entry of [...undoLog].reverse()) {
    try {
      if (typeof entry.restore === 'function') {
        entry.restore();
      } else if (entry.previousContent === null) {
        if (existsSync(entry.path)) rmSync(entry.path, { force: true });
      } else {
        atomicWrite(entry.path, entry.previousContent);
      }
    } catch (undoError) {
      restorationFailures.push(`${entry.path}: ${undoError.message}`);
    }
  }
  if (restorationFailures.length > 0) {
    throw new Error(`resync rollback restoration failures (${restorationFailures.join('; ')})`);
  }
}

// 与旧版 migrateReceiptsPlanHash 相同的收敛逻辑，但每次写入经 writeWithUndo
// 记入撤销日志。文件旧的 JSON 解析失败则跳过（与既有行为一致）。
function migrateReceiptsPlanHashWithUndo(sourceDirectories, targetDirectories, writeWithUndo, plan, previousPlanHash) {
  const targets = new Set(targetDirectories);
  for (const directory of sourceDirectories) {
    if (!existsSync(directory)) continue;
    for (const fileName of readdirSync(directory).filter(name => name.endsWith('.json'))) {
      let record;
      try {
        record = JSON.parse(readFileSync(join(directory, fileName), 'utf8'));
      } catch {
        continue;
      }
      if (!isObject(record) || record.plan_revision !== plan.revision || record.plan_hash !== previousPlanHash) continue;
      record.plan_hash = plan.hash;
      const serialized = `${JSON.stringify(record, null, 2)}\n`;
      writeWithUndo(join(directory, fileName), serialized);
      for (const target of targets) {
        if (target === directory) continue;
        mkdirSync(target, { recursive: true });
        // 新身份下的目标副本同样注册撤销（C2）：迁移中途失败时副本一并回滚，
        // 不残留指向新 plan_hash 的孤儿文件。
        writeWithUndo(join(target, fileName), serialized);
      }
    }
  }
}

/** 迁移一个 plan-scoped 证据目录：逐条改写记录后经目录搬移落到新身份。 */
function migratePlanScopedEvidenceDirectoryWithUndo(source, target, writeWithUndo, undoLog, migrateRecord) {
  if (!existsSync(source)) return;
  for (const fileName of readdirSync(source).filter(name => name.endsWith('.json'))) {
    const filePath = join(source, fileName);
    let record;
    try {
      record = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (error) {
      throw new Error(`Unable to migrate plan-scoped evidence '${filePath}': ${error.message}`);
    }
    const migrated = migrateRecord(record);
    writeWithUndo(filePath, `${JSON.stringify(migrated, null, 2)}\n`);
  }
  migratePlanScopedDirectoryWithUndo(source, target, undoLog);
}

/** 校验并将 repair state 记录的 plan_hash 改写为新 plan 身份。 */
function migrateRepairStateRecord(changeDir, record, previousPlan, nextPlan) {
  if (!isObject(record) || record.plan_hash !== previousPlan.hash
    || record.plan_revision !== previousPlan.revision || !isNonEmptyText(record.wave_id)) {
    throw new Error('Repair state cannot be resynced because its plan or wave identity is invalid');
  }
  validateRepairStateEvidence(changeDir, previousPlan, record.wave_id, record);
  const migrated = structuredClone(record);
  migrated.plan_hash = nextPlan.hash;
  for (const failure of migrated.failures) failure.plan_hash = nextPlan.hash;
  if (isObject(migrated.resolution)) migrated.resolution.plan_hash = nextPlan.hash;
  return migrated;
}

/** 校验并将 adjudication 台账记录的 plan_hash 改写为新 plan 身份。 */
function migrateAdjudicationLedgerRecord(changeDir, record, previousPlan, nextPlan) {
  if (!isObject(record) || record.plan_hash !== previousPlan.hash
    || record.plan_revision !== previousPlan.revision || !isNonEmptyText(record.wave_id)) {
    throw new Error('Adjudication ledger cannot be resynced because its plan or wave identity is invalid');
  }
  validateAdjudicationLedgerEvidence(changeDir, previousPlan, record.wave_id, record);
  const migrated = structuredClone(record);
  migrated.plan_hash = nextPlan.hash;
  for (const adjudication of migrated.adjudications) {
    adjudication.failed_receipt.plan_hash = nextPlan.hash;
    if (isObject(adjudication.review)) adjudication.review.plan_hash = nextPlan.hash;
  }
  return migrated;
}

// Moves one plan-scoped record directory (checkpoints/handoffs/workspace) onto
// the resynced identity. These records contain no plan_hash fields, so a whole
// directory move preserves them exactly as recorded. Each completed move is
// recorded in the undo log as {path, previousContent: null, restore} so the
// catch-side replay can restore the pre-move layout.
function migratePlanScopedDirectoryWithUndo(source, target, undoLog) {
  if (!existsSync(source)) return;
  if (existsSync(target)) {
    const entries = readdirSync(source, { withFileTypes: true });
    const collision = entries.find(entry => existsSync(join(target, entry.name)));
    if (collision) {
      throw new Error(`Plan-scoped migration target already contains '${collision.name}'; refusing a destructive collision`);
    }
    const movedEntries = [];
    // Register rollback before the first move. If any later rename fails, the
    // catch-side replay can restore every entry that was already moved.
    undoLog.push({
      path: target,
      previousContent: null,
      restore: () => {
        mkdirSync(source, { recursive: true });
        for (const moved of [...movedEntries].reverse()) {
          if (existsSync(moved.from)) renameSync(moved.from, moved.to);
        }
      },
    });
    for (const entry of entries) {
      const destination = join(target, entry.name);
      renameSync(join(source, entry.name), destination);
      movedEntries.push({ from: destination, to: join(source, entry.name) });
    }
  } else {
    mkdirSync(dirname(target), { recursive: true });
    renameSync(source, target);
    undoLog.push({
      path: target,
      previousContent: null,
      restore: () => {
        mkdirSync(dirname(source), { recursive: true });
        renameSync(target, source);
      },
    });
  }
}

/** 尽力删除空目录；残留空目录无害，失败静默忽略。 */
function removeDirIfEmpty(directory) {
  try {
    if (existsSync(directory) && readdirSync(directory).length === 0) rmSync(directory, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup only; leftover empty directories are harmless.
  }
}

/** 向 progress.md 追加一段审计记录。 */
function appendProgressAudit(changeDir, lines) {
  const progressPath = join(changeDir, '.superpowers', 'sdd', 'progress.md');
  mkdirSync(dirname(progressPath), { recursive: true });
  appendFileSync(progressPath, `${lines.join('\n')}\n`);
}
