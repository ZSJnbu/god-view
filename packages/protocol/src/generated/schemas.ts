/* eslint-disable */
/**
 * 本文件由 packages/protocol/scripts/generate-types.mts 从 schema/*.schema.json 生成。
 * 请勿手工修改；修改协议请编辑 JSON Schema 后运行 `pnpm run generate`。
 */

import type { SchemaObject } from 'ajv';

export const commonSchema: SchemaObject = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "common.schema.json",
  "title": "GodViewCommon",
  "description": "God View 协议的共享定义。本文件是协议真源的一部分，TypeScript 类型由 scripts/generate-types.mts 生成。",
  "$defs": {
    "ProtocolVersion": {
      "title": "ProtocolVersion",
      "type": "string",
      "pattern": "^[0-9]+\\.[0-9]+$",
      "description": "major.minor 协议版本。"
    },
    "Timestamp": {
      "title": "Timestamp",
      "type": "string",
      "format": "date-time",
      "description": "RFC 3339 时间字符串。协议层不使用数值时间戳。"
    },
    "Identifier": {
      "title": "Identifier",
      "type": "string",
      "minLength": 1,
      "maxLength": 200,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
    },
    "WorkspacePath": {
      "title": "WorkspacePath",
      "type": "string",
      "minLength": 1,
      "maxLength": 1024,
      "pattern": "^(?![/\\\\])(?!.*(?:^|[/\\\\])\\.\\.(?:[/\\\\]|$))(?!.*:[/\\\\][/\\\\]).+$",
      "description": "工作区相对路径。拒绝绝对路径、盘符 URI 和 .. 穿越。"
    },
    "CodeLocation": {
      "title": "CodeLocation",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "path"
      ],
      "properties": {
        "path": {
          "$ref": "#/$defs/WorkspacePath"
        },
        "startLine": {
          "type": "integer",
          "minimum": 1
        },
        "endLine": {
          "type": "integer",
          "minimum": 1
        }
      }
    },
    "ShortNote": {
      "title": "ShortNote",
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "CompletionStatus": {
      "title": "CompletionStatus",
      "type": "string",
      "enum": [
        "completed",
        "failed",
        "interrupted"
      ],
      "description": "失败或中断只结束临时预览并记录状态，已经产生的代码改动不自动回滚。"
    },
    "EvidenceKind": {
      "title": "EvidenceKind",
      "type": "string",
      "enum": [
        "file_exists",
        "explicit_import",
        "git_diff",
        "agent_claim"
      ],
      "description": "证据类型。agent_claim 属于 L2 声明，不得展示为代码事实。"
    },
    "Evidence": {
      "title": "Evidence",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "kind"
      ],
      "properties": {
        "kind": {
          "$ref": "#/$defs/EvidenceKind"
        },
        "location": {
          "$ref": "#/$defs/CodeLocation"
        },
        "detail": {
          "type": "string",
          "maxLength": 500
        }
      }
    },
    "ValidationLevel": {
      "title": "ValidationLevel",
      "type": "string",
      "enum": [
        "L0",
        "L1",
        "L2",
        "L3"
      ],
      "description": "L0 文件事实、L1 显式语法、L2 Agent 声明、L3 系统推断。"
    },
    "ActorKind": {
      "title": "ActorKind",
      "type": "string",
      "enum": [
        "agent",
        "user",
        "system",
        "unknown"
      ]
    },
    "Actor": {
      "title": "Actor",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "kind"
      ],
      "properties": {
        "kind": {
          "$ref": "#/$defs/ActorKind"
        },
        "adapterId": {
          "$ref": "#/$defs/Identifier"
        },
        "displayName": {
          "type": "string",
          "maxLength": 100
        }
      },
      "description": "事件来源。Adapter 无法提供可靠任务关联证据时必须使用 kind=unknown。"
    },
    "NodeType": {
      "title": "NodeType",
      "type": "string",
      "enum": [
        "entry",
        "module",
        "group",
        "file",
        "service",
        "external_system",
        "storage",
        "unclassified"
      ]
    },
    "EdgeType": {
      "title": "EdgeType",
      "type": "string",
      "enum": [
        "depends_on",
        "calls",
        "data_flow",
        "contains",
        "reads",
        "writes",
        "publishes"
      ]
    },
    "VisualHint": {
      "title": "VisualHint",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "group": {
          "type": "string",
          "maxLength": 64
        },
        "importance": {
          "type": "string",
          "enum": [
            "primary",
            "secondary",
            "detail"
          ]
        },
        "preferredPosition": {
          "type": "string",
          "enum": [
            "entry",
            "core",
            "storage",
            "external",
            "auto"
          ]
        },
        "icon": {
          "type": "string",
          "maxLength": 64
        },
        "collapsedByDefault": {
          "type": "boolean"
        }
      },
      "description": "Agent 只能给出布局建议，最终位置由布局引擎决定。"
    }
  }
};

