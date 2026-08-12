import type { Uri } from 'vscode';
import type { CoverageReport, DriftFinding } from '@god-view/protocol';
import type { MapPatch } from '@god-view/webview-bridge';
import type { Logger } from '../logger.js';
import type { WorkspaceIdentity } from '../workspace/workspace-identity.js';

export interface MapUpdate {
  readonly kind: 'patch' | 'facts' | 'reload';
  readonly revision: number;
  readonly factsRevision: number;
  readonly patch: MapPatch;
  readonly drift: readonly DriftFinding[];
  readonly coverage?: CoverageReport;
}

export interface MapServiceOptions {
  readonly identity: WorkspaceIdentity;
  readonly storageRoot: Uri;
  readonly logger: Logger;
  readonly now: () => string;
  readonly extraExcludes: readonly string[];
}
