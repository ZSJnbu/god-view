# @god-view/testkit

## 职责

仅供测试使用的 fixtures、事件构造器与确定性工具。

**只依赖 `@god-view/protocol`**，因此任何包都可以在测试中引用它而不产生包循环。

## 公开 API

| 导出                                                             | 用途                                                      |
| ---------------------------------------------------------------- | --------------------------------------------------------- |
| `sessionStart` / `changeStart` / `nodeUpsert` / `edgeUpsert` / … | 事件构造器；`eventId` 与 `timestamp` 按调用顺序确定性生成 |
| `resetEventSequence()`                                           | 在 `beforeEach` 中重置序号，使断言可预测                  |
| `sampleProjectEvents()`                                          | 一个覆盖「入口—核心—数据/外部」的小型示例项目事件序列     |
| `createDeterministicClock()`                                     | 可推进的假时钟，替代 `Date.now()`                         |
| `createSequentialIds(prefix)`                                    | 顺序 ID 生成器，替代 UUID                                 |

## 使用约定

- 测试不得使用真实时钟、随机数、网络、用户目录或真实 Agent 账号；
- 需要时间推进的测试使用 `clock.advance(seconds)`，不使用 `setTimeout` 碰运气；
- 本包不参与覆盖率统计（见根 `vitest.config.ts` 的 `coverage.exclude`）。

## 测试

`sampleProjectEvents()` 的可归约性由 `packages/graph-core` 的测试断言：示例数据必须始终能被 reducer 完整接受，否则任何依赖它的测试都会失去意义。
