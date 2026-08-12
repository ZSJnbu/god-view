import { listNodes, type GraphSnapshot } from '@god-view/graph-core';
import type { Identifier } from '@god-view/protocol';
import {
  ExplicitImportValidator,
  FileFactValidator,
  type ValidationOutcome,
  type ValidationTarget,
  type WorkspaceProbe,
} from '@god-view/validation-core';

const maxValidatedEntitiesPerPass = 200;

/** 编排 L0 文件事实与 L1 TS/JS 显式 import 校验；具体 I/O 由只读 probe 提供。 */
export async function validateEntities(input: {
  readonly snapshot: GraphSnapshot;
  readonly probe: WorkspaceProbe;
  readonly checkedAt: () => string;
  readonly changedIds?: readonly Identifier[];
}): Promise<readonly ValidationOutcome[]> {
  return [...(await validateNodes(input)), ...(await validateEdges(input))];
}

type ValidationInput = Parameters<typeof validateEntities>[0];

async function validateNodes(input: ValidationInput): Promise<readonly ValidationOutcome[]> {
  const outcomes: ValidationOutcome[] = [];
  const fileValidator = new FileFactValidator(input.probe);
  const nodes = listNodes(input.snapshot)
    .filter((node) => input.changedIds === undefined || input.changedIds.includes(node.id))
    .filter((node) => (node.paths ?? []).length > 0 || (node.locations ?? []).length > 0)
    .slice(0, maxValidatedEntitiesPerPass);
  for (const node of nodes) {
    const result = await fileValidator.validate(
      {
        kind: 'node',
        id: node.id,
        paths: node.paths ?? [],
        locations: node.locations ?? [],
      },
      { checkedAt: input.checkedAt() },
    );
    if (result.ok) outcomes.push(result.value);
  }
  return outcomes;
}

async function validateEdges(input: ValidationInput): Promise<readonly ValidationOutcome[]> {
  const outcomes: ValidationOutcome[] = [];
  const importValidator = new ExplicitImportValidator(input.probe);
  const edges = [...input.snapshot.edges.values()]
    .filter((edge) => input.changedIds === undefined || input.changedIds.includes(edge.id))
    .slice(0, maxValidatedEntitiesPerPass);
  for (const edge of edges) {
    const source = input.snapshot.nodes.get(edge.from);
    const target = input.snapshot.nodes.get(edge.to);
    const validationTarget: ValidationTarget = {
      kind: 'edge',
      id: edge.id,
      paths: [],
      locations: [],
      sourcePaths: [
        ...(source?.paths ?? []),
        ...(source?.locations ?? []).map((location) => location.path),
        ...(edge.declaredEvidence ?? []).flatMap((evidence) =>
          evidence.kind === 'explicit_import' && evidence.location !== undefined
            ? [evidence.location.path]
            : [],
        ),
      ],
      targetPaths: target?.paths ?? [],
      declaredEvidence: edge.declaredEvidence ?? [],
    };
    if (!importValidator.supports(validationTarget)) continue;
    const result = await importValidator.validate(validationTarget, {
      checkedAt: input.checkedAt(),
    });
    if (result.ok) outcomes.push(result.value);
  }
  return outcomes;
}
