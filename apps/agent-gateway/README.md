# @god-view/agent-gateway

## 职责

回答一个问题：**Agent 如何调用 God View 协议。**

Gateway 只做能力发现、调用和协议转换，不包含领域决策，也**不持有图状态**：它把事件原子地写入工作区收件箱，由扩展侧的单写者状态引擎归约。这样 Agent、CLI 和扩展三方不会并发写同一份日志。

## 两条接入路径

| 路径                   | 用途                                                                             |
| ---------------------- | -------------------------------------------------------------------------------- |
| `god-view serve`       | MCP stdio server，供支持 MCP 的 Agent（Codex / Claude Code）直接调用             |
| `god-view emit <file>` | 兜底路径：把 JSON / JSONL 事件文件投递到收件箱，供无法被插件主动调用的工作流使用 |

两条路径共用同一个 `GatewaySession`，因此协议语义完全一致。

## 工具

| 工具                                                            | 说明                             | 授权语义                      |
| --------------------------------------------------------------- | -------------------------------- | ----------------------------- |
| `get_map`                                                       | 读取地图、讲解、标注、请求和方案 | 只读                          |
| `begin_change` / `upsert_node` / `upsert_edge` / `upsert_story` | 声明任务、结构与讲解             | 写地图，不写用户代码          |
| `answer_annotation`                                             | 提交解释、证据与可选讲解         | 只读解释，不授予代码写权限    |
| `request_write_access` / `propose_change`                       | 申请入口和待审批方案             | 不创建可写 ChangeSet          |
| `start_approved_change`                                         | 使用用户签发的限时批准令牌启动   | monitored，不是强制沙箱       |
| `request_scope_expansion`                                       | 写入新路径前申请并等待用户决定   | 不自行授权、不修改代码        |
| `remove_node` / `remove_edge` / `complete_change`               | 更新结构墓碑并如实结束任务       | 写地图；代码由宿主 Agent 修改 |

Gateway 不提供任意“写文件”工具。批准后的代码修改仍由用户已启动的 Codex/Claude
宿主完成；扩展通过 Git/文件变化监控范围、生成不含源码正文的 Diff 摘要并交给用户验收。

## 运行时布局

```
<workspace>/.godview/
 ├─ session.json   扩展写入：workspaceId、branchKey、协议版本
 ├─ map.json       扩展发布的只读地图读模型，供 get_map 使用
 └─ inbox/         Gateway 写入、扩展消费的事件文件
```

事件投递使用临时文件 → `fsync` → `rename`，扩展只会读到完整文件，不会读到半写内容。

`.godview/` 默认不进入 Git（见仓库根 `.gitignore`）。

## 幂等

事件 ID 由 `sessionId` 与 `idempotencyKey` 推导。Agent 用同一个 key 重试时得到同一个事件 ID，状态引擎据此识别为重复事件而不是新节点。

## 能力声明

Codex、Claude Code 和通用 MCP 均有独立来源 ID；两个正式 Adapter 通过同一组完整
MCP 契约测试。能力如实声明为：不能被插件主动调用、支持 MCP、权限是 `monitored`、
不支持托管任务取消/流式、无法确认宿主数据去向时按“可能发送到云端”处理。

## 依赖方向

`agent-gateway ──→ protocol`，并复用 `storage` 的原子写工具，避免两处各自实现 `fsync + rename`（已在 `.dependency-cruiser.cjs` 中显式允许）。

## 测试

```bash
npx vitest run apps/agent-gateway
```
