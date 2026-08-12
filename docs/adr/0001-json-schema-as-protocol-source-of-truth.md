# ADR-0001：以 JSON Schema 作为协议真源，TypeScript 类型与工具 Schema 由它生成

> 状态：Accepted
> 日期：2026-08-11
> 决策者：God View 工程团队

## 背景

God View 的协议同时被四类消费者使用：

- 扩展侧状态引擎（需要运行时校验不可信输入）；
- Agent Gateway（需要把工具入参 Schema 交给 MCP 客户端）；
- Webview（需要类型，但不应为消息校验引入完整 JSON Schema 运行时）；
- 测试与 fixtures（需要构造合法样例）。

事件与工具入参来自 Agent，属于不可信输入，必须在进入业务逻辑前校验。如果类型和
校验规则分别手写，两者会各自演进：类型说字段可选、Schema 说必填，最终以谁为准无法回答。

## 决策

`packages/protocol/schema/*.schema.json` 是唯一真源。由
`packages/protocol/scripts/generate-types.mts` 生成：

- `generated/protocol-types.ts`：TypeScript 类型；
- `generated/schemas.ts`：Ajv 运行时校验用的 Schema；
- `generated/tool-schemas.ts`：MCP 工具入参 Schema。

生成物提交进仓库，并由 CI 的 `generated-files-check` 保证与真源一致。手工修改生成文件
等同于修改失败。

## 候选方案

### 方案 A：JSON Schema 真源 + 代码生成（已选）

- 优点：一份定义同时满足运行时校验与静态类型；工具 Schema 可直接交给 MCP；跨语言可移植。
- 缺点：需要维护生成脚本；生成物需要提交并做一致性检查。
- 风险：JSON Schema 的表达力与 TypeScript 不完全对齐，复杂联合类型的生成结果可能不理想。

### 方案 B：Zod 真源，推导类型与 JSON Schema

- 优点：开发体验好，类型推导天然一致。
- 缺点：真源变成 TypeScript 代码，其他语言的 Agent 实现无法直接消费；导出的 JSON Schema
  受 Zod 版本影响。
- 风险：MCP SDK 的高层 API 绑定 Zod，会把协议真源与某个 SDK 版本耦合。

### 方案 C：手写类型 + 手写 Ajv Schema

- 优点：无构建步骤。
- 缺点：两份定义必然漂移。
- 风险：漂移的方向通常是「校验比类型宽松」，即不可信输入绕过校验。

## 选择理由

协议要跨进程、跨语言使用：Agent 可能不是 TypeScript 写的。JSON Schema 是这些消费者的
最大公约数。方案 B 的开发体验优势不足以抵消把真源锁进一门语言和一个 SDK 版本的代价。

## 影响

- 正面：类型与校验不可能不一致；MCP 工具 Schema 无需第二份定义。
- 负面：新增字段需要跑一次 `pnpm run generate`，比直接改类型多一步。
- 安全：所有入站消息强制经过 Ajv 校验，未知事件类型返回 `UNSUPPORTED_EVENT_TYPE` 而不是
  静默接受。
- 性能：Webview 不加载 Ajv，改用 `packages/webview-bridge` 的手写解析器，代价是那份解析器
  的每条分支都必须有契约测试。

## 实施与迁移

已实施。协议变更流程：改 `schema/*.schema.json` → `pnpm run generate` → 补兼容性测试 →
按 §6.2 判断是 minor 还是 major。

## 验证标准

- `pnpm run generated-files-check` 在 CI 中通过；
- `packages/protocol` 的行覆盖率 ≥ 95%；
- 新增可选字段不破坏既有快照的回放测试。

## 回滚方案

生成脚本不可用时，可临时手工维护生成物；但一致性检查会失败，因此必须在同一个 PR 内修复
脚本，不允许长期并存。

## 关联

- 技术架构：§6.1 真源与生成物、§6.2 版本策略
- 相关 ADR：[ADR-0004](./0004-mcp-stdio-with-inbox-fallback.md)
