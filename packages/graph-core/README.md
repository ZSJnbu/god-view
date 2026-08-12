# @god-view/graph-core

## 职责

回答一个问题：**事件如何改变图状态。**

纯函数包。不依赖 `vscode`、DOM、Git、文件系统、渲染库或具体存储实现；时间、ID 与 I/O 全部由调用方在命令处理层生成后传入。

## 公开 API

| 导出                                                                                     | 用途                                                      |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `reduce(snapshot, event)`                                                                | 确定性事件归约，返回 `Result<GraphSnapshot, DomainError>` |
| `replay(initial, events)`                                                                | 批量回放；单个事件被拒绝不会中断整体回放                  |
| `createEmptySnapshot` / `toSnapshotDocument` / `fromSnapshotDocument`                    | 进程内 Map 形态与持久化排序数组形态的互转                 |
| `canonicalize` / `hashSnapshot`                                                          | 稳定序列化与内容哈希，用于回放确定性断言                  |
| `computeCoverage(inventory, snapshot, at)`                                               | 以插件侧第一方文件清单为分母计算覆盖率                    |
| `listRootNodes` / `listChildren` / `getNeighborhood` / `searchNodes` / `findNodesByPath` | 概览、下钻、聚焦与搜索查询                                |

## 关键不变量

1. **幂等。** 已应用过的 `eventId` 再次到达时返回原快照，不产生重复实体也不推进版本。
2. **三个维度独立。** `source`（声明来源）、`codeValidation`（代码证据）、`userConfirmation`（用户确认）分别记录；声明内容变化会把 `codeValidation` 重置为 `unverified`，但不影响用户确认。
3. **稳定 ID。** 用户确认过的模块，Agent 不能删除，也不能改变其实体类型；只能更新名称、职责和边界。
4. **过期基线。** 事件显式携带 `baseMapRevision` 且目标实体已在更高版本被更新时，返回 `STALE_MAP_REVISION`，不静默覆盖。
5. **墓碑。** 删除只标记 `lifecycle.status = 'removed'` 并级联标记相关关系，保留实体以便标注、讲解步骤和历史事件继续通过稳定 ID 追溯。
6. **单写变更。** 同一时间只允许一个进行中的 ChangeSet；重复 `change_start` 视为重试。
7. **失败不回滚。** `change_complete` 的 `failed`/`interrupted` 把触及实体标记为 `failed` 并保留结构，不自动删除。
8. **确定性。** 持久化时所有集合按 id 字典序排序，因此相同事件序列在任何机器上得到相同的快照哈希。

## 依赖方向

`graph-core ──→ protocol`。反向依赖与任何 I/O 依赖由 `.dependency-cruiser.cjs` 的 `graph-core-no-io` 规则阻止。

## 测试

```bash
npx vitest run packages/graph-core
```

`src/events.test-utils.ts` 提供确定性事件构造器：时间戳与事件 ID 按调用顺序生成，测试不依赖真实时钟。
