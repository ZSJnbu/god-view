import type { AnnotationThread } from '@god-view/protocol';

export const annotationTypeLabel: Readonly<Record<AnnotationThread['type'], string>> = {
  note: '备注',
  explain: '解释',
  risk: '风险',
  change: '修改',
};
