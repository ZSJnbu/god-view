# @god-view/storage

## 职责

回答一个问题：**图状态如何持久化、恢复和隔离损坏数据。**

MVP 使用「只追加 JSONL 事件日志 + 周期 JSON 快照」，按 `workspace identity + Git branch key` 隔离。

原始事件默认保留 30 天。分支打开时，仓库先原子写入当前结构快照，再把过期日志行压缩为空行；
原序号水位保留，确保崩溃前后的快照与后续追加不会错位。已解决且未固定的旧标注只保留一条
本地清理说明，未解决或固定标注不自动清理。压缩后当前地图依赖有效快照，因此发布与升级前
仍应按回滚文档备份整个工作区存储目录，不能只备份单个日志文件。

## 公开 API

| 导出                                          | 用途                                                   |
| --------------------------------------------- | ------------------------------------------------------ |
| `GraphRepository.open(options)`               | 打开某个 workspace/branch 的图状态；返回仓库与恢复报告 |
| `repository.append(event)`                    | 归约 + 持久化，写入串行化                              |
| `repository.flush()`                          | 主动落快照，例如扩展停用前                             |
| `FileEventLog` / `FileSnapshotStore`          | 生产实现                                               |
| `MemoryEventLog` / `MemorySnapshotStore`      | 测试替身                                               |
| `resolveBranchStorage` / `toDirectorySegment` | 存储布局与路径安全                                     |
| `writeFileAtomic` / `appendLineDurable`       | 原子写与持久化追加                                     |

## 关键行为

1. **先归约再落盘。** 被领域规则拒绝的事件不进入规范日志，否则每次启动回放都会重放同一条错误。
2. **幂等事件不重复写入。** 重复 `eventId` 既不改变状态也不追加日志行。
3. **原子写。** 快照走临时文件 → `fsync` → `rename`；事件追加后 `fsync`，确认写入才对 Agent 返回 accepted。
4. **损坏隔离。** 无法解析或不符合协议的日志行进入 `quarantine.jsonl`，只记录序号与原因（不复制可能含敏感内容的原始行），其余事件继续可用。
5. **快照校验。** 读取时重算内容哈希；不匹配、半写或不属于当前 workspace/branch 时返回 `undefined`，退化为完整回放，而不是拒绝启动。
6. **单写者。** 所有 `append` 通过一条写链串行；单次失败不阻塞后续写入。
7. **路径安全。** 分支名中的 `/`、`..` 和非 ASCII 字符被清洗为单段目录名，并附加短哈希避免清洗后碰撞。

## 依赖方向

`storage ──→ graph-core ──→ protocol`。

## 测试

```bash
npx vitest run packages/storage
```

文件相关测试使用 `mkdtemp` 建立临时目录并在 `afterEach` 清理，不写入用户目录。