export const eventsSchema: SchemaObject = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "events.schema.json",
  "title": "GodViewEventDocument",
  "description": "Agent 提交给 God View 的事件。Agent 只能声明语义与证据引用；codeValidation、userConfirmation 和 coverage 由插件、Validator 和用户产生，因此不出现在本文件的任何声明结构中。",
  "$defs": {
    "AgentNodeDeclaration": {
      "title": "AgentNodeDeclaration",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "type",
        "label"
      ],
      "properties": {
        "id": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "type": {
          "$ref": "common.schema.json#/$defs/NodeType"
        },
        "label": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "responsibility": {
          "type": "string",
          "maxLength": 200
        },
        "parentId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "paths": {
          "type": "array",
          "maxItems": 500,
          "items": {
            "$ref": "common.schema.json#/$defs/WorkspacePath"
          }
        },
        "locations": {
          "type": "array",
          "maxItems": 50,
          "items": {
            "$ref": "common.schema.json#/$defs/CodeLocation"
          }
        },
        "evidence": {
          "type": "array",
          "maxItems": 50,
          "items": {
            "$ref": "common.schema.json#/$defs/Evidence"
          }
        },
        "uncertainties": {
          "type": "array",
          "maxItems": 20,
          "items": {
            "$ref": "common.schema.json#/$defs/ShortNote"
          }
        },
        "visualHint": {
          "$ref": "common.schema.json#/$defs/VisualHint"
        }
      }
    },
    "AgentEdgeDeclaration": {
      "title": "AgentEdgeDeclaration",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "from",
        "to",
        "type"
      ],
      "properties": {
        "id": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "from": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "to": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "type": {
          "$ref": "common.schema.json#/$defs/EdgeType"
        },
        "reason": {
          "type": "string",
          "maxLength": 200
        },
        "evidence": {
          "type": "array",
          "maxItems": 50,
          "items": {
            "$ref": "common.schema.json#/$defs/Evidence"
          }
        }
      }
    },
    "EventEnvelope": {
      "title": "EventEnvelope",
      "type": "object",
      "required": [
        "version",
        "workspaceId",
        "branchKey",
        "sessionId",
        "eventId",
        "timestamp",
        "type"
      ],
      "properties": {
        "version": {
          "$ref": "common.schema.json#/$defs/ProtocolVersion"
        },
        "workspaceId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "branchKey": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "sessionId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "eventId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "timestamp": {
          "$ref": "common.schema.json#/$defs/Timestamp"
        },
        "actor": {
          "$ref": "common.schema.json#/$defs/Actor"
        },
        "baseMapRevision": {
          "type": "integer",
          "minimum": 0
        },
        "baseGitRevision": {
          "type": "string",
          "maxLength": 100
        },
        "summary": {
          "type": "string",
          "maxLength": 200
        }
      }
    },
    "SessionStartPayload": {
      "title": "SessionStartPayload",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "adapterId"
      ],
      "properties": {
        "adapterId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "protocolVersions": {
          "type": "array",
          "maxItems": 20,
          "items": {
            "$ref": "common.schema.json#/$defs/ProtocolVersion"
          }
        }
      }
    },
    "ChangeStartPayload": {
      "title": "ChangeStartPayload",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "changeSetId",
        "intent"
      ],
      "properties": {
        "changeSetId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "intent": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "plannedFiles": {
          "type": "array",
          "maxItems": 500,
          "items": {
            "$ref": "common.schema.json#/$defs/WorkspacePath"
          }
        },
        "proposalId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "approvalToken": {
          "$ref": "common.schema.json#/$defs/Identifier"
        }
      }
    },
    "NodeUpsertPayload": {
      "title": "NodeUpsertPayload",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "node"
      ],
      "properties": {
        "node": {
          "$ref": "#/$defs/AgentNodeDeclaration"
        },
        "changeSetId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        }
      }
    },
    "NodeRemovePayload": {
      "title": "NodeRemovePayload",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "nodeId",
        "reason"
      ],
      "properties": {
        "nodeId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "changeSetId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        }
      }
    },
    "EdgeUpsertPayload": {
      "title": "EdgeUpsertPayload",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "edge"
      ],
      "properties": {
        "edge": {
          "$ref": "#/$defs/AgentEdgeDeclaration"
        },
        "changeSetId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        }
      }
    },
    "EdgeRemovePayload": {
      "title": "EdgeRemovePayload",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "edgeId",
        "reason"
      ],
      "properties": {
        "edgeId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "changeSetId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        }
      }
    },
    "ChangeCompletePayload": {
      "title": "ChangeCompletePayload",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "changeSetId",
        "status"
      ],
      "properties": {
        "changeSetId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "status": {
          "$ref": "common.schema.json#/$defs/CompletionStatus"
        },
        "actualFiles": {
          "type": "array",
          "maxItems": 2000,
          "items": {
            "$ref": "common.schema.json#/$defs/WorkspacePath"
          }
        },
        "note": {
          "type": "string",
          "maxLength": 500
        }
      }
    },
    "SessionEndPayload": {
      "title": "SessionEndPayload",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "status"
      ],
      "properties": {
        "status": {
          "$ref": "common.schema.json#/$defs/CompletionStatus"
        },
        "note": {
          "type": "string",
          "maxLength": 500
        }
      }
    },
    "StoryUpsertPayload": {
      "title": "StoryUpsertPayload",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "story"
      ],
      "properties": {
        "story": {
          "$ref": "graph.schema.json#/$defs/GuidedStory"
        }
      }
    },
    "AnnotationCreatePayload": {
      "title": "AnnotationCreatePayload",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "annotation"
      ],
      "properties": {
        "annotation": {
          "$ref": "graph.schema.json#/$defs/AnnotationThread"
        }
      }
    },
    "AnnotationAnswerPayload": {
      "title": "AnnotationAnswerPayload",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "annotationId",
        "message"
      ],
      "properties": {
        "annotationId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "message": {
          "$ref": "graph.schema.json#/$defs/AnnotationMessage"
        },
        "story": {
          "$ref": "graph.schema.json#/$defs/GuidedStory"
        }
      }
    },
    "AnnotationResolvePayload": {
      "title": "AnnotationResolvePayload",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "annotationId"
      ],
      "properties": {
        "annotationId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        }
      }
    },
    "WriteAccessRequestedPayload": {
      "title": "WriteAccessRequestedPayload",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "request"
      ],
      "properties": {
        "request": {
          "$ref": "graph.schema.json#/$defs/WriteAccessRequest"
        }
      }
    },
    "ChangeProposalPayload": {
      "title": "ChangeProposalPayload",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "proposal"
      ],
      "properties": {
        "proposal": {
          "$ref": "graph.schema.json#/$defs/ChangeProposal"
        }
      }
    },
    "ChangeApprovedPayload": {
      "title": "ChangeApprovedPayload",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "proposalId",
        "approval"
      ],
      "properties": {
        "proposalId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "approval": {
          "$ref": "graph.schema.json#/$defs/ChangeProposal/properties/approval"
        }
      }
    },
    "ChangeObservedPayload": {
      "title": "ChangeObservedPayload",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "changeSetId",
        "executionStatus",
        "diff"
      ],
      "properties": {
        "changeSetId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "executionStatus": {
          "type": "string",
          "enum": [
            "in_progress",
            "scope_violation",
            "conflicted",
            "interrupted",
            "failed"
          ]
        },
        "diff": {
          "$ref": "graph.schema.json#/$defs/ChangeDiffSummary"
        }
      }
    },
    "ScopeExpansionRequestedPayload": {
      "title": "ScopeExpansionRequestedPayload",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "request"
      ],
      "properties": {
        "request": {
          "$ref": "graph.schema.json#/$defs/ScopeExpansionRequest"
        }
      }
    },
    "ScopeExpansionDecidedPayload": {
      "title": "ScopeExpansionDecidedPayload",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "changeSetId",
        "requestId",
        "decision"
      ],
      "properties": {
        "changeSetId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "requestId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "decision": {
          "type": "string",
          "enum": [
            "approved",
            "rejected"
          ]
        }
      }
    },
    "ChangeReviewedPayload": {
      "title": "ChangeReviewedPayload",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "changeSetId",
        "status"
      ],
      "properties": {
        "changeSetId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "status": {
          "type": "string",
          "enum": [
            "accepted",
            "accepted_with_issues"
          ]
        },
        "note": {
          "type": "string",
          "maxLength": 500
        }
      }
    },
    "ChangeRejectedPayload": {
      "title": "ChangeRejectedPayload",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "proposalId",
        "reason"
      ],
      "properties": {
        "proposalId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      }
    },
    "SessionStartEvent": {
      "title": "SessionStartEvent",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/EventEnvelope"
        },
        {
          "type": "object",
          "required": [
            "type",
            "payload"
          ],
          "properties": {
            "type": {
              "const": "session_start"
            },
            "payload": {
              "$ref": "#/$defs/SessionStartPayload"
            }
          }
        }
      ]
    },
    "ChangeStartEvent": {
      "title": "ChangeStartEvent",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/EventEnvelope"
        },
        {
          "type": "object",
          "required": [
            "type",
            "payload"
          ],
          "properties": {
            "type": {
              "const": "change_start"
            },
            "payload": {
              "$ref": "#/$defs/ChangeStartPayload"
            }
          }
        }
      ]
    },
    "NodeUpsertEvent": {
      "title": "NodeUpsertEvent",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/EventEnvelope"
        },
        {
          "type": "object",
          "required": [
            "type",
            "payload"
          ],
          "properties": {
            "type": {
              "const": "node_upsert"
            },
            "payload": {
              "$ref": "#/$defs/NodeUpsertPayload"
            }
          }
        }
      ]
    },
    "NodeRemoveEvent": {
      "title": "NodeRemoveEvent",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/EventEnvelope"
        },
        {
          "type": "object",
          "required": [
            "type",
            "payload"
          ],
          "properties": {
            "type": {
              "const": "node_remove"
            },
            "payload": {
              "$ref": "#/$defs/NodeRemovePayload"
            }
          }
        }
      ]
    },
    "EdgeUpsertEvent": {
      "title": "EdgeUpsertEvent",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/EventEnvelope"
        },
        {
          "type": "object",
          "required": [
            "type",
            "payload"
          ],
          "properties": {
            "type": {
              "const": "edge_upsert"
            },
            "payload": {
              "$ref": "#/$defs/EdgeUpsertPayload"
            }
          }
        }
      ]
    },
    "EdgeRemoveEvent": {
      "title": "EdgeRemoveEvent",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/EventEnvelope"
        },
        {
          "type": "object",
          "required": [
            "type",
            "payload"
          ],
          "properties": {
            "type": {
              "const": "edge_remove"
            },
            "payload": {
              "$ref": "#/$defs/EdgeRemovePayload"
            }
          }
        }
      ]
    },
    "ChangeCompleteEvent": {
      "title": "ChangeCompleteEvent",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/EventEnvelope"
        },
        {
          "type": "object",
          "required": [
            "type",
            "payload"
          ],
          "properties": {
            "type": {
              "const": "change_complete"
            },
            "payload": {
              "$ref": "#/$defs/ChangeCompletePayload"
            }
          }
        }
      ]
    },
    "SessionEndEvent": {
      "title": "SessionEndEvent",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/EventEnvelope"
        },
        {
          "type": "object",
          "required": [
            "type",
            "payload"
          ],
          "properties": {
            "type": {
              "const": "session_end"
            },
            "payload": {
              "$ref": "#/$defs/SessionEndPayload"
            }
          }
        }
      ]
    },
    "StoryUpsertEvent": {
      "title": "StoryUpsertEvent",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/EventEnvelope"
        },
        {
          "type": "object",
          "required": [
            "type",
            "payload"
          ],
          "properties": {
            "type": {
              "const": "story_upsert"
            },
            "payload": {
              "$ref": "#/$defs/StoryUpsertPayload"
            }
          }
        }
      ]
    },
    "AnnotationCreateEvent": {
      "title": "AnnotationCreateEvent",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/EventEnvelope"
        },
        {
          "type": "object",
          "required": [
            "type",
            "payload"
          ],
          "properties": {
            "type": {
              "const": "annotation_create"
            },
            "payload": {
              "$ref": "#/$defs/AnnotationCreatePayload"
            }
          }
        }
      ]
    },
    "AnnotationAnswerEvent": {
      "title": "AnnotationAnswerEvent",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/EventEnvelope"
        },
        {
          "type": "object",
          "required": [
            "type",
            "payload"
          ],
          "properties": {
            "type": {
              "const": "annotation_answer"
            },
            "payload": {
              "$ref": "#/$defs/AnnotationAnswerPayload"
            }
          }
        }
      ]
    },
    "AnnotationResolveEvent": {
      "title": "AnnotationResolveEvent",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/EventEnvelope"
        },
        {
          "type": "object",
          "required": [
            "type",
            "payload"
          ],
          "properties": {
            "type": {
              "const": "annotation_resolve"
            },
            "payload": {
              "$ref": "#/$defs/AnnotationResolvePayload"
            }
          }
        }
      ]
    },
    "WriteAccessRequestedEvent": {
      "title": "WriteAccessRequestedEvent",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/EventEnvelope"
        },
        {
          "type": "object",
          "required": [
            "type",
            "payload"
          ],
          "properties": {
            "type": {
              "const": "write_access_requested"
            },
            "payload": {
              "$ref": "#/$defs/WriteAccessRequestedPayload"
            }
          }
        }
      ]
    },
    "ChangeProposalEvent": {
      "title": "ChangeProposalEvent",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/EventEnvelope"
        },
        {
          "type": "object",
          "required": [
            "type",
            "payload"
          ],
          "properties": {
            "type": {
              "const": "change_proposal"
            },
            "payload": {
              "$ref": "#/$defs/ChangeProposalPayload"
            }
          }
        }
      ]
    },
    "ChangeApprovedEvent": {
      "title": "ChangeApprovedEvent",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/EventEnvelope"
        },
        {
          "type": "object",
          "required": [
            "type",
            "payload"
          ],
          "properties": {
            "type": {
              "const": "change_approved"
            },
            "payload": {
              "$ref": "#/$defs/ChangeApprovedPayload"
            }
          }
        }
      ]
    },
    "ChangeRejectedEvent": {
      "title": "ChangeRejectedEvent",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/EventEnvelope"
        },
        {
          "type": "object",
          "required": [
            "type",
            "payload"
          ],
          "properties": {
            "type": {
              "const": "change_rejected"
            },
            "payload": {
              "$ref": "#/$defs/ChangeRejectedPayload"
            }
          }
        }
      ]
    },
    "ChangeObservedEvent": {
      "title": "ChangeObservedEvent",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/EventEnvelope"
        },
        {
          "type": "object",
          "required": [
            "type",
            "payload"
          ],
          "properties": {
            "type": {
              "const": "change_observed"
            },
            "payload": {
              "$ref": "#/$defs/ChangeObservedPayload"
            }
          }
        }
      ]
    },
    "ChangeReviewedEvent": {
      "title": "ChangeReviewedEvent",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/EventEnvelope"
        },
        {
          "type": "object",
          "required": [
            "type",
            "payload"
          ],
          "properties": {
            "type": {
              "const": "change_reviewed"
            },
            "payload": {
              "$ref": "#/$defs/ChangeReviewedPayload"
            }
          }
        }
      ]
    },
    "ScopeExpansionRequestedEvent": {
      "title": "ScopeExpansionRequestedEvent",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/EventEnvelope"
        },
        {
          "type": "object",
          "required": [
            "type",
            "payload"
          ],
          "properties": {
            "type": {
              "const": "scope_expansion_requested"
            },
            "payload": {
              "$ref": "#/$defs/ScopeExpansionRequestedPayload"
            }
          }
        }
      ]
    },
    "ScopeExpansionDecidedEvent": {
      "title": "ScopeExpansionDecidedEvent",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/EventEnvelope"
        },
        {
          "type": "object",
          "required": [
            "type",
            "payload"
          ],
          "properties": {
            "type": {
              "const": "scope_expansion_decided"
            },
            "payload": {
              "$ref": "#/$defs/ScopeExpansionDecidedPayload"
            }
          }
        }
      ]
    },
    "ReservedEventType": {
      "title": "ReservedEventType",
      "type": "string",
      "enum": [
        "change_accepted",
        "unexpected_write",
        "scope_violation",
        "change_interrupted",
        "change_conflicted",
        "change_cancelled",
        "change_failed"
      ]
    },
    "ReservedEvent": {
      "title": "ReservedEvent",
      "description": "协议已保留但当前实现尚未支持的事件类型。命令处理层返回 UNSUPPORTED_EVENT_TYPE，不静默接受。",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/EventEnvelope"
        },
        {
          "type": "object",
          "required": [
            "type"
          ],
          "properties": {
            "type": {
              "$ref": "#/$defs/ReservedEventType"
            },
            "payload": {
              "type": "object"
            }
          }
        }
      ]
    },
    "GodViewEvent": {
      "title": "GodViewEvent",
      "oneOf": [
        {
          "$ref": "#/$defs/SessionStartEvent"
        },
        {
          "$ref": "#/$defs/ChangeStartEvent"
        },
        {
          "$ref": "#/$defs/NodeUpsertEvent"
        },
        {
          "$ref": "#/$defs/NodeRemoveEvent"
        },
        {
          "$ref": "#/$defs/EdgeUpsertEvent"
        },
        {
          "$ref": "#/$defs/EdgeRemoveEvent"
        },
        {
          "$ref": "#/$defs/ChangeCompleteEvent"
        },
        {
          "$ref": "#/$defs/SessionEndEvent"
        },
        {
          "$ref": "#/$defs/StoryUpsertEvent"
        },
        {
          "$ref": "#/$defs/AnnotationCreateEvent"
        },
        {
          "$ref": "#/$defs/AnnotationAnswerEvent"
        },
        {
          "$ref": "#/$defs/AnnotationResolveEvent"
        },
        {
          "$ref": "#/$defs/WriteAccessRequestedEvent"
        },
        {
          "$ref": "#/$defs/ChangeProposalEvent"
        },
        {
          "$ref": "#/$defs/ChangeApprovedEvent"
        },
        {
          "$ref": "#/$defs/ChangeRejectedEvent"
        },
        {
          "$ref": "#/$defs/ChangeObservedEvent"
        },
        {
          "$ref": "#/$defs/ChangeReviewedEvent"
        },
        {
          "$ref": "#/$defs/ScopeExpansionRequestedEvent"
        },
        {
          "$ref": "#/$defs/ScopeExpansionDecidedEvent"
        },
        {
          "$ref": "#/$defs/ReservedEvent"
        }
      ]
    }
  }
};

