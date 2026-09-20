# 执行合同

## Intent Lock

- **变更名称**：
- **要解决的问题**：
- **范围内**：
- **范围外**：

## Approved Behavior

- **已批准需求摘要**：
- **关键场景**：
- **验收检查**：

## Design Constraints

- **架构约束**：
- **接口约束**：
- **依赖约束**：
- **数据约束**：

## Execution Plan

full/hotfix 先运行 `ssf execution recommend`，按任务量和 wave 策略列出可用方式并
推荐一种，同时保存匹配当前 wave 的 recommendation receipt。Agent 展示候选项和理由，
`plan` 和 `revise` 均只接受仍匹配 artifact、contract 和 wave 的凭据；用户通过 `--confirm` 明确确认；选择非推荐方式时
还必须记录 `--acknowledge-recommendation`。Batch Inline 是串行模式，不得描述为并行。批准后，
`ssf execution plan` 会把当前执行计划保存到
`<change>/.superpowers/sdd/execution-plan.json`；该 JSON 是计划的持久化控制面，
不是本 execution contract 的一部分。

## Execution Waves

每个 wave 必须有唯一 ID；只有依赖 wave 的 review receipt 为 `pass` 后，后续
wave 才可以开始。`parallel` 只表示允许在宿主支持并发派发时同时执行；不支持并发时
必须明确报告该能力不可用，而不能把 `parallel` 计划悄然改写成串行执行。

### Wave 1

- **Wave ID**：
- **任务**：
- **依赖 wave**：无
- **策略**：`parallel` | `serial`
- **目标**：
- **输入**：
- **输出**：
- **完成标准**：
- **Review gate**：review report 路径、base/head SHA、review receipt（`pass` | `fail`）

### Wave 2

- **Wave ID**：
- **任务**：
- **依赖 wave**：
- **策略**：`parallel` | `serial`
- **目标**：
- **输入**：
- **输出**：
- **完成标准**：
- **Review gate**：review report 路径、base/head SHA、review receipt（`pass` | `fail`）

## Test Obligations

- **必须先从失败测试开始的行为**：
- **必需的边界情况**：
- **回归敏感区域**：

## Quality Gates

本节是验收前提：**达标结果与达标方式同等重要**。检查失败时，本节硬约束优先于任何「让检查变绿」的便利做法。

- **必须通过的检查**：（lint / 类型检查 / 测试套件 / 覆盖率下限 / 依赖审计 / 构建——按项目实际列明，并写明阈值）
- **检查放置**：本地（提交前）/ CI / 评审——逐项标注每项检查在哪一层执行
- **既有基线**：本次变更不得降低任何既有门槛（阈值、规则集、有效用例数）

**安全基线（每次变更固定适用）**

- **凭据扫描**：提交内容不得包含凭据、令牌、API key、私钥。检查方式为搜索本次 diff 中的敏感值形状，并确认配置与密钥存放于版本控制之外。
- **依赖审计**：本次新增的每个依赖在合并前必须完成已知漏洞检查——运行本生态的审计命令（`npm audit`、`pip-audit`、`cargo audit`、`govulncheck` 等），或记录人工核查结论。

项目缺少对应工具时，按反规避第 5 条如实记录「未覆盖」并写明所用手工替代手段，不得以「无需检查」代替通过结论。

**反规避条款（硬约束）**

1. 检查失败时，只允许修改被检查的对象（代码）；不得修改检查本身——测试用例、断言、lint 规则、类型配置、CI 配置均在此列。
2. 确需调整检查标准时，必须先停下来取得用户同意，并在本契约中记录调整理由与影响面。
3. `--no-verify`、`@ts-ignore`、`eslint-disable`、跳过用例（`skip` / `todo` / `only`）等绕过动作，必须显式声明并获批准后才可执行。
4. 不得删除、弱化既有测试，或降低断言强度，以此达成「通过」。
5. 某项检查缺失或未执行时，如实报告「未覆盖」；不得以「无需检查」代替通过结论。

## Execution Mode

- **可用方式与推荐**：`ssf execution recommend <change-dir> [--wave <id>:<parallel|serial>:<task,...>[:<depends-on,...>]]`
- **用户确认的模式**：`sdd` | `inline` | `batch-inline`
- **推荐理由 / 项目事实**：
- **非推荐选择的风险确认**：`--acknowledge-recommendation`（若适用）
- **执行计划命令**：`ssf execution plan <change-dir> --mode <mode> --confirm --reason <text> --wave <id>:<parallel|serial>:<task,...>[:<depends-on,...>] [--acknowledge-recommendation]`
- **允许的修订**：将已有计划保留/升级为 `sdd`；先重新 recommend，并以 `--confirm` 生成新 revision 和清除旧 receipt；不允许降级：`ssf execution revise <change-dir> --mode sdd --confirm --reason <text> --wave <id>:<parallel|serial>:<task,...>[:<depends-on,...>] [--acknowledge-recommendation]`
- **计划 revision / artifact hash**：

## Verification Dimensions

| 维度 | 状态 | 发现 |
|------|------|------|
| Completeness | Pending | — |
| Correctness | Pending | — |
| Coherence | Pending | — |

**总体结论**：Pending

## Review Gates

- **强制审查点**：每个 Execution Wave 完成后记录 `ssf execution review` 的 review receipt
- **阻塞类别**：依赖未通过、review receipt 为 `fail`、缺失或过期
- **收口条件**：所有当前 wave 都有 `pass` review receipt

## Escalation Rules

- **何时回退到 `specifying`**：
- **何时回退到 `bridging`**：
- **何时不得继续实现**：
