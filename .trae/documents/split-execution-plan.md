# 拆分 execution-plan.mjs（69KB 巨石 → 8 个模块）

## Context

`scripts/lib/execution-plan.mjs` 约 1440 行、60 个函数，混杂 6 类职责（plan CRUD、校验、review/repair、adjudication、resync 迁移、git 隔离校验），是全仓库最大的单文件，审查和修改成本高。本次做**纯搬运式拆分**：不改任何行为、不改错误消息文本，仅按职责切分模块；保留 `execution-plan.mjs` 作为 facade re-export 全部 12 个公开 API，9 个外部消费者（cmd-execution、change-recovery、debug-attempts、2 个 guard checks、4 个测试文件）**零改动**。

## 依赖方向（严格 DAG，无环）

```
plan-shared ← plan-core ← plan-git ← plan-review ← plan-repair ← plan-adjudication ← plan-resync
                     ↑_____________ execution-plan.mjs (facade: recordReview/describeWaves) _____________↑
```

关键约束：
- `defaultGitRangeValidator` 模块级单例（现 L20）随 `createGitRangeValidator` 迁入 plan-git，不可复制
- `readCurrentReviewEvidence`/`describeWaves` 默认参数 `plan = readPlan(changeDir)` → core 必须在 review 下层，禁止反向 import
- facade 中 `export { x } from './plan-*.mjs'` 不产生局部绑定，`recordReview`/`describeWaves` 需单独 `import` 所需函数
- `isValidTimestamp`、`MAX_REPAIR_FAILURES`、`REVIEW_STATUSES` 被多簇共用 → 放 plan-shared；`PROTECTED_BRANCHES`/`FULL_COMMIT_SHA` 仅 git 用 → 留 plan-git
- `blockedDependencies`（调 `readCurrentReview`）归 plan-review，不归 git

## 目标结构（均在 scripts/lib/）

| 文件 | 内容（现行号） | 导出 |
|---|---|---|
| plan-shared.mjs | 常量 L10-19；isValidTimestamp 965；stableJson 1379；atomicWrite 1416；小谓词 isObject/isNonEmptyText/isNullableHash/requireText/safeFileName/setStateField 1408-1440 | 内部复用 |
| plan-core.mjs | createPlan 22 / readPlan 43 / writePlan 53 / validatePlan 68；validateStructure 1240；hasDependencyCycle 1347；hashPlan 1365；tryHashPlan 1370；writeExecutionPlanSummary 1393 | 公开 4 个 + hashPlan |
| plan-git.mjs | defaultGitRangeValidator 单例；validateReviewRange 1059；createGitRangeValidator 1068；defaultRunGit 1128；assertReviewHeadBranch 1139；warnIfCwdOutsideIsolation 1170；parseWorktreeEntries 1200；normalizedPath 1219；isSubpath 1229 | createGitRangeValidator、isSubpath + 内部 |
| plan-review.mjs | readCurrentReview 564；readCurrentReviewEvidence 568；reviewEvidence 714；sameReviewEvidence 820；validateStoredReviewEvidence 947；validateReviewReportEvidence 1003；getPhysicalReviewsDirectory 1035；blockedDependencies 1235 | 内部复用 + readCurrentReview |
| plan-repair.mjs | validateRepairContinuity 649；updateRepairState 670；readRepairState 732；validateRepairStateEvidence 746；describeRepairState 832 | 内部复用 |
| plan-adjudication.mjs | adjudicateWave 203；adjudicationReceiptEvidence 728；adjudicationPath 854；readAdjudicationLedger 858；validateAdjudicationLedgerEvidence 875；writeAdjudicationLedger 969；readActiveAdjudication 975；describeAdjudication 987；consumeAdjudication 993 | adjudicateWave + 内部（resync 用） |
| plan-resync.mjs | resyncPlan 266；restoreUndoLog 409；5 个 migrate* 431-544；removeDirIfEmpty 546；appendProgressAudit 554 | resyncPlan |
| execution-plan.mjs（facade） | 保留 recordReview 122、describeWaves 612（跨簇编排者）；其余 `export { … } from './plan-*.mjs'` | 12 个公开 API 不变 |

## 执行步骤（每步纯搬运 + 改 import，每步后 `npm test` 全绿再进下一步）

1. plan-shared：抽常量与谓词；execution-plan.mjs 暂改为 import 它们，其余代码不动
2. plan-git（含单例）
3. plan-core（CRUD + 结构校验 + hash + summary）
4. plan-review → 5. plan-repair → 6. plan-adjudication → 7. plan-resync（按 DAG 自底向上，每步只断一条边）
8. 收尾：facade 仅剩 recordReview/describeWaves + re-export（约 200 行）

## 易踩的坑

- 错误消息文本被测试断言，搬运时**逐字符保留**；`process.stderr/stdout` WARN 输出随原函数走
- 新文件 UTF-8 无 BOM；ESM 相对引用带 `.mjs` 扩展名
- 不做顺手重构（不改名、不调参数、不改逻辑）

## 验证

- 每步：`npm test`（须 835 通过 / 0 失败）
- 收尾：`npm test` + `npm run validate` + `npm run check-versions`
- 抽查消费者：`node scripts/spec-superflow.mjs` 相关子命令不受影响（facade 保证 import 兼容）