export const graphSchema: SchemaObject = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "graph.schema.json",
  "title": "GraphSnapshotDocument",
  "description": "地图快照的持久化形态。节点与边使用按 id 排序的数组而不是对象字典，保证同一事件序列回放得到字节等价的序列化结果。",
  "$defs": {
    "SourceKind": {
      "title": "SourceKind",
      "type": "string",
      "enum": [
        "agent_declared",
        "inferred",
        "user_created"
      ],
      "description": "实体的声明来源。与 codeValidation、userConfirmation 相互独立，不可互相冒充。"
    },
    "Provenance": {
      "title": "Provenance",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "kind",
        "actor",
        "declaredAt"
      ],
      "properties": {
        "kind": {
          "$ref": "#/$defs/SourceKind"
        },
        "actor": {
          "$ref": "common.schema.json#/$defs/Actor"
        },
        "sessionId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "declaredAt": {
          "$ref": "common.schema.json#/$defs/Timestamp"
        }
      }
    },
    "CodeValidationStatus": {
      "title": "CodeValidationStatus",
      "type": "string",
      "enum": [
        "unverified",
        "verified",
        "failed",
        "unsupported",
        "drifted"
      ],
      "description": "verified 仅表示路径/文件/显式依赖证据成立，不表示业务职责描述正确。"
    },
    "CodeValidationState": {
      "title": "CodeValidationState",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "status"
      ],
      "properties": {
        "status": {
          "$ref": "#/$defs/CodeValidationStatus"
        },
        "level": {
          "$ref": "common.schema.json#/$defs/ValidationLevel"
        },
        "validator": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "checkedAt": {
          "$ref": "common.schema.json#/$defs/Timestamp"
        },
        "evidence": {
          "type": "array",
          "maxItems": 100,
          "items": {
            "$ref": "common.schema.json#/$defs/Evidence"
          }
        },
        "detail": {
          "type": "string",
          "maxLength": 500
        }
      }
    },
    "UserConfirmationState": {
      "title": "UserConfirmationState",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "status"
      ],
      "properties": {
        "status": {
          "type": "string",
          "enum": [
            "unconfirmed",
            "confirmed",
            "rejected"
          ]
        },
        "confirmedAt": {
          "$ref": "common.schema.json#/$defs/Timestamp"
        }
      }
    },
    "LifecycleState": {
      "title": "LifecycleState",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "status"
      ],
      "properties": {
        "status": {
          "type": "string",
          "enum": [
            "planned",
            "in_progress",
            "active",
            "failed",
            "removed"
          ],
          "description": "change_start 与 change_complete 之间的实体标记为 in_progress，用户可见但不是完成状态；变更失败或中断时标记为 failed，已产生的代码改动不自动回滚。"
        },
        "changeSetId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        }
      }
    },
    "GraphNode": {
      "title": "GraphNode",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "type",
        "label",
        "source",
        "codeValidation",
        "userConfirmation",
        "lifecycle",
        "updatedAt",
        "revision"
      ],
      "properties": {
        "id": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "type": {
          "$ref": "common.schema.json#/$defs/NodeType"
        },
        "label": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "responsibility": {
          "type": "string",
          "maxLength": 200
        },
        "parentId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "paths": {
          "type": "array",
          "items": {
            "$ref": "common.schema.json#/$defs/WorkspacePath"
          }
        },
        "locations": {
          "type": "array",
          "items": {
            "$ref": "common.schema.json#/$defs/CodeLocation"
          }
        },
        "declaredEvidence": {
          "type": "array",
          "items": {
            "$ref": "common.schema.json#/$defs/Evidence"
          }
        },
        "uncertainties": {
          "type": "array",
          "items": {
            "type": "string",
            "maxLength": 200
          }
        },
        "visualHint": {
          "$ref": "common.schema.json#/$defs/VisualHint"
        },
        "source": {
          "$ref": "#/$defs/Provenance"
        },
        "codeValidation": {
          "$ref": "#/$defs/CodeValidationState"
        },
        "userConfirmation": {
          "$ref": "#/$defs/UserConfirmationState"
        },
        "lifecycle": {
          "$ref": "#/$defs/LifecycleState"
        },
        "updatedAt": {
          "$ref": "common.schema.json#/$defs/Timestamp"
        },
        "revision": {
          "type": "integer",
          "minimum": 0,
          "description": "最后一次修改该实体时的地图版本号。用于检测 Agent 基于过期基线的覆盖写。"
        }
      }
    },
    "GraphEdge": {
      "title": "GraphEdge",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "from",
        "to",
        "type",
        "source",
        "codeValidation",
        "userConfirmation",
        "lifecycle",
        "updatedAt",
        "revision"
      ],
      "properties": {
        "id": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "from": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "to": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "type": {
          "$ref": "common.schema.json#/$defs/EdgeType"
        },
        "reason": {
          "type": "string",
          "maxLength": 200
        },
        "declaredEvidence": {
          "type": "array",
          "items": {
            "$ref": "common.schema.json#/$defs/Evidence"
          }
        },
        "source": {
          "$ref": "#/$defs/Provenance"
        },
        "codeValidation": {
          "$ref": "#/$defs/CodeValidationState"
        },
        "userConfirmation": {
          "$ref": "#/$defs/UserConfirmationState"
        },
        "lifecycle": {
          "$ref": "#/$defs/LifecycleState"
        },
        "updatedAt": {
          "$ref": "common.schema.json#/$defs/Timestamp"
        },
        "revision": {
          "type": "integer",
          "minimum": 0,
          "description": "最后一次修改该实体时的地图版本号。用于检测 Agent 基于过期基线的覆盖写。"
        }
      }
    },
    "ScopeExpansionRequest": {
      "title": "ScopeExpansionRequest",
      "description": "Agent 在写入批准范围外文件之前提出的扩围申请。只有用户事件可以把 pending 改为 approved 或 rejected。",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "changeSetId",
        "sessionId",
        "requestedFiles",
        "reason",
        "status",
        "requestedAt"
      ],
      "properties": {
        "id": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "changeSetId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "sessionId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "requestedFiles": {
          "type": "array",
          "minItems": 1,
          "maxItems": 100,
          "uniqueItems": true,
          "items": {
            "$ref": "common.schema.json#/$defs/WorkspacePath"
          }
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "status": {
          "type": "string",
          "enum": [
            "pending",
            "approved",
            "rejected"
          ]
        },
        "requestedAt": {
          "$ref": "common.schema.json#/$defs/Timestamp"
        },
        "decidedAt": {
          "$ref": "common.schema.json#/$defs/Timestamp"
        }
      }
    },
    "ActiveChange": {
      "title": "ActiveChange",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "changeSetId",
        "sessionId",
        "intent",
        "startedAt",
        "touchedNodeIds",
        "touchedEdgeIds"
      ],
      "properties": {
        "changeSetId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "sessionId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "intent": {
          "type": "string",
          "maxLength": 200
        },
        "startedAt": {
          "$ref": "common.schema.json#/$defs/Timestamp"
        },
        "plannedFiles": {
          "type": "array",
          "items": {
            "$ref": "common.schema.json#/$defs/WorkspacePath"
          }
        },
        "touchedNodeIds": {
          "type": "array",
          "items": {
            "$ref": "common.schema.json#/$defs/Identifier"
          }
        },
        "touchedEdgeIds": {
          "type": "array",
          "items": {
            "$ref": "common.schema.json#/$defs/Identifier"
          }
        },
        "proposalId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "approvalToken": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "approvedScope": {
          "type": "array",
          "items": {
            "$ref": "common.schema.json#/$defs/WorkspacePath"
          }
        },
        "permissionMode": {
          "type": "string",
          "enum": [
            "enforced",
            "monitored"
          ]
        },
        "baseMapRevision": {
          "type": "integer",
          "minimum": 0
        },
        "baseGitRevision": {
          "type": "string",
          "maxLength": 100
        },
        "preexistingChanges": {
          "type": "array",
          "maxItems": 2000,
          "items": {
            "$ref": "common.schema.json#/$defs/WorkspacePath"
          }
        },
        "scopeExpansionRequests": {
          "type": "array",
          "maxItems": 50,
          "items": {
            "$ref": "#/$defs/ScopeExpansionRequest"
          }
        },
        "executionStatus": {
          "type": "string",
          "enum": [
            "in_progress",
            "scope_violation",
            "conflicted",
            "interrupted",
            "failed"
          ]
        },
        "diff": {
          "$ref": "#/$defs/ChangeDiffSummary"
        }
      }
    },
    "DiffFile": {
      "title": "DiffFile",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "path",
        "status",
        "additions",
        "deletions",
        "scopeStatus",
        "attribution"
      ],
      "properties": {
        "path": {
          "$ref": "common.schema.json#/$defs/WorkspacePath"
        },
        "status": {
          "type": "string",
          "enum": [
            "added",
            "modified",
            "deleted",
            "renamed",
            "unknown"
          ]
        },
        "additions": {
          "type": "integer",
          "minimum": 0
        },
        "deletions": {
          "type": "integer",
          "minimum": 0
        },
        "scopeStatus": {
          "type": "string",
          "enum": [
            "approved",
            "outside_scope"
          ]
        },
        "attribution": {
          "type": "string",
          "enum": [
            "change_set",
            "preexisting_overlap",
            "unknown_external"
          ]
        }
      }
    },
    "ChangeDiffSummary": {
      "title": "ChangeDiffSummary",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "files",
        "additions",
        "deletions",
        "computedAt",
        "contentHash"
      ],
      "properties": {
        "files": {
          "type": "array",
          "maxItems": 2000,
          "items": {
            "$ref": "#/$defs/DiffFile"
          }
        },
        "additions": {
          "type": "integer",
          "minimum": 0
        },
        "deletions": {
          "type": "integer",
          "minimum": 0
        },
        "computedAt": {
          "$ref": "common.schema.json#/$defs/Timestamp"
        },
        "contentHash": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        }
      }
    },
    "DriftKind": {
      "title": "DriftKind",
      "type": "string",
      "enum": [
        "missing_file",
        "unclassified_file",
        "undeclared_change",
        "conflicting_declaration"
      ],
      "description": "漂移类型。missing_file 表示地图声明的文件已不存在；unclassified_file 表示仓库中的第一方文件尚未归属任何节点。"
    },
    "DriftFinding": {
      "title": "DriftFinding",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "kind",
        "detail"
      ],
      "properties": {
        "kind": {
          "$ref": "#/$defs/DriftKind"
        },
        "detail": {
          "type": "string",
          "maxLength": 500
        },
        "targetId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "path": {
          "$ref": "common.schema.json#/$defs/WorkspacePath"
        },
        "detectedAt": {
          "$ref": "common.schema.json#/$defs/Timestamp"
        }
      }
    },
    "CoverageReason": {
      "title": "CoverageReason",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "reason",
        "count"
      ],
      "properties": {
        "reason": {
          "type": "string",
          "maxLength": 100
        },
        "count": {
          "type": "integer",
          "minimum": 0
        }
      }
    },
    "CoverageReport": {
      "title": "CoverageReport",
      "description": "覆盖率以插件生成的第一方文件清单为分母，禁止由 Agent 自报节点数量计算。",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "includedSources",
        "includedConfigs",
        "includedAssets",
        "classified",
        "unclassified",
        "excluded",
        "failed",
        "reasons",
        "computedAt"
      ],
      "properties": {
        "includedSources": {
          "type": "integer",
          "minimum": 0
        },
        "includedConfigs": {
          "type": "integer",
          "minimum": 0
        },
        "includedAssets": {
          "type": "integer",
          "minimum": 0
        },
        "classified": {
          "type": "integer",
          "minimum": 0
        },
        "unclassified": {
          "type": "integer",
          "minimum": 0
        },
        "excluded": {
          "type": "integer",
          "minimum": 0
        },
        "failed": {
          "type": "integer",
          "minimum": 0
        },
        "unclassifiedPaths": {
          "type": "array",
          "maxItems": 5000,
          "items": {
            "$ref": "common.schema.json#/$defs/WorkspacePath"
          }
        },
        "reasons": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/CoverageReason"
          }
        },
        "computedAt": {
          "$ref": "common.schema.json#/$defs/Timestamp"
        }
      }
    },
    "GuidedStoryStep": {
      "title": "GuidedStoryStep",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "order",
        "focusNodeIds",
        "caption"
      ],
      "properties": {
        "order": {
          "type": "integer",
          "minimum": 0
        },
        "focusNodeIds": {
          "type": "array",
          "minItems": 1,
          "maxItems": 20,
          "items": {
            "$ref": "common.schema.json#/$defs/Identifier"
          }
        },
        "focusEdgeIds": {
          "type": "array",
          "maxItems": 20,
          "items": {
            "$ref": "common.schema.json#/$defs/Identifier"
          }
        },
        "caption": {
          "type": "string",
          "minLength": 1,
          "maxLength": 24
        },
        "cameraHint": {
          "type": "string",
          "enum": [
            "fit",
            "focus",
            "overview"
          ]
        }
      }
    },
    "GuidedStory": {
      "title": "GuidedStory",
      "description": "Agent 只提交声明式讲解，不提交任何 HTML、SVG、CSS 或脚本。",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "type",
        "title",
        "steps"
      ],
      "properties": {
        "id": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "type": {
          "type": "string",
          "enum": [
            "project_intro",
            "key_flow",
            "change_replay"
          ]
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 40
        },
        "steps": {
          "type": "array",
          "minItems": 3,
          "maxItems": 8,
          "items": {
            "$ref": "#/$defs/GuidedStoryStep"
          }
        }
      }
    },
    "AnnotationTarget": {
      "title": "AnnotationTarget",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "mapRevision"
      ],
      "properties": {
        "nodeIds": {
          "type": "array",
          "maxItems": 20,
          "items": {
            "$ref": "common.schema.json#/$defs/Identifier"
          }
        },
        "edgeIds": {
          "type": "array",
          "maxItems": 20,
          "items": {
            "$ref": "common.schema.json#/$defs/Identifier"
          }
        },
        "storyId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "changeSetId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "codeLocations": {
          "type": "array",
          "maxItems": 50,
          "items": {
            "$ref": "common.schema.json#/$defs/CodeLocation"
          }
        },
        "mapRevision": {
          "type": "integer",
          "minimum": 0
        },
        "baseGitRevision": {
          "type": "string",
          "maxLength": 100
        }
      }
    },
    "AnnotationMessage": {
      "title": "AnnotationMessage",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "author",
        "body",
        "createdAt"
      ],
      "properties": {
        "id": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "author": {
          "type": "string",
          "enum": [
            "user",
            "agent",
            "system"
          ]
        },
        "body": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4000
        },
        "detail": {
          "type": "string",
          "maxLength": 12000
        },
        "evidence": {
          "type": "array",
          "maxItems": 50,
          "items": {
            "$ref": "common.schema.json#/$defs/Evidence"
          }
        },
        "uncertain": {
          "type": "boolean"
        },
        "createdAt": {
          "$ref": "common.schema.json#/$defs/Timestamp"
        }
      }
    },
    "AnnotationThread": {
      "title": "AnnotationThread",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "type",
        "status",
        "target",
        "messages",
        "createdAt"
      ],
      "properties": {
        "id": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "type": {
          "type": "string",
          "enum": [
            "note",
            "explain",
            "change",
            "risk"
          ]
        },
        "status": {
          "type": "string",
          "enum": [
            "draft",
            "sent",
            "answered",
            "resolved",
            "write_requested",
            "plan_proposed",
            "approved",
            "in_progress",
            "rejected",
            "cancelled",
            "needs_clarification"
          ]
        },
        "target": {
          "$ref": "#/$defs/AnnotationTarget"
        },
        "messages": {
          "type": "array",
          "minItems": 1,
          "maxItems": 100,
          "items": {
            "$ref": "#/$defs/AnnotationMessage"
          }
        },
        "createdAt": {
          "$ref": "common.schema.json#/$defs/Timestamp"
        },
        "resolvedAt": {
          "$ref": "common.schema.json#/$defs/Timestamp"
        },
        "pinned": {
          "type": "boolean"
        }
      }
    },
    "WriteAccessRequest": {
      "title": "WriteAccessRequest",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "annotationId",
        "status",
        "reason",
        "expectedScope",
        "requestedAt"
      ],
      "properties": {
        "id": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "annotationId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "status": {
          "type": "string",
          "enum": [
            "requested",
            "dismissed",
            "converted"
          ]
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "expectedScope": {
          "type": "array",
          "minItems": 1,
          "maxItems": 500,
          "items": {
            "$ref": "common.schema.json#/$defs/WorkspacePath"
          }
        },
        "requestedAt": {
          "$ref": "common.schema.json#/$defs/Timestamp"
        }
      }
    },
    "ChangeProposal": {
      "title": "ChangeProposal",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "annotationId",
        "requestId",
        "status",
        "summary",
        "plannedFiles",
        "structuralChanges",
        "risks",
        "validationPlan",
        "branchKey",
        "baseMapRevision",
        "createdAt"
      ],
      "properties": {
        "id": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "annotationId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "requestId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "status": {
          "type": "string",
          "enum": [
            "proposed",
            "approved",
            "rejected",
            "cancelled",
            "stale"
          ]
        },
        "summary": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "plannedFiles": {
          "type": "array",
          "minItems": 1,
          "maxItems": 500,
          "items": {
            "$ref": "common.schema.json#/$defs/WorkspacePath"
          }
        },
        "structuralChanges": {
          "type": "array",
          "maxItems": 100,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 300
          }
        },
        "risks": {
          "type": "array",
          "maxItems": 50,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 300
          }
        },
        "validationPlan": {
          "type": "array",
          "minItems": 1,
          "maxItems": 50,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 300
          }
        },
        "branchKey": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "baseMapRevision": {
          "type": "integer",
          "minimum": 0
        },
        "baseGitRevision": {
          "type": "string",
          "maxLength": 100
        },
        "createdAt": {
          "$ref": "common.schema.json#/$defs/Timestamp"
        },
        "approval": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "token",
            "approvedScope",
            "permissionMode",
            "approvedAt",
            "expiresAt",
            "branchKey",
            "mapRevision",
            "preexistingChanges"
          ],
          "properties": {
            "token": {
              "$ref": "common.schema.json#/$defs/Identifier"
            },
            "approvedScope": {
              "type": "array",
              "minItems": 1,
              "maxItems": 500,
              "items": {
                "$ref": "common.schema.json#/$defs/WorkspacePath"
              }
            },
            "permissionMode": {
              "type": "string",
              "enum": [
                "enforced",
                "monitored"
              ]
            },
            "approvedAt": {
              "$ref": "common.schema.json#/$defs/Timestamp"
            },
            "expiresAt": {
              "$ref": "common.schema.json#/$defs/Timestamp"
            },
            "branchKey": {
              "$ref": "common.schema.json#/$defs/Identifier"
            },
            "mapRevision": {
              "type": "integer",
              "minimum": 0
            },
            "gitRevision": {
              "type": "string",
              "maxLength": 100
            },
            "preexistingChanges": {
              "type": "array",
              "maxItems": 2000,
              "items": {
                "$ref": "common.schema.json#/$defs/WorkspacePath"
              }
            }
          }
        }
      }
    },
    "GraphSnapshotDocument": {
      "title": "GraphSnapshotDocument",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "workspaceId",
        "branchKey",
        "revision",
        "lastEventSeq",
        "createdAt",
        "nodes",
        "edges",
        "appliedEventIds"
      ],
      "properties": {
        "schemaVersion": {
          "$ref": "common.schema.json#/$defs/ProtocolVersion"
        },
        "workspaceId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "branchKey": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "revision": {
          "type": "integer",
          "minimum": 0
        },
        "lastEventSeq": {
          "type": "integer",
          "minimum": 0
        },
        "baseGitRevision": {
          "type": "string",
          "maxLength": 100
        },
        "createdAt": {
          "$ref": "common.schema.json#/$defs/Timestamp"
        },
        "nodes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/GraphNode"
          }
        },
        "edges": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/GraphEdge"
          }
        },
        "activeChanges": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/ActiveChange"
          }
        },
        "stories": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/GuidedStory"
          }
        },
        "annotations": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/AnnotationThread"
          }
        },
        "writeAccessRequests": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/WriteAccessRequest"
          }
        },
        "changeProposals": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/ChangeProposal"
          }
        },
        "completedChanges": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/CompletedChange"
          }
        },
        "coverage": {
          "$ref": "#/$defs/CoverageReport"
        },
        "appliedEventIds": {
          "type": "array",
          "description": "用于幂等的已处理事件 ID，按字典序排序。",
          "items": {
            "$ref": "common.schema.json#/$defs/Identifier"
          }
        }
      }
    },
    "CompletedChange": {
      "title": "CompletedChange",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "changeSetId",
        "proposalId",
        "status",
        "completedAt",
        "plannedFiles",
        "actualFiles",
        "diff"
      ],
      "properties": {
        "changeSetId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "proposalId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "status": {
          "type": "string",
          "enum": [
            "pending_review",
            "accepted",
            "accepted_with_issues",
            "failed",
            "interrupted"
          ]
        },
        "completedAt": {
          "$ref": "common.schema.json#/$defs/Timestamp"
        },
        "plannedFiles": {
          "type": "array",
          "items": {
            "$ref": "common.schema.json#/$defs/WorkspacePath"
          }
        },
        "actualFiles": {
          "type": "array",
          "items": {
            "$ref": "common.schema.json#/$defs/WorkspacePath"
          }
        },
        "touchedNodeIds": {
          "type": "array",
          "items": {
            "$ref": "common.schema.json#/$defs/Identifier"
          }
        },
        "touchedEdgeIds": {
          "type": "array",
          "items": {
            "$ref": "common.schema.json#/$defs/Identifier"
          }
        },
        "diff": {
          "$ref": "#/$defs/ChangeDiffSummary"
        },
        "note": {
          "type": "string",
          "maxLength": 500
        }
      }
    }
  }
};

