import type { EdgeType } from '@god-view/protocol';

export const edgeTypeLabels: Readonly<Record<EdgeType | 'mixed', string>> = {
  depends_on: '依赖',
  calls: '调用',
  data_flow: '数据流',
  contains: '包含',
  reads: '读取',
  writes: '写入',
  publishes: '发布',
  mixed: '多种关系',
};
