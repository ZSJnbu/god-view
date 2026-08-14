/**
 * 从 JSON Schema 真源生成 TypeScript 类型。
 *
 * 生成结果必须提交，CI 的 generated-files-check 会重新生成并比对差异。
 * 禁止手工修改 src/generated/**。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFromFile } from 'json-schema-to-typescript';
import $RefParser from '@apidevtools/json-schema-ref-parser';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const schemaDir = join(packageRoot, 'schema');
const generatedDir = join(packageRoot, 'src', 'generated');
const outputFile = join(generatedDir, 'protocol-types.ts');
const schemaModuleFile = join(generatedDir, 'schemas.ts');
const toolSchemaModuleFile = join(generatedDir, 'tool-schemas.ts');

/**
 * MCP 客户端无法解析跨文件 $ref，因此工具入参 schema 必须完全展开。
 * 名称与 packages/protocol/src/validate.ts 的 ToolName 保持一致。
 */
const toolInputDefinitions = [
  ['get_map', 'GetMapInput'],
  ['begin_change', 'BeginChangeInput'],
  ['upsert_node', 'UpsertNodeInput'],
  ['upsert_edge', 'UpsertEdgeInput'],
  ['remove_entity', 'RemoveEntityInput'],
  ['complete_change', 'CompleteChangeInput'],
  ['upsert_story', 'UpsertStoryInput'],
  ['answer_annotation', 'AnswerAnnotationInput'],
  ['request_write_access', 'RequestWriteAccessInput'],
  ['propose_change', 'ProposeChangeInput'],
  ['start_approved_change', 'StartApprovedChangeInput'],
  ['request_scope_expansion', 'RequestScopeExpansionInput'],
] as const;

/** 运行时校验用的 schema 文件。bundle.schema.json 只服务于类型生成，不参与校验。 */
const runtimeSchemas = [
  ['commonSchema', 'common.schema.json'],
  ['eventsSchema', 'events.schema.json'],
  ['graphSchema', 'graph.schema.json'],
  ['toolsSchema', 'tools.schema.json'],
] as const;

const banner = `/* eslint-disable */
/**
 * 本文件由 packages/protocol/scripts/generate-types.mts 从 schema/*.schema.json 生成。
 * 请勿手工修改；修改协议请编辑 JSON Schema 后运行 \`pnpm run generate\`。
 */`;

const compiled = await compileFromFile(join(schemaDir, 'bundle.schema.json'), {
  cwd: schemaDir,
  bannerComment: banner,
  additionalProperties: false,
  declareExternallyReferenced: true,
  enableConstEnums: false,
  ignoreMinAndMaxItems: true,
  style: {
    singleQuote: true,
    printWidth: 100,
    trailingComma: 'all',
    semi: true,
  },
});

await mkdir(generatedDir, { recursive: true });
await writeFile(outputFile, compiled, 'utf8');

const schemaModuleParts = await Promise.all(
  runtimeSchemas.map(async ([exportName, fileName]) => {
    const raw = await readFile(join(schemaDir, fileName), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return `export const ${exportName}: SchemaObject = ${JSON.stringify(parsed, null, 2)};\n`;
  }),
);

const schemaModule = [
  banner,
  '',
  "import type { SchemaObject } from 'ajv';",
  '',
  ...schemaModuleParts,
  `export const runtimeSchemas: readonly SchemaObject[] = [${runtimeSchemas
    .map(([exportName]) => exportName)
    .join(', ')}];\n`,
].join('\n');

await writeFile(schemaModuleFile, schemaModule, 'utf8');

const dereferenced = (await $RefParser.dereference(join(schemaDir, 'tools.schema.json'))) as {
  $defs: Record<string, unknown>;
};
const toolSchemaEntries = toolInputDefinitions.map(([toolName, definition]) => {
  const schema = dereferenced.$defs[definition];
  if (schema === undefined) {
    throw new Error(`tools.schema.json 缺少定义：${definition}`);
  }
  return `  ${JSON.stringify(toolName)}: ${JSON.stringify(schema, null, 2)},`;
});
const toolSchemaModule = [
  banner,
  '',
  "import type { SchemaObject } from 'ajv';",
  '',
  'export const toolInputSchemas: Readonly<Record<string, SchemaObject>> = {',
  ...toolSchemaEntries,
  '};',
  '',
].join('\n');
await writeFile(toolSchemaModuleFile, toolSchemaModule, 'utf8');
console.log(`generated ${outputFile}`);
console.log(`generated ${schemaModuleFile}`);
console.log(`generated ${toolSchemaModuleFile}`);
