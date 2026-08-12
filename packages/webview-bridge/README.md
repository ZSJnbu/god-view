# @god-view/webview-bridge

## 职责

回答一个问题：**扩展与 Webview 之间允许交换哪些消息，如何在边界解析它们。**

Command 与 Event 分离：Webview 只能发送命令（`WebviewCommand`），由扩展侧领域层验证后产生事实（`ExtensionEvent`）。Webview 不得伪造领域事件。

## 消息

| 方向           | 消息                        | 说明                                             |
| -------------- | --------------------------- | ------------------------------------------------ |
| 扩展 → Webview | `map/snapshot`              | 全量快照 + 能力 + 覆盖率 + 漂移 + 用户布局       |
| 扩展 → Webview | `map/patch`                 | 增量补丁，避免每个事件都复制整张大图             |
| 扩展 → Webview | `status`                    | `idle` / `receiving` / `validating` / `degraded` |
| 扩展 → Webview | `error`                     | 稳定错误码 + 可读消息                            |
| Webview → 扩展 | `ready` / `requestSnapshot` | 生命周期                                         |
| Webview → 扩展 | `openSource`                | 从节点跳回源码                                   |
| Webview → 扩展 | `saveLayout`                | 持久化用户手动布局                               |

`ViewCapabilities` 让 UI 明确禁用而不是伪装可用：无 Git 时 `hasGit=false`；当前没有由扩展主动调用 Agent 的执行器，因此 `canExecuteChanges=false`。方案审批和结果验收通过独立命令完成。

## 为什么使用手写解析器而不是 Ajv

Webview bundle 不应为消息校验引入完整 JSON Schema 运行时。作为代价，`parse.ts` 的每条分支都有契约测试覆盖，未知命令一律拒绝而不是宽松忽略。地图数据本身在扩展侧已由 `@god-view/protocol` 的 Ajv 校验器验证。

## 依赖方向

`webview-bridge ──→ protocol`。不导入 `vscode`、React 或渲染库。

## 测试

```bash
npx vitest run packages/webview-bridge
```
