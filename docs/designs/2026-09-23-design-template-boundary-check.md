# design 模板新增「边界与分层判定」节设计

> 日期：2026-09-23
> 类型：模板增强（tweak，纯文档，无代码逻辑变更）
> 影响面：`templates/design.md`、`skills/spec-writer/SKILL.md`、本文件、CHANGELOG

## 背景与目标

spec-superflow 的 design 工件回答「怎么实现」，但从不强制回答「这段逻辑应该
落在哪一层」。在内核 + 业务分层的产品（平台内核 / 行业包 / 客户定制三层）
中，缺这一道判定会产生典型腐化：为单个客户的差异直接修改通用内核、业务模
块直依赖内核实现类、跨模块直注他模块 Mapper。这类问题在 code review 阶段
才被发现时，方案往往已经写完。

本设计把「分层归属判定」前移到 design 阶段，成为与 Decisions 并列的必填
节：每个含设计阶段的变更在记录技术方案前，必须先回答归属层、判定理由、落
点、扩展方式优先级自查和禁止项自查。

目标：

- 分层错误的方案在 DP-2 之前暴露，而不是在 review 或升级内核时暴露。
- 判定节保持**产品无关**：模板只给通用的三层语义和通用禁止项，具体行业
  契约（如 wise 内核的 SPI 清单）由项目侧规则文件绑定，模板不内置任何
  特定产品的包名、接口名或仓库路径。

非目标：

- 不新增 CLI 守卫或 validator 规则。design.md 不经过 schema 校验，本变更
  只改变模板内容与 skill 的生成要求；门禁执行由 skill 流程（DP-2 盲审）
  和项目规则承担。
- 不强制 Quick、direct Hotfix、tweak 等无 design 工件的轻量路径填写。
- 不同步修改任何已归档示例（`docs/examples/`）——示例是历史快照。

## 方案选择

在 `templates/design.md` 的「目标与非目标」与「决策」之间插入固定节
`## 边界与分层判定（Boundary Check）`，含 6 个必填要点：

1. 归属层（平台内核层 / 行业包层 / 客户定制层；单仓库项目可映射为
   通用模块层 / 业务模块层 / 配置层）
2. 判定理由（三问：全产品通用？→内核层；同行业共享？→行业包层；
   单客户特化？→定制层）
3. 仓库与模块落点（含是否跨仓库、跨模块、跨前后端）
4. 扩展方式优先级自查（配置 > 低代码/配置化 > SPI 扩展点 > 新增模块
   > 改内核/通用层；说明为何上一级解决不了）
5. 禁止项自查（5 条通用反模式，命中须回退 specifying，不得进入 DP-2）
6. 契约引用（项目边界契约路径；L1 改动附对下游的影响面）

没有采用独立模板文件（如 `design-boundary.md`）的方案：分层判定是每次设
计都必须先做的一步，拆成按需资产会被跳过；放在 design 模板正文里才能被
逐字继承到每个 change。

没有把具体产品的 SPI 清单写进模板：模板被 9 个安装面、不同项目消费，内
置特定包名会立即过时并产生错误指引。产品无关的判定框架进模板，具体契约
由项目规则绑定（本次的落地项目用 `.trae/rules/project_rules.md` 绑定
wise 内核契约）。

## 影响与验证

- `skills/spec-writer/SKILL.md` 同步两处 design.md 要求（Must have 与
  Validation Checklist），确保 agent 按 skill 生成 design 时会填充新节；
  skill 行数 90 → 约 92 行，远低于 leaf 预算 210 行 / 12000 字符。
- 测试面：`token-rules.test.mjs` 的 planning document readability
  契约仅断言 design 模板包含「后果」，新节不破坏该断言；validator 只从
  design 提取 Decision 名称，不校验本节；无其他测试读取模板结构。
- 运行时副本：安装根（如 `~/.trae-cn/spec-superflow/templates/`）需随
  发版同步；本地已通过 `ssf runtime asset read templates/design.md`
  验证运行时输出包含新节。
- 验证命令：`npm run lint:skills`（或对应 lint 脚本）+
  `node --test tests/lib/token-rules.test.mjs`。

## 回滚

删除模板新节与 skill 两处同步文字即可；无数据迁移、无状态变更。
