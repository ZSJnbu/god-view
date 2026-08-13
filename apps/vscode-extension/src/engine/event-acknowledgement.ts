import type { DomainError, GraphSnapshot } from '@god-view/graph-core';
import type { GodViewEvent, ToolResult } from '@god-view/protocol';

export function acceptedEvent(event: GodViewEvent, snapshot: GraphSnapshot): ToolResult {
  return {
    accepted: true,
    mapRevision: snapshot.revision,
    eventId: event.eventId,
    errors: [],
  };
}

export function rejectedEvent(
  event: GodViewEvent,
  snapshot: GraphSnapshot,
  error: DomainError,
): ToolResult {
  return {
    accepted: false,
    mapRevision: snapshot.revision,
    eventId: event.eventId,
    errors: [{ code: error.code, message: error.message }],
  };
}

export function unavailableRepository(): ToolResult {
  return {
    accepted: false,
    mapRevision: 0,
    errors: [{ code: 'CANCELLED', message: '地图仓库尚未就绪' }],
  };
}
