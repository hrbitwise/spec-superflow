# spec-superflow v2.2.0 | opt-in
仅当用户明确要求 spec-superflow，或用户要求继续的活动 change 含 `.spec-superflow.yaml` 时进入 `workflow-start`。普通任务不应用本工作流；proposal、spec、design、tasks、contract 等通用文件不是触发信号。

收到可能涉及写代码、修 bug、新建或继续 change 的请求时，先给出是否进入 `workflow-start` 的建议与理由，由用户抉择后再路由；纯问答、只读分析与信息检索可直接处理。用户未抉择前不开始写代码；契约、执行计划与审查收据门禁在任何路径上都保持不变。
