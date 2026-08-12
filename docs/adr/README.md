# 架构决策记录

记录重要技术选择及其取舍。新决策从 [0000-template.md](./0000-template.md) 复制。

需要写 ADR 的变化：架构边界、协议真源、存储格式、权限模型、核心依赖。

| 编号                                                      | 决策                                                     | 状态     |
| --------------------------------------------------------- | -------------------------------------------------------- | -------- |
| [0001](./0001-json-schema-as-protocol-source-of-truth.md) | 以 JSON Schema 为协议真源，类型与工具 Schema 由它生成    | Accepted |
| [0002](./0002-event-sourced-single-writer-state.md)       | 事件日志 + 快照的单写者状态引擎，按 workspace 与分支隔离 | Accepted |
| [0003](./0003-webview-rendering-stack.md)                 | Webview 用 React + Cytoscape，自研确定性布局跑在 Worker  | Accepted |
| [0004](./0004-mcp-stdio-with-inbox-fallback.md)           | Agent 传输以 MCP stdio 为主，事件收件箱兜底              | Accepted |
