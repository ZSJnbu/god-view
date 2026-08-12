import {
  err,
  errorCodes,
  ok,
  protocolError,
  type ProtocolError,
  type Result,
} from '@god-view/protocol';
import type { ExtensionEvent, WebviewCommand } from './messages.js';

/**
 * 消息边界解析。
 *
 * Webview 与扩展互为不可信输入，双向都必须在进入业务逻辑前解析。
 * 这里使用手写解析器而不是 Ajv：Webview bundle 不应为消息校验引入完整
 * JSON Schema 运行时；作为代价，本文件的每条分支都有契约测试覆盖。
 */

type Record_ = Record<string, unknown>;

function asRecord(input: unknown): Record_ | undefined {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? (input as Record_)
    : undefined;
}

function invalid(message: string, path?: string): Result<never, ProtocolError> {
  return err(protocolError(errorCodes.SCHEMA_VIOLATION, message, path));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function stringArray(input: unknown, maxItems: number): readonly string[] | undefined {
  return Array.isArray(input) &&
    input.length <= maxItems &&
    input.every((item) => typeof item === 'string' && item !== '')
    ? input
    : undefined;
}

function parsePositions(
  input: unknown,
): Result<Record<string, { x: number; y: number }>, ProtocolError> {
  const record = asRecord(input);
  if (record === undefined) {
    return invalid('positions 必须是对象', '/positions');
  }
  const positions: Record<string, { x: number; y: number }> = {};
  for (const [key, value] of Object.entries(record)) {
    const point = asRecord(value);
    if (point === undefined || !isFiniteNumber(point['x']) || !isFiniteNumber(point['y'])) {
      return invalid(`布局坐标非法：${key}`, `/positions/${key}`);
    }
    positions[key] = { x: point['x'], y: point['y'] };
  }
  return ok(positions);
}

function parseAnnotationCreate(record: Record_): Result<WebviewCommand, ProtocolError> {
  const annotationType = record['annotationType'];
  const body = record['body'];
  const nodeIds = stringArray(record['nodeIds'], 20);
  const excludedPaths =
    record['excludedPaths'] === undefined ? [] : stringArray(record['excludedPaths'], 50);
  if (
    !['note', 'explain', 'risk'].includes(String(annotationType)) ||
    typeof body !== 'string' ||
    body.trim() === '' ||
    body.length > 4000 ||
    nodeIds === undefined ||
    nodeIds.length === 0 ||
    excludedPaths === undefined
  ) {
    return invalid('createAnnotation 的类型、正文或目标非法', '/body');
  }
  return ok({
    type: 'createAnnotation',
    annotationType: annotationType as 'note' | 'explain' | 'risk',
    body,
    nodeIds,
    ...(excludedPaths.length === 0 ? {} : { excludedPaths }),
  });
}

function parseAnnotationIdCommand(
  type: 'resolveAnnotation' | 'copyAnnotationTask',
  record: Record_,
): Result<WebviewCommand, ProtocolError> {
  const annotationId = record['annotationId'];
  return typeof annotationId === 'string' && annotationId !== ''
    ? ok({ type, annotationId })
    : invalid(`${type} 缺少 annotationId`, '/annotationId');
}

function parseProposalCommand(record: Record_): Result<WebviewCommand, ProtocolError> {
  const proposalId = record['proposalId'];
  if (typeof proposalId !== 'string' || proposalId === '')
    return invalid(`${String(record['type'])} 缺少 proposalId`, '/proposalId');
  if (record['type'] === 'approveProposal') {
    const approvedScope = stringArray(record['approvedScope'], 500);
    return approvedScope === undefined || approvedScope.length === 0
      ? invalid('approveProposal 必须选择至少一个文件', '/approvedScope')
      : ok({ type: 'approveProposal', proposalId, approvedScope });
  }
  return record['type'] === 'rejectProposal'
    ? ok({ type: 'rejectProposal', proposalId })
    : ok({ type: 'copyApprovedChangeTask', proposalId });
}

function parseOpenSource(record: Record_): Result<WebviewCommand, ProtocolError> {
  const path = record['path'];
  if (typeof path !== 'string' || path === '') return invalid('openSource 缺少 path', '/path');
  const startLine = record['startLine'];
  if (startLine !== undefined && (!isFiniteNumber(startLine) || startLine < 1)) {
    return invalid('startLine 必须是不小于 1 的整数', '/startLine');
  }
  return ok(
    startLine === undefined
      ? { type: 'openSource', path }
      : { type: 'openSource', path, startLine },
  );
}

function parseChangeCommand(record: Record_): Result<WebviewCommand, ProtocolError> {
  if (record['type'] === 'openDiff') {
    const path = record['path'];
    return typeof path === 'string' && path !== ''
      ? ok({ type: 'openDiff', path })
      : invalid('openDiff 缺少 path', '/path');
  }
  if (record['type'] === 'interruptChange') {
    const changeSetId = record['changeSetId'];
    return typeof changeSetId === 'string' && changeSetId !== ''
      ? ok({ type: 'interruptChange', changeSetId })
      : invalid('interruptChange 缺少 changeSetId', '/changeSetId');
  }
  const changeSetId = record['changeSetId'];
  const status = record['status'];
  const note = record['note'];
  if (
    typeof changeSetId !== 'string' ||
    changeSetId === '' ||
    !['accepted', 'accepted_with_issues'].includes(String(status)) ||
    (note !== undefined && (typeof note !== 'string' || note.length > 500))
  )
    return invalid('reviewChange 参数非法', '/changeSetId');
  return ok({
    type: 'reviewChange',
    changeSetId,
    status: status as 'accepted' | 'accepted_with_issues',
    ...(typeof note === 'string' ? { note } : {}),
  });
}

/**
 * 解析来自 Webview 的命令。
 *
 * 未知命令一律拒绝：宽松忽略会让「命令授权」形同虚设。
 */
export function parseWebviewCommand(input: unknown): Result<WebviewCommand, ProtocolError> {
  const record = asRecord(input);
  if (record === undefined) {
    return invalid('消息必须是对象');
  }
  const type = record['type'];
  if (
    ['ready', 'requestSnapshot', 'generateAgentTask', 'copyAgentSetup', 'configureAgent'].includes(
      String(type),
    )
  )
    return parseImmediateCommand(record);
  switch (type) {
    case 'createAnnotation':
      return parseAnnotationCreate(record);
    case 'resolveAnnotation':
    case 'copyAnnotationTask':
      return parseAnnotationIdCommand(type, record);
    case 'approveProposal':
    case 'rejectProposal':
    case 'copyApprovedChangeTask':
      return parseProposalCommand(record);
    case 'openSource':
      return parseOpenSource(record);
    case 'openDiff':
    case 'interruptChange':
    case 'reviewChange':
      return parseChangeCommand(record);
    case 'saveLayout': {
      const positions = parsePositions(record['positions']);
      return positions.ok ? ok({ type: 'saveLayout', positions: positions.value }) : positions;
    }
    default:
      return invalid(`未知的 Webview 命令：${String(type)}`, '/type');
  }
}

function parseImmediateCommand(record: Record_): Result<WebviewCommand, ProtocolError> {
  const type = record['type'];
  if (type === 'configureAgent') {
    return ['codex', 'claude-code'].includes(String(record['agent']))
      ? ok({ type, agent: record['agent'] as 'codex' | 'claude-code' })
      : invalid('configureAgent 缺少受支持的 agent', '/agent');
  }
  return ok({ type } as Extract<WebviewCommand, { type: typeof type }>);
}

/**
 * `factsRevision` 是事实更新的排序基线。
 *
 * 缺了它就无法判断一条 `map/facts` 是新是旧，因此宁可拒绝也不默认成 0——
 * 默认值会让第一条真实事实更新被误判为过期。
 */
function requireFactsRevision(
  record: Record_,
  eventType: string,
): Result<ExtensionEvent, ProtocolError> {
  return isFiniteNumber(record['factsRevision'])
    ? ok(record as unknown as ExtensionEvent)
    : invalid(`${eventType} 缺少 factsRevision`, '/factsRevision');
}

function parseSnapshot(record: Record_): Result<ExtensionEvent, ProtocolError> {
  return asRecord(record['document']) === undefined
    ? invalid('map/snapshot 缺少 document', '/document')
    : requireFactsRevision(record, 'map/snapshot');
}

function parsePatch(record: Record_): Result<ExtensionEvent, ProtocolError> {
  return asRecord(record['patch']) === undefined || !isFiniteNumber(record['revision'])
    ? invalid('map/patch 缺少 patch 或 revision', '/patch')
    : requireFactsRevision(record, 'map/patch');
}

function parseFacts(record: Record_): Result<ExtensionEvent, ProtocolError> {
  if (!Array.isArray(record['drift'])) {
    return invalid('map/facts 缺少 drift', '/drift');
  }
  return requireFactsRevision(record, 'map/facts');
}

/** 解析来自扩展的事件。Webview 同样不信任宿主消息，避免注入伪造状态。 */
export function parseExtensionEvent(input: unknown): Result<ExtensionEvent, ProtocolError> {
  const record = asRecord(input);
  if (record === undefined) {
    return invalid('消息必须是对象');
  }
  switch (record['type']) {
    case 'map/snapshot':
      return parseSnapshot(record);
    case 'map/patch':
      return parsePatch(record);
    case 'map/facts':
      return parseFacts(record);
    case 'status':
      return typeof record['state'] === 'string'
        ? ok(record as unknown as ExtensionEvent)
        : invalid('status 缺少 state', '/state');
    case 'error':
      return typeof record['code'] === 'string' && typeof record['message'] === 'string'
        ? ok(record as unknown as ExtensionEvent)
        : invalid('error 缺少 code 或 message', '/code');
    default:
      return invalid(`未知的扩展事件：${String(record['type'])}`, '/type');
  }
}
