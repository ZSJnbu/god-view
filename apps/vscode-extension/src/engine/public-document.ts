import { toSnapshotDocument, type GraphSnapshot } from '@god-view/graph-core';
import type { CoverageReport, GraphSnapshotDocument } from '@god-view/protocol';
import { aggregateOutcomes, type ValidationOutcome } from '@god-view/validation-core';

/** 将内存中的动态事实投影到只读文档；事件真源保持不变。 */
export function publicDocument(
  snapshot: GraphSnapshot,
  coverage: CoverageReport | undefined,
  outcomes: readonly ValidationOutcome[] = [],
): GraphSnapshotDocument {
  const document = toSnapshotDocument(snapshot);
  const byEntity = new Map<string, ValidationOutcome[]>();
  for (const outcome of outcomes) {
    const current = byEntity.get(outcome.targetId);
    if (current === undefined) byEntity.set(outcome.targetId, [outcome]);
    else current.push(outcome);
  }
  const validationFor = (id: string) => aggregateOutcomes(byEntity.get(id) ?? []);
  return {
    ...document,
    nodes: document.nodes.map((node) => ({
      ...node,
      codeValidation: validationFor(node.id) ?? node.codeValidation,
    })),
    edges: document.edges.map((edge) => ({
      ...edge,
      codeValidation: validationFor(edge.id) ?? edge.codeValidation,
    })),
    ...(coverage === undefined ? {} : { coverage }),
  };
}
