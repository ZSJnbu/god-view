import type { GodViewEvent } from '@god-view/protocol';
import {
  changeComplete,
  changeStart,
  edge,
  edgeUpsert,
  node,
  nodeUpsert,
  resetEventSequence,
  sessionEnd,
  sessionStart,
} from './event-builders.js';

/**
 * 一个小型示例项目的完整事件序列。
 *
 * 覆盖「入口—核心—数据/外部」的默认阅读方向，用于渲染、覆盖率与端到端演示，
 * 避免每个测试各自拼装一套结构。
 */
export function sampleProjectEvents(): readonly GodViewEvent[] {
  resetEventSequence();
  const changeSetId = 'cs-init';
  return [
    sessionStart(),
    changeStart(changeSetId, '初始化项目地图'),
    nodeUpsert(
      node('group.app', {
        type: 'group',
        label: '应用',
        responsibility: '第一方业务代码',
        visualHint: { group: '核心', importance: 'primary', preferredPosition: 'core' },
      }),
      { changeSetId },
    ),
    nodeUpsert(
      node('module.api', {
        type: 'entry',
        label: 'HTTP 入口',
        responsibility: '接收并校验外部请求',
        parentId: 'group.app',
        paths: ['src/api'],
        evidence: [{ kind: 'file_exists', location: { path: 'src/api/server.ts' } }],
        visualHint: { preferredPosition: 'entry', importance: 'primary' },
      }),
      { changeSetId },
    ),
    nodeUpsert(
      node('module.orders', {
        label: '订单',
        responsibility: '下单、改单与取消',
        parentId: 'group.app',
        paths: ['src/orders'],
        visualHint: { preferredPosition: 'core', importance: 'primary' },
      }),
      { changeSetId },
    ),
    nodeUpsert(
      node('module.payment', {
        label: '支付',
        responsibility: '发起支付并处理回调',
        parentId: 'group.app',
        paths: ['src/payment'],
        uncertainties: ['退款流程是否属于本模块尚未确认'],
        visualHint: { preferredPosition: 'core' },
      }),
      { changeSetId },
    ),
    nodeUpsert(
      node('storage.postgres', {
        type: 'storage',
        label: 'Postgres',
        responsibility: '订单与支付记录持久化',
        visualHint: { preferredPosition: 'storage' },
      }),
      { changeSetId },
    ),
    nodeUpsert(
      node('external.stripe', {
        type: 'external_system',
        label: 'Stripe',
        responsibility: '第三方支付服务',
        visualHint: { preferredPosition: 'external' },
      }),
      { changeSetId },
    ),
    edgeUpsert(
      edge('e.api-orders', 'module.api', 'module.orders', {
        type: 'calls',
        reason: '入口把下单请求交给订单模块',
      }),
      { changeSetId },
    ),
    edgeUpsert(
      edge('e.orders-payment', 'module.orders', 'module.payment', {
        type: 'calls',
        reason: '下单成功后创建支付单',
      }),
      { changeSetId },
    ),
    edgeUpsert(edge('e.orders-db', 'module.orders', 'storage.postgres', { type: 'writes' }), {
      changeSetId,
    }),
    edgeUpsert(
      edge('e.payment-stripe', 'module.payment', 'external.stripe', { type: 'depends_on' }),
      { changeSetId },
    ),
    changeComplete(changeSetId),
    sessionEnd(),
  ];
}
