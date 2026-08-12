# @god-view/protocol

## 职责

God View 与 Agent、Webview、存储之间的**协议真源**。回答一个问题：一条外部数据是否是合法的 God View 协议数据。

- `schema/*.schema.json` 是唯一真源；
- `src/generated/**` 由 `pnpm run generate` 从 Schema 生成，**禁止手工修改**；
- 运行时使用 Ajv（draft 2020-12）校验所有入站数据。

## 公开 API

| 导出                                                      | 用途                                                     |
| --------------------------------------------------------- | -------------------------------------------------------- |
| `createProtocolValidator()`                               | 复用校验器：事件、快照、工具入参与 Adapter 能力          |
| `errorCodes` / `protocolError`                            | 稳定错误码，属于协议兼容面                               |
| `Result` / `ok` / `err` / `assertNever`                   | 领域统一的成功失败结果类型                               |
| `parseNodeId` 等                                          | branded ID 解析，避免 `NodeId`/`EdgeId`/`SessionId` 混用 |
| `isProtocolVersionSupported` / `negotiateProtocolVersion` | `major.minor` 版本协商                                   |
| 各类协议类型                                              | 由 Schema 生成                                           |

## 依赖方向

`protocol` 不依赖任何 God View 业务包，也不依赖 `vscode`、DOM、Git 或具体存储实现。

## 关键约束

1. **Agent 不能声明插件拥有的状态。** `AgentNodeDeclaration` / `AgentEdgeDeclaration` 使用 `additionalProperties: false`，因此 `codeValidation`、`userConfirmation`、`coverage`、`lifecycle`、`source` 无法由 Agent 提交，只能由 Validator、用户操作和 Inventory 产生。
2. **路径必须是工作区相对路径。** `WorkspacePath` 拒绝绝对路径、UNC 路径和 `..` 穿越。
3. **保留事件类型不静默接受。** `unexpected_write`、`change_conflicted` 等尚未实现的独立事件返回 `UNSUPPORTED_EVENT_TYPE`；已实现的解释、方案、观察和验收事件进入状态机。
4. **快照使用按 id 排序的数组**而不是对象字典，保证同一事件序列回放得到字节等价的序列化结果。
5. **讲解是声明式数据。** `story_upsert` / `upsert_story` 只接受实体 ID、步骤、短文案与镜头建议，不能携带 HTML、CSS 或脚本。
6. **用户权威事件不可由 Agent 冒充。** 批准、拒绝和结果验收只有 `actor.kind=user` 才能归约；Diff 观察只有扩展系统身份可发布。

## 开发

```bash
pnpm --filter @god-view/protocol run generate   # 从 Schema 重新生成类型与运行时 schema 模块
pnpm --filter @god-view/protocol run build      # tsc --build
npx vitest run packages/protocol                # 契约测试
```

修改 Schema 后必须在同一个 PR 内更新生成物、样例和契约测试；CI 的 `generated-files-check` 会重新生成并比对差异。
