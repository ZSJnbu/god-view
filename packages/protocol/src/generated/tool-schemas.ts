/* eslint-disable */
/**
 * 本文件由 packages/protocol/scripts/generate-types.mts 从 schema/*.schema.json 生成。
 * 请勿手工修改；修改协议请编辑 JSON Schema 后运行 `pnpm run generate`。
 */

import type { SchemaObject } from 'ajv';

export const toolInputSchemas: Readonly<Record<string, SchemaObject>> = {
  "get_map": {
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
        "title": "Identifier",
        "type": "string",
        "minLength": 1,
        "maxLength": 200,
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
      }
    }
  }
},
  "begin_change": {
  "title": "BeginChangeInput",
  "type": "object",
  "unevaluatedProperties": false,
  "allOf": [
    {
      "title": "SessionScopedInput",
      "description": "所有写工具的公共入参。idempotencyKey 重复提交同一 key 不产生重复节点或关系。",
      "type": "object",
      "required": [
        "sessionId",
        "idempotencyKey"
      ],
      "properties": {
        "sessionId": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        },
        "idempotencyKey": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        },
        "baseMapRevision": {
          "type": "integer",
          "minimum": 0
        },
        "changeSetId": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        }
      }
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
            "title": "WorkspacePath",
            "type": "string",
            "minLength": 1,
            "maxLength": 1024,
            "pattern": "^(?![/\\\\])(?!.*(?:^|[/\\\\])\\.\\.(?:[/\\\\]|$))(?!.*:[/\\\\][/\\\\]).+$",
            "description": "工作区相对路径。拒绝绝对路径、盘符 URI 和 .. 穿越。"
          }
        }
      }
    }
  ]
},
  "upsert_node": {
  "title": "UpsertNodeInput",
  "type": "object",
  "unevaluatedProperties": false,
  "allOf": [
    {
      "title": "SessionScopedInput",
      "description": "所有写工具的公共入参。idempotencyKey 重复提交同一 key 不产生重复节点或关系。",
      "type": "object",
      "required": [
        "sessionId",
        "idempotencyKey"
      ],
      "properties": {
        "sessionId": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        },
        "idempotencyKey": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        },
        "baseMapRevision": {
          "type": "integer",
          "minimum": 0
        },
        "changeSetId": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        }
      }
    },
    {
      "type": "object",
      "required": [
        "node"
      ],
      "properties": {
        "node": {
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
              "title": "Identifier",
              "type": "string",
              "minLength": 1,
              "maxLength": 200,
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
            },
            "type": {
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
              "title": "Identifier",
              "type": "string",
              "minLength": 1,
              "maxLength": 200,
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
            },
            "paths": {
              "type": "array",
              "maxItems": 500,
              "items": {
                "title": "WorkspacePath",
                "type": "string",
                "minLength": 1,
                "maxLength": 1024,
                "pattern": "^(?![/\\\\])(?!.*(?:^|[/\\\\])\\.\\.(?:[/\\\\]|$))(?!.*:[/\\\\][/\\\\]).+$",
                "description": "工作区相对路径。拒绝绝对路径、盘符 URI 和 .. 穿越。"
              }
            },
            "locations": {
              "type": "array",
              "maxItems": 50,
              "items": {
                "title": "CodeLocation",
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "path"
                ],
                "properties": {
                  "path": {
                    "title": "WorkspacePath",
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 1024,
                    "pattern": "^(?![/\\\\])(?!.*(?:^|[/\\\\])\\.\\.(?:[/\\\\]|$))(?!.*:[/\\\\][/\\\\]).+$",
                    "description": "工作区相对路径。拒绝绝对路径、盘符 URI 和 .. 穿越。"
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
              }
            },
            "evidence": {
              "type": "array",
              "maxItems": 50,
              "items": {
                "title": "Evidence",
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "kind"
                ],
                "properties": {
                  "kind": {
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
                  "location": {
                    "title": "CodeLocation",
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "path"
                    ],
                    "properties": {
                      "path": {
                        "title": "WorkspacePath",
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 1024,
                        "pattern": "^(?![/\\\\])(?!.*(?:^|[/\\\\])\\.\\.(?:[/\\\\]|$))(?!.*:[/\\\\][/\\\\]).+$",
                        "description": "工作区相对路径。拒绝绝对路径、盘符 URI 和 .. 穿越。"
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
                  "detail": {
                    "type": "string",
                    "maxLength": 500
                  }
                }
              }
            },
            "uncertainties": {
              "type": "array",
              "maxItems": 20,
              "items": {
                "title": "ShortNote",
                "type": "string",
                "minLength": 1,
                "maxLength": 200
              }
            },
            "visualHint": {
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
        }
      }
    }
  ]
},
  "upsert_edge": {
  "title": "UpsertEdgeInput",
  "type": "object",
  "unevaluatedProperties": false,
  "allOf": [
    {
      "title": "SessionScopedInput",
      "description": "所有写工具的公共入参。idempotencyKey 重复提交同一 key 不产生重复节点或关系。",
      "type": "object",
      "required": [
        "sessionId",
        "idempotencyKey"
      ],
      "properties": {
        "sessionId": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        },
        "idempotencyKey": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        },
        "baseMapRevision": {
          "type": "integer",
          "minimum": 0
        },
        "changeSetId": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        }
      }
    },
    {
      "type": "object",
      "required": [
        "edge"
      ],
      "properties": {
        "edge": {
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
              "title": "Identifier",
              "type": "string",
              "minLength": 1,
              "maxLength": 200,
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
            },
            "from": {
              "title": "Identifier",
              "type": "string",
              "minLength": 1,
              "maxLength": 200,
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
            },
            "to": {
              "title": "Identifier",
              "type": "string",
              "minLength": 1,
              "maxLength": 200,
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
            },
            "type": {
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
            "reason": {
              "type": "string",
              "maxLength": 200
            },
            "evidence": {
              "type": "array",
              "maxItems": 50,
              "items": {
                "title": "Evidence",
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "kind"
                ],
                "properties": {
                  "kind": {
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
                  "location": {
                    "title": "CodeLocation",
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "path"
                    ],
                    "properties": {
                      "path": {
                        "title": "WorkspacePath",
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 1024,
                        "pattern": "^(?![/\\\\])(?!.*(?:^|[/\\\\])\\.\\.(?:[/\\\\]|$))(?!.*:[/\\\\][/\\\\]).+$",
                        "description": "工作区相对路径。拒绝绝对路径、盘符 URI 和 .. 穿越。"
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
                  "detail": {
                    "type": "string",
                    "maxLength": 500
                  }
                }
              }
            }
          }
        }
      }
    }
  ]
},
  "remove_entity": {
  "title": "RemoveEntityInput",
  "type": "object",
  "unevaluatedProperties": false,
  "allOf": [
    {
      "title": "SessionScopedInput",
      "description": "所有写工具的公共入参。idempotencyKey 重复提交同一 key 不产生重复节点或关系。",
      "type": "object",
      "required": [
        "sessionId",
        "idempotencyKey"
      ],
      "properties": {
        "sessionId": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        },
        "idempotencyKey": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        },
        "baseMapRevision": {
          "type": "integer",
          "minimum": 0
        },
        "changeSetId": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        }
      }
    },
    {
      "type": "object",
      "required": [
        "entityId",
        "reason"
      ],
      "properties": {
        "entityId": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
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
  "complete_change": {
  "title": "CompleteChangeInput",
  "type": "object",
  "unevaluatedProperties": false,
  "allOf": [
    {
      "title": "SessionScopedInput",
      "description": "所有写工具的公共入参。idempotencyKey 重复提交同一 key 不产生重复节点或关系。",
      "type": "object",
      "required": [
        "sessionId",
        "idempotencyKey"
      ],
      "properties": {
        "sessionId": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        },
        "idempotencyKey": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        },
        "baseMapRevision": {
          "type": "integer",
          "minimum": 0
        },
        "changeSetId": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        }
      }
    },
    {
      "type": "object",
      "required": [
        "changeSetId",
        "status"
      ],
      "properties": {
        "changeSetId": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        },
        "status": {
          "title": "CompletionStatus",
          "type": "string",
          "enum": [
            "completed",
            "failed",
            "interrupted"
          ],
          "description": "失败或中断只结束临时预览并记录状态，已经产生的代码改动不自动回滚。"
        },
        "actualFiles": {
          "type": "array",
          "maxItems": 2000,
          "items": {
            "title": "WorkspacePath",
            "type": "string",
            "minLength": 1,
            "maxLength": 1024,
            "pattern": "^(?![/\\\\])(?!.*(?:^|[/\\\\])\\.\\.(?:[/\\\\]|$))(?!.*:[/\\\\][/\\\\]).+$",
            "description": "工作区相对路径。拒绝绝对路径、盘符 URI 和 .. 穿越。"
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
  "upsert_story": {
  "title": "UpsertStoryInput",
  "type": "object",
  "unevaluatedProperties": false,
  "allOf": [
    {
      "title": "SessionScopedInput",
      "description": "所有写工具的公共入参。idempotencyKey 重复提交同一 key 不产生重复节点或关系。",
      "type": "object",
      "required": [
        "sessionId",
        "idempotencyKey"
      ],
      "properties": {
        "sessionId": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        },
        "idempotencyKey": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        },
        "baseMapRevision": {
          "type": "integer",
          "minimum": 0
        },
        "changeSetId": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        }
      }
    },
    {
      "type": "object",
      "required": [
        "story"
      ],
      "properties": {
        "story": {
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
              "title": "Identifier",
              "type": "string",
              "minLength": 1,
              "maxLength": 200,
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
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
                      "title": "Identifier",
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 200,
                      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
                    }
                  },
                  "focusEdgeIds": {
                    "type": "array",
                    "maxItems": 20,
                    "items": {
                      "title": "Identifier",
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 200,
                      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
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
              }
            }
          }
        }
      }
    }
  ]
},
  "answer_annotation": {
  "title": "AnswerAnnotationInput",
  "type": "object",
  "unevaluatedProperties": false,
  "allOf": [
    {
      "title": "SessionScopedInput",
      "description": "所有写工具的公共入参。idempotencyKey 重复提交同一 key 不产生重复节点或关系。",
      "type": "object",
      "required": [
        "sessionId",
        "idempotencyKey"
      ],
      "properties": {
        "sessionId": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        },
        "idempotencyKey": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        },
        "baseMapRevision": {
          "type": "integer",
          "minimum": 0
        },
        "changeSetId": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        }
      }
    },
    {
      "type": "object",
      "required": [
        "annotationId",
        "summary"
      ],
      "properties": {
        "annotationId": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
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
            "title": "Evidence",
            "type": "object",
            "additionalProperties": false,
            "required": [
              "kind"
            ],
            "properties": {
              "kind": {
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
              "location": {
                "title": "CodeLocation",
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "path"
                ],
                "properties": {
                  "path": {
                    "title": "WorkspacePath",
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 1024,
                    "pattern": "^(?![/\\\\])(?!.*(?:^|[/\\\\])\\.\\.(?:[/\\\\]|$))(?!.*:[/\\\\][/\\\\]).+$",
                    "description": "工作区相对路径。拒绝绝对路径、盘符 URI 和 .. 穿越。"
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
              "detail": {
                "type": "string",
                "maxLength": 500
              }
            }
          }
        },
        "uncertain": {
          "type": "boolean"
        },
        "story": {
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
              "title": "Identifier",
              "type": "string",
              "minLength": 1,
              "maxLength": 200,
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
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
                      "title": "Identifier",
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 200,
                      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
                    }
                  },
                  "focusEdgeIds": {
                    "type": "array",
                    "maxItems": 20,
                    "items": {
                      "title": "Identifier",
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 200,
                      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
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
              }
            }
          }
        }
      }
    }
  ]
},
  "request_write_access": {
  "title": "RequestWriteAccessInput",
  "type": "object",
  "unevaluatedProperties": false,
  "allOf": [
    {
      "title": "SessionScopedInput",
      "description": "所有写工具的公共入参。idempotencyKey 重复提交同一 key 不产生重复节点或关系。",
      "type": "object",
      "required": [
        "sessionId",
        "idempotencyKey"
      ],
      "properties": {
        "sessionId": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        },
        "idempotencyKey": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        },
        "baseMapRevision": {
          "type": "integer",
          "minimum": 0
        },
        "changeSetId": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        }
      }
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
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
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
            "title": "WorkspacePath",
            "type": "string",
            "minLength": 1,
            "maxLength": 1024,
            "pattern": "^(?![/\\\\])(?!.*(?:^|[/\\\\])\\.\\.(?:[/\\\\]|$))(?!.*:[/\\\\][/\\\\]).+$",
            "description": "工作区相对路径。拒绝绝对路径、盘符 URI 和 .. 穿越。"
          }
        }
      }
    }
  ]
},
  "propose_change": {
  "title": "ProposeChangeInput",
  "type": "object",
  "unevaluatedProperties": false,
  "allOf": [
    {
      "title": "SessionScopedInput",
      "description": "所有写工具的公共入参。idempotencyKey 重复提交同一 key 不产生重复节点或关系。",
      "type": "object",
      "required": [
        "sessionId",
        "idempotencyKey"
      ],
      "properties": {
        "sessionId": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        },
        "idempotencyKey": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        },
        "baseMapRevision": {
          "type": "integer",
          "minimum": 0
        },
        "changeSetId": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        }
      }
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
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        },
        "requestId": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
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
            "title": "WorkspacePath",
            "type": "string",
            "minLength": 1,
            "maxLength": 1024,
            "pattern": "^(?![/\\\\])(?!.*(?:^|[/\\\\])\\.\\.(?:[/\\\\]|$))(?!.*:[/\\\\][/\\\\]).+$",
            "description": "工作区相对路径。拒绝绝对路径、盘符 URI 和 .. 穿越。"
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
  "start_approved_change": {
  "title": "StartApprovedChangeInput",
  "type": "object",
  "unevaluatedProperties": false,
  "allOf": [
    {
      "title": "SessionScopedInput",
      "description": "所有写工具的公共入参。idempotencyKey 重复提交同一 key 不产生重复节点或关系。",
      "type": "object",
      "required": [
        "sessionId",
        "idempotencyKey"
      ],
      "properties": {
        "sessionId": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        },
        "idempotencyKey": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        },
        "baseMapRevision": {
          "type": "integer",
          "minimum": 0
        },
        "changeSetId": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        }
      }
    },
    {
      "type": "object",
      "required": [
        "proposalId",
        "approvalToken"
      ],
      "properties": {
        "proposalId": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        },
        "approvalToken": {
          "title": "Identifier",
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
        }
      }
    }
  ]
},
};
