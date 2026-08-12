/**
 * `@god-view/testkit` 的唯一公开入口。
 *
 * 仅供测试使用的 fixtures、事件构造器与确定性工具。
 * 只依赖 `protocol`，因此任何包都可以在测试中安全引用它而不产生包循环。
 */
export {
  branchKey,
  annotationAnswer,
  annotationCreate,
  annotationResolve,
  changeComplete,
  changeStart,
  edge,
  edgeRemove,
  edgeUpsert,
  node,
  nodeRemove,
  nodeUpsert,
  resetEventSequence,
  sessionEnd,
  sessionStart,
  storyUpsert,
  sessionId,
  workspaceId,
} from './event-builders.js';

export { createDeterministicClock, createSequentialIds } from './deterministic.js';
export type { DeterministicClock } from './deterministic.js';

export { sampleProjectEvents } from './sample-project.js';