export const toolsSchema: SchemaObject = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "tools.schema.json",
  "title": "GodViewTools",
  "description": "Agent 工具的入参与返回。返回值必须告诉 Agent 事件是否被接受、当前地图版本以及校验错误，使 Agent 能立即修正。",
  "$defs": {
    "ToolError": {
      "title": "ToolError",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "code",
        "message"
      ],
      "properties": {
        "code": {
          "type": "string",
          "pattern": "^[A-Z][A-Z0-9_]*$"
        },
        "message": {
          "type": "string",
          "maxLength": 500
        },
        "path": {
          "type": "string",
          "maxLength": 200
        }
      }
    },
    "ToolResult": {
      "title": "ToolResult",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "accepted",
        "mapRevision",
        "errors"
      ],
      "properties": {
        "accepted": {
          "type": "boolean"
        },
        "mapRevision": {
          "type": "integer",
          "minimum": 0
        },
        "eventId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "changeSetId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "scopeExpansionRequest": {
          "$ref": "graph.schema.json#/$defs/ScopeExpansionRequest"
        },
        "errors": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/ToolError"
          }
        },
        "warnings": {
          "type": "array",
          "items": {
            "$ref": "common.schema.json#/$defs/ShortNote"
          }
        }
      }
    },
    "SessionScopedInput": {
      "title": "SessionScopedInput",
      "description": "所有写工具的公共入参。idempotencyKey 重复提交同一 key 不产生重复节点或关系。",
      "type": "object",
      "required": [
        "sessionId",
        "idempotencyKey"
      ],
      "properties": {
        "sessionId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "idempotencyKey": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "baseMapRevision": {
          "type": "integer",
          "minimum": 0
        },
        "changeSetId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        }
      }
    },
    "GetMapInput": {
      "title": "GetMapInput",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "includeCoverage": {
          "type": "boolean",
          "default": true
        },
        "nodeIds": {
          "type": "array",
          "maxItems": 200,
          "items": {
            "$ref": "common.schema.json#/$defs/Identifier"
          }
        }
      }
    },
    "GetMapResult": {
      "title": "GetMapResult",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "mapRevision",
        "branchKey",
        "nodes",
        "edges"
      ],
      "properties": {
        "mapRevision": {
          "type": "integer",
          "minimum": 0
        },
        "branchKey": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "nodes": {
          "type": "array",
          "items": {
            "$ref": "graph.schema.json#/$defs/GraphNode"
          }
        },
        "edges": {
          "type": "array",
          "items": {
            "$ref": "graph.schema.json#/$defs/GraphEdge"
          }
        },
        "stories": {
          "type": "array",
          "items": {
            "$ref": "graph.schema.json#/$defs/GuidedStory"
          }
        },
        "annotations": {
          "type": "array",
          "items": {
            "$ref": "graph.schema.json#/$defs/AnnotationThread"
          }
        },
        "writeAccessRequests": {
          "type": "array",
          "items": {
            "$ref": "graph.schema.json#/$defs/WriteAccessRequest"
          }
        },
        "changeProposals": {
          "type": "array",
          "items": {
            "$ref": "graph.schema.json#/$defs/ChangeProposal"
          }
        },
        "activeChanges": {
          "type": "array",
          "items": {
            "$ref": "graph.schema.json#/$defs/ActiveChange"
          }
        },
        "coverage": {
          "$ref": "graph.schema.json#/$defs/CoverageReport"
        }
      }
    },
    "BeginChangeInput": {
      "title": "BeginChangeInput",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/SessionScopedInput"
        },
        {
          "type": "object",
          "required": [
            "intent"
          ],
          "properties": {
            "intent": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "plannedFiles": {
              "type": "array",
              "maxItems": 500,
              "items": {
                "$ref": "common.schema.json#/$defs/WorkspacePath"
              }
            }
          }
        }
      ]
    },
    "UpsertNodeInput": {
      "title": "UpsertNodeInput",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/SessionScopedInput"
        },
        {
          "type": "object",
          "required": [
            "node"
          ],
          "properties": {
            "node": {
              "$ref": "events.schema.json#/$defs/AgentNodeDeclaration"
            }
          }
        }
      ]
    },
    "UpsertEdgeInput": {
      "title": "UpsertEdgeInput",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/SessionScopedInput"
        },
        {
          "type": "object",
          "required": [
            "edge"
          ],
          "properties": {
            "edge": {
              "$ref": "events.schema.json#/$defs/AgentEdgeDeclaration"
            }
          }
        }
      ]
    },
    "RemoveEntityInput": {
      "title": "RemoveEntityInput",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/SessionScopedInput"
        },
        {
          "type": "object",
          "required": [
            "entityId",
            "reason"
          ],
          "properties": {
            "entityId": {
              "$ref": "common.schema.json#/$defs/Identifier"
            },
            "reason": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            }
          }
        }
      ]
    },
    "CompleteChangeInput": {
      "title": "CompleteChangeInput",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/SessionScopedInput"
        },
        {
          "type": "object",
          "required": [
            "changeSetId",
            "status"
          ],
          "properties": {
            "changeSetId": {
              "$ref": "common.schema.json#/$defs/Identifier"
            },
            "status": {
              "$ref": "common.schema.json#/$defs/CompletionStatus"
            },
            "actualFiles": {
              "type": "array",
              "maxItems": 2000,
              "items": {
                "$ref": "common.schema.json#/$defs/WorkspacePath"
              }
            },
            "note": {
              "type": "string",
              "maxLength": 500
            }
          }
        }
      ]
    },
    "UpsertStoryInput": {
      "title": "UpsertStoryInput",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/SessionScopedInput"
        },
        {
          "type": "object",
          "required": [
            "story"
          ],
          "properties": {
            "story": {
              "$ref": "graph.schema.json#/$defs/GuidedStory"
            }
          }
        }
      ]
    },
    "AnswerAnnotationInput": {
      "title": "AnswerAnnotationInput",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/SessionScopedInput"
        },
        {
          "type": "object",
          "required": [
            "annotationId",
            "summary"
          ],
          "properties": {
            "annotationId": {
              "$ref": "common.schema.json#/$defs/Identifier"
            },
            "summary": {
              "type": "string",
              "minLength": 1,
              "maxLength": 500
            },
            "detail": {
              "type": "string",
              "maxLength": 12000
            },
            "evidence": {
              "type": "array",
              "maxItems": 50,
              "items": {
                "$ref": "common.schema.json#/$defs/Evidence"
              }
            },
            "uncertain": {
              "type": "boolean"
            },
            "story": {
              "$ref": "graph.schema.json#/$defs/GuidedStory"
            }
          }
        }
      ]
    },
    "RequestWriteAccessInput": {
      "title": "RequestWriteAccessInput",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/SessionScopedInput"
        },
        {
          "type": "object",
          "required": [
            "annotationId",
            "reason",
            "expectedScope"
          ],
          "properties": {
            "annotationId": {
              "$ref": "common.schema.json#/$defs/Identifier"
            },
            "reason": {
              "type": "string",
              "minLength": 1,
              "maxLength": 500
            },
            "expectedScope": {
              "type": "array",
              "minItems": 1,
              "maxItems": 500,
              "items": {
                "$ref": "common.schema.json#/$defs/WorkspacePath"
              }
            }
          }
        }
      ]
    },
    "ProposeChangeInput": {
      "title": "ProposeChangeInput",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/SessionScopedInput"
        },
        {
          "type": "object",
          "required": [
            "annotationId",
            "requestId",
            "summary",
            "plannedFiles",
            "structuralChanges",
            "risks",
            "validationPlan",
            "baseMapRevision"
          ],
          "properties": {
            "annotationId": {
              "$ref": "common.schema.json#/$defs/Identifier"
            },
            "requestId": {
              "$ref": "common.schema.json#/$defs/Identifier"
            },
            "summary": {
              "type": "string",
              "minLength": 1,
              "maxLength": 500
            },
            "plannedFiles": {
              "type": "array",
              "minItems": 1,
              "maxItems": 500,
              "items": {
                "$ref": "common.schema.json#/$defs/WorkspacePath"
              }
            },
            "structuralChanges": {
              "type": "array",
              "maxItems": 100,
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 300
              }
            },
            "risks": {
              "type": "array",
              "maxItems": 50,
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 300
              }
            },
            "validationPlan": {
              "type": "array",
              "minItems": 1,
              "maxItems": 50,
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 300
              }
            },
            "baseMapRevision": {
              "type": "integer",
              "minimum": 0
            },
            "baseGitRevision": {
              "type": "string",
              "maxLength": 100
            }
          }
        }
      ]
    },
    "StartApprovedChangeInput": {
      "title": "StartApprovedChangeInput",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/SessionScopedInput"
        },
        {
          "type": "object",
          "required": [
            "proposalId",
            "approvalToken"
          ],
          "properties": {
            "proposalId": {
              "$ref": "common.schema.json#/$defs/Identifier"
            },
            "approvalToken": {
              "$ref": "common.schema.json#/$defs/Identifier"
            }
          }
        }
      ]
    },
    "RequestScopeExpansionInput": {
      "title": "RequestScopeExpansionInput",
      "description": "在修改任何未批准路径之前申请扩大当前 ChangeSet 范围；调用后必须等待用户决定。",
      "type": "object",
      "unevaluatedProperties": false,
      "allOf": [
        {
          "$ref": "#/$defs/SessionScopedInput"
        },
        {
          "type": "object",
          "required": [
            "changeSetId",
            "requestedFiles",
            "reason",
            "baseMapRevision"
          ],
          "properties": {
            "changeSetId": {
              "$ref": "common.schema.json#/$defs/Identifier"
            },
            "requestedFiles": {
              "type": "array",
              "minItems": 1,
              "maxItems": 100,
              "uniqueItems": true,
              "items": {
                "$ref": "common.schema.json#/$defs/WorkspacePath"
              }
            },
            "reason": {
              "type": "string",
              "minLength": 1,
              "maxLength": 500
            }
          }
        }
      ]
    },
    "AdapterCapabilities": {
      "title": "AdapterCapabilities",
      "description": "UI 只展示 Adapter 真实声明的能力，不通过 Agent 名称猜测。",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "adapterId",
        "protocolVersion",
        "canBeInvoked",
        "supportsMcp",
        "explainPermissionMode",
        "supportsCancellation",
        "maySendCodeToCloud"
      ],
      "properties": {
        "adapterId": {
          "$ref": "common.schema.json#/$defs/Identifier"
        },
        "displayName": {
          "type": "string",
          "maxLength": 100
        },
        "protocolVersion": {
          "$ref": "common.schema.json#/$defs/ProtocolVersion"
        },
        "canBeInvoked": {
          "type": "boolean"
        },
        "supportsMcp": {
          "type": "boolean"
        },
        "explainPermissionMode": {
          "type": "string",
          "enum": [
            "enforced",
            "monitored"
          ],
          "description": "enforced 表示运行时强制限制；monitored 表示只能通过文件/Git 变化监控，不得描述为强制。"
        },
        "supportsScopeEnforcement": {
          "type": "boolean"
        },
        "supportsCancellation": {
          "type": "boolean"
        },
        "supportsStreaming": {
          "type": "boolean"
        },
        "maySendCodeToCloud": {
          "type": "boolean",
          "description": "Adapter 无法确认数据去向时必须为 true。"
        },
        "costEstimateAvailable": {
          "type": "boolean"
        }
      }
    }
  }
};

export const runtimeSchemas: readonly SchemaObject[] = [commonSchema, eventsSchema, graphSchema, toolsSchema];
