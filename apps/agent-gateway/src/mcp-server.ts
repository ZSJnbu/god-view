import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { toolInputSchemas, type ToolResult } from '@god-view/protocol';
import type { GatewaySession } from './gateway-session.js';

const mapWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const destructiveMapWriteAnnotations = {
  ...mapWriteAnnotations,
  destructiveHint: true,
} as const;

/**
 * God View MCP 工具清单。
 *
 * 工具描述必须简短、无歧义，并写明是否需要写入授权
 * （CODING_STANDARDS.md §14）。本 MVP 的工具只维护项目地图，
 * **不包含任何修改用户代码的能力**。
 */
const toolDefinitions = [
  {
    name: 'get_map',
    description:
      '读取当前项目地图（节点、关系与覆盖率）。开始编码前先调用它，在已有结构上继续工作，不要重复创建同义模块。只读，不需要写入授权。',
    schemaKey: 'get_map',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'begin_change',
    description: '声明本次任务的计划变更，返回的 changeSetId 用于后续事件。写地图，不写用户代码。',
    schemaKey: 'begin_change',
    annotations: mapWriteAnnotations,
  },
  {
    name: 'upsert_node',
    description:
      '新增或更新一个模块/分组/文件/存储/外部系统节点。只能声明职责、路径与证据引用；代码验证状态与用户确认状态由 God View 产生，不接受 Agent 提交。',
    schemaKey: 'upsert_node',
    annotations: mapWriteAnnotations,
  },
  {
    name: 'upsert_edge',
    description: '新增或更新一条依赖、调用、数据流或包含关系。两端节点必须已存在。',
    schemaKey: 'upsert_edge',
    annotations: mapWriteAnnotations,
  },
  {
    name: 'upsert_story',
    description:
      '新增或更新声明式项目讲解。步骤只能引用已存在的节点和关系；不要提交 HTML、CSS、脚本或动画代码。',
    schemaKey: 'upsert_story',
    annotations: mapWriteAnnotations,
  },
  {
    name: 'answer_annotation',
    description:
      '回答用户在地图上的解释标注。只提交摘要、可展开详情、结构化证据和可选讲解；这是只读解释，不请求或授予代码写权限。',
    schemaKey: 'answer_annotation',
    annotations: mapWriteAnnotations,
  },
  {
    name: 'request_write_access',
    description:
      '为解释标注申请进入修改方案流程。仅创建写入升级请求，不授予权限、不创建 ChangeSet、不修改代码。',
    schemaKey: 'request_write_access',
    annotations: mapWriteAnnotations,
  },
  {
    name: 'propose_change',
    description:
      '提交预计文件、结构变化、风险和验证计划。只创建待用户审批的方案，在批准前不得修改代码。',
    schemaKey: 'propose_change',
    annotations: mapWriteAnnotations,
  },
  {
    name: 'start_approved_change',
    description:
      '使用扩展侧用户批准后签发的令牌创建可写 ChangeSet。令牌绑定分支、地图/Git 基线、路径范围与期限。',
    schemaKey: 'start_approved_change',
    annotations: mapWriteAnnotations,
  },
  {
    name: 'remove_node',
    description:
      '删除一个节点并级联标记其关系。用户已确认的模块不能被删除重建；改名请使用 upsert_node。',
    schemaKey: 'remove_entity',
    annotations: destructiveMapWriteAnnotations,
  },
  {
    name: 'remove_edge',
    description: '删除一条关系，需要说明原因。',
    schemaKey: 'remove_entity',
    annotations: destructiveMapWriteAnnotations,
  },
  {
    name: 'complete_change',
    description:
      '结束本次变更并上报实际影响的文件与状态。失败或中断时如实提交 failed/interrupted，不要伪装成完成。',
    schemaKey: 'complete_change',
    annotations: mapWriteAnnotations,
  },
] as const;

type ToolName = (typeof toolDefinitions)[number]['name'];

function isKnownTool(name: string): name is ToolName {
  return toolDefinitions.some((definition) => definition.name === name);
}

async function dispatch(session: GatewaySession, name: ToolName, input: unknown): Promise<unknown> {
  switch (name) {
    case 'get_map':
      return session.getMap(input ?? {});
    case 'begin_change':
      return session.beginChange(input);
    case 'upsert_node':
      return session.upsertNode(input);
    case 'upsert_edge':
      return session.upsertEdge(input);
    case 'upsert_story':
      return session.upsertStory(input);
    case 'answer_annotation':
      return session.answerAnnotation(input);
    case 'request_write_access':
      return session.requestWriteAccess(input);
    case 'propose_change':
      return session.proposeChange(input);
    case 'start_approved_change':
      return session.startApprovedChange(input);
    case 'remove_node':
      return session.removeNode(input);
    case 'remove_edge':
      return session.removeEdge(input);
    case 'complete_change':
      return session.completeChange(input);
  }
}

function isRejected(result: unknown): boolean {
  return (
    typeof result === 'object' &&
    result !== null &&
    'accepted' in result &&
    !(result as ToolResult).accepted
  );
}

/**
 * 创建 MCP Server。
 *
 * 工具返回值原样序列化为 JSON 文本：Agent 需要看到 `accepted`、`mapRevision`
 * 与 `errors`，才能立刻修正声明而不是等到会话结束才发现漂移
 * （TECHNICAL_ARCHITECTURE.md §10.3）。
 *
 * 这里刻意使用低层 `Server` 而不是 `McpServer`：工具的入参 Schema 由
 * `packages/protocol/schema/*.schema.json` 生成，直接以 JSON Schema 注册即可；
 * `McpServer` 要求改用 Zod 描述入参，那会在协议真源之外再维护一份平行定义
 * （TECHNICAL_ARCHITECTURE.md §6.1）。
 */
/* eslint-disable @typescript-eslint/no-deprecated -- 见上：JSON Schema 真源要求低层 API */
export function createMcpServer(session: GatewaySession): Server {
  const server = new Server(
    { name: 'god-view', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: toolDefinitions.map((definition) => ({
      name: definition.name,
      description: definition.description,
      inputSchema: toolInputSchemas[definition.schemaKey] ?? { type: 'object' },
      annotations: definition.annotations,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (!isKnownTool(name)) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `未知工具：${name}` }],
      };
    }
    const result = await dispatch(session, name, args);
    return {
      // 被拒绝的调用标记为错误，避免 Agent 把校验失败当成成功继续声明。
      isError: isRejected(result),
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  });

  return server;
}

export async function runStdioServer(session: GatewaySession): Promise<void> {
  const server = createMcpServer(session);
  await server.connect(new StdioServerTransport());
}
