# God View 技术架构与技术选型

> 状态：MVP 技术基线 / 部分选型待原型验证
> 关联文档：[产品需求文档](../PRD.md)
> 更新时间：2026-08-07

## 1. 文档目的

本文定义 God View 的工程边界、核心架构、技术选型和验证计划。它用于指导实现，不替代产品需求、编码规范或质量规范。

架构必须优先满足以下目标：

1. Agent 能以统一协议增量维护项目地图；
2. VS Code Extension Host 不被图计算、文件校验或动画阻塞；
3. Agent 声明、代码事实和系统推断可以独立追溯；
4. 解释请求默认不获得 God View 写入授权；Agent 可申请写入入口，但修改必须经过明确批准；
5. 协议、图状态和 UI 可分别测试、替换和演进；
6. MVP 能快速验证，不提前建设不需要的分布式系统。

## 2. 架构决策摘要

| 领域               | MVP 选择                                                          | 状态            | 原因                                                |
| ------------------ | ----------------------------------------------------------------- | --------------- | --------------------------------------------------- |
| IDE 宿主           | VS Code Extension API                                             | 已决定          | 与产品入口一致，具备工作区、编辑器和 Webview 能力   |
| 主语言             | TypeScript 严格模式                                               | 已决定          | 扩展、Agent Gateway 和 Webview 可共享类型与工具链   |
| 仓库结构           | pnpm workspace 单仓库                                             | 已决定          | 严格依赖边界，适合多个可独立测试的包                |
| 扩展构建           | esbuild                                                           | 已决定          | 启动快，适合扩展与 Node 侧 bundle                   |
| Webview            | React + Vite                                                      | 已决定          | 适合复杂交互、独立开发和测试                        |
| 图渲染             | Cytoscape.js                                                      | 待 Stage 0 验证 | 图交互和算法成熟，适合节点/边语义；必须通过大图基准 |
| 分层布局           | ELK.js                                                            | 待 Stage 0 验证 | 适合“入口—核心—存储/外部”的方向性布局               |
| UI 状态            | Zustand                                                           | 已决定          | API 小，适合将服务端图快照与临时交互状态分离        |
| 协议定义           | JSON Schema 为真源 + Ajv 校验                                     | 已决定          | 跨 Agent/语言，能生成类型并进行运行时验证           |
| Agent 接入         | Codex + Claude Code 正式 Adapter；统一 MCP 契约；CLI/事件文件兜底 | 已决定          | 两个 Agent 均须完成初始化、解释和批准后修改闭环     |
| 持久化             | 追加事件日志 + 周期快照                                           | 已决定          | 支持回放、审计、幂等和故障恢复                      |
| MVP 存储格式       | JSONL 日志 + JSON 快照                                            | 待压测确认      | 无原生依赖、易调试；如性能不足再通过存储接口替换    |
| 单元/契约测试      | Vitest                                                            | 已决定          | TypeScript 生态统一、执行快                         |
| 扩展集成测试       | `@vscode/test-electron`                                           | 已决定          | 在真实 Extension Host 验证 VS Code 行为             |
| Webview 端到端测试 | Playwright + 独立测试壳                                           | 已决定          | 可稳定验证交互、动画和无障碍，不依赖完整 VS Code UI |
| 格式与静态检查     | ESLint + typescript-eslint + Prettier                             | 已决定          | 自动化执行编码规则和统一格式                        |

“待 Stage 0 验证”的选型不得在验证完成前视为不可替换。验证结果通过 ADR 固化。

## 3. 系统上下文

```text
用户
 ├─ 在 VS Code Webview 中浏览、播放、标注和批准修改
 └─ 使用已有 Agent（Codex、Claude 或其他）
          │
          ▼
Agent Adapter / God View Gateway
          │  MCP / CLI / 原子事件文件
          ▼
VS Code Extension Host
 ├─ Protocol Gateway
 ├─ Graph State Engine
 ├─ Annotation & Task Engine
 ├─ Validation Engine ──→ Workspace / Git / Language Validator
 ├─ Event Store / Snapshot Store
 └─ Typed Webview Bridge
          │
          ▼
Webview
 ├─ Project Overview / Graph Explorer
 ├─ Guided Story Player
 ├─ Annotation Threads
 └─ Change / Diff Timeline
```

### 3.1 信任边界

- Agent 输出是不可信外部输入，进入状态引擎前必须通过 Schema、权限和路径校验；
- Agent 只能提交声明、证据引用和不确定项，不能写入代码验证或用户确认状态；
- Webview 运行在隔离环境，只能通过显式消息协议请求扩展能力；
- 仓库内容可能不可信，插件不得执行仓库中的脚本、HTML 或 SVG；
- Git 和文件系统只能证明代码事实，不能证明业务意图；
- Agent 声明不得覆盖已经验证的代码事实，只能与其并列或产生冲突状态。

## 4. 代码仓库与模块边界

建议目录：

```text
god_view/
 ├─ apps/
 │   ├─ vscode-extension/       # 激活、命令、VS Code 适配和组合根
 │   ├─ webview/                # React UI 与独立测试壳
 │   └─ agent-gateway/          # MCP Server 与 CLI 入口
 ├─ packages/
 │   ├─ protocol/               # JSON Schema、生成类型、兼容性规则
 │   ├─ graph-core/             # 纯图状态、事件归约、查询与快照
 │   ├─ annotation-core/        # 标注状态机、方案审批和上下文包
 │   ├─ validation-core/        # 校验接口与结果聚合
 │   ├─ validator-typescript/   # TypeScript/JavaScript 显式依赖校验
 │   ├─ storage/                # 事件日志、快照、迁移与恢复
 │   ├─ webview-bridge/         # Extension ↔ Webview 消息契约
 │   └─ testkit/                # Fixtures、事件构造器、回放断言
 ├─ docs/
 │   └─ adr/                    # 架构决策记录
 └─ fixtures/                   # 小/中/大型示例仓库与合成图数据
```

### 4.1 依赖方向

```text
apps/vscode-extension ──→ graph-core ──→ protocol
          │              annotation-core ──→ graph-core
          │              validation-core ──→ protocol
          │              storage ──→ graph-core / annotation-core
          └────────────→ webview-bridge ──→ protocol

apps/agent-gateway ──→ protocol
apps/webview ──→ webview-bridge
packages/validator-* ──→ validation-core
```

箭头表示“左侧允许依赖右侧”。未画出的反向依赖默认禁止。

规则：

- `protocol` 不依赖任何业务包；
- `graph-core` 不依赖 VS Code、DOM、Git 或具体存储；
- `annotation-core` 不直接调用 Codex、Claude 或文件系统，只处理领域状态；
- `validation-core` 只定义接口与组合逻辑，语言实现独立成包；
- `webview` 不得导入 `vscode` 模块或直接访问工作区文件；
- `vscode-extension` 是组合根，不承载可独立测试的领域算法；
- 跨包依赖必须通过公开入口，禁止深层导入其他包的内部文件；
- CI 使用依赖图检查阻止循环依赖和非法方向。

## 5. 核心运行流程

### 5.1 Agent 开发过程增量建图

```text
Agent get_map
→ begin_change(baseMapRevision, baseGitRevision)
→ upsert_node / upsert_edge
→ Agent 修改代码
→ complete_change(actualFiles)
→ Validation Engine 对照 Git/文件事实
→ validated / drift_detected
→ Webview 更新地图和时间线
```

要求：

- 每个写事件带 `eventId`，状态引擎按 ID 幂等；
- ChangeSet 带地图版本和 Git 基线，旧基线不能静默覆盖新状态；
- 单个事件只描述一个原子操作；
- `complete_change` 前的状态可见但标记为未完成；
- 校验失败不回滚事实记录，而是产生显式冲突。
- Agent 地图事件自动进入工作图但只获得 `agent_declared` 来源；`codeValidation` 与 `userConfirmation` 分开更新；
- 已确认模块的稳定 ID 不得由 Agent 改名触发删除重建。

### 5.2 老项目首次建图

```text
Inventory Builder 生成只读清单
→ Agent Adapter 选择/生成初始化任务
→ Agent 分层探索并提交 ProjectOverviewDraft
→ Schema Complexity Gate
→ 文件/路径/显式依赖校验
→ Agent 修正或用户编辑
→ 用户确认初始 Snapshot
```

首次建图的 Agent 草稿必须包含证据引用和未分析区域。CoverageReport 由插件使用 RepositoryInventory 与草稿引用计算，不能采用 Agent 自报覆盖率；未读取的区域不能被包装为已验证结论。

### 5.3 要求 Agent 解释

```text
用户标注目标
→ Context Builder 生成最小上下文并让用户预览
→ Agent Adapter 以 explain_only 权限启动（enforced 或 monitored）
├─ answer_annotation(answer, evidence, optional GuidedStory)
│  → UI 原位显示短结论并按需展开证据
└─ request_write_access(annotationId, reason, expectedScope)
   → 提交修改方案 → 用户明确批准 → 创建可写 ChangeSet
```

解释任务启动时不得创建可写 ChangeSet，也不持有写租约。`request_write_access` 只创建权限升级请求，不授予写权限；只有绑定有效批准令牌的 `start_approved_change` 才能创建可写 ChangeSet。

Adapter 支持原生权限限制时使用 `enforced` 模式；不能可靠限制时使用 `monitored` 模式，在启动前明确提示，并以任务前文件/Git 基线监控变化。批准前检测到写入时，托管任务进入 `unexpected_write`、立即暂停并展示 Diff；只有 Adapter 提供可靠任务关联证据时才归因给该 Agent，否则标记为未知/外部变化。God View 不自动回滚，也不得事后补写批准记录。

### 5.4 建议 Agent 修改

```text
用户标注目标
→ Agent propose_change
→ 方案校验与影响预览
→ 用户批准
→ start_approved_change
→ Agent 执行并上报结构事件
→ Git Diff 与地图校验
→ 用户接受或继续修改
```

批准令牌必须绑定 `proposalId`、地图 revision、Git revision、作用域和有效期。任一条件变化都使令牌失效。

MVP 在用户当前 VS Code 工作区执行修改：

- 不自动创建 branch 或 worktree；
- 不执行 `git add`、commit 或 push；
- ChangeSet 开始时记录 branch、HEAD、index、任务前工作区 Diff hash 和相关文件版本；
- 批准令牌包含允许写入的 workspace 相对路径/目录；Adapter 能强制时映射为运行时权限边界，不能强制时必须声明 `monitored` 并持续检测越界变化；
- 任务前已有改动与 Agent 新改动分开标记；涉及同一文件时再次确认；
- 单 workspace 采用单写者租约，同一时间只允许一个可写 ChangeSet；
- 尚未获写入授权的解释任务可并行，但 Codex 与 Claude Code 不得并发写同一 workspace；
- 分支切换、重叠写入或基线变化使批准失效并暂停任务；
- 写入批准作用域外路径产生 `scope_violation` 并暂停；已写文件保留供审查，不自动删除；
- 托管 Agent 在准备写入批准作用域外路径时，必须先提交 `scope_expansion_requested` 并结束本轮；
  只有 Extension Host 可以根据 Webview 用户命令产生 `scope_expansion_decided`。批准事件先扩大
  ActiveChange 的权威范围，再恢复同一个 Agent 会话；拒绝不改变范围；
- 已经观察到 `scope_violation` 后不得通过扩围事件事后补批；此边界属于 monitored 协议控制，
  不能描述为逐文件操作系统沙箱；
- 写入后取消/崩溃只停止后续步骤并保留 Diff，不自动回滚。

以上批准和路径权限只适用于由 God View 启动的 managed task。用户在外部 Codex/Claude 会话中授权的写入属于 external session：Validation Engine 可以观察 Diff、关联显式上报事件并标记漂移，但 Permission Engine 不得把它伪装为已批准，也不能承诺阻止外部进程。

Proposal 与 ChangeSet 使用独立状态机。Proposal 在执行前可变为 `approved/rejected/cancelled/stale`；ChangeSet 从 `approved` 进入 `in_progress/completed/accepted`，并可进入 `conflicted/scope_violation/interrupted/failed`。尚未创建 ChangeSet 的托管 Agent 任务可进入 `unexpected_write`，该状态不能伪装成 ChangeSet 已获批准。验证存在问题时用户只能显式选择 `accepted_with_issues`，对应实体不得获得已验证状态。任何从异常状态恢复到可写状态的命令都重新检查地图和 Git 基线。

## 6. 协议设计

### 6.1 真源与生成物

- `packages/protocol/schema/*.schema.json` 是协议真源；
- TypeScript 类型、MCP tool input schema 和测试样例由 Schema 生成或校验；
- 禁止手写一份与 Schema 平行演进的重复接口；
- 所有入站消息在业务处理前使用 Ajv 校验；
- 错误返回稳定的机器码、可读消息和可选字段路径。

### 6.2 版本策略

- 协议采用 `major.minor`；
- 新增可选字段属于 minor 兼容变更；
- 删除字段、改变语义或收紧合法值属于 major 变更；
- 读取方忽略未知可选字段，写入方只发送协商版本支持的字段；
- 至少支持当前 major 的最近两个 minor；
- 快照必须记录 Schema 版本，并提供向前迁移；
- 每次协议变更必须包含兼容性测试和迁移说明。

### 6.3 命令与事件分离

- Command 表达请求，例如 `ProposeChange`；
- Event 表达已经发生且不可变的事实，例如 `ChangeProposed`；
- Query 不改变状态，例如 `GetAnnotationContext`；
- UI 不得直接伪造领域 Event，必须通过 Command 由领域层验证后产生。

## 7. Agent Gateway 与传输

### 7.1 适配器能力模型

每个 Agent Adapter 声明：

- 是否可由插件主动调用；
- 是否支持 MCP；
- 解释任务的权限模式：`enforced` 或 `monitored`；
- 是否支持按批准路径运行时强制限制，以及文件/Git 变化检测的可用范围；
- 是否支持取消、进度和流式输出；
- 是否可能将代码发送到云端；
- 最大建议上下文与费用信息是否可得。

UI 只展示适配器真实声明的能力，不通过 Agent 名称猜测。

Adapter 无法声明数据去向时按“可能发送到云端”处理，调用前要求用户确认。

Codex Adapter 和 Claude Code Adapter 都是 MVP 正式能力，不是“一个正式、一个示例”。两者使用同一套 contract suite，至少覆盖：能力发现、首次建图、增量事件、无初始写授权的解释、写入申请、修改方案、批准令牌、`enforced/monitored` 权限模式、取消、中断和错误映射。

### 7.2 MVP 传输方案

主路径使用 MCP stdio。无法直接连接时使用工作区级事件收件箱：

1. Gateway 将单个消息写入临时文件；
2. 完成 `fsync` 后原子重命名为正式事件文件；
3. Extension 读取、校验并交给单写者状态引擎；
4. 成功处理后记录确认，失败消息进入隔离区；
5. 状态引擎将已接受事件顺序追加到规范 JSONL 日志。

禁止多个进程直接并发追加同一个 JSONL 文件。事件收件箱目录默认不进入 Git。

### 7.3 取消和超时

- 所有 Agent 长任务必须接受 `AbortSignal` 或等价取消信号；
- UI 关闭不自动取消已确认的修改任务，但必须保持状态可恢复；
- 解释请求和首次建图应允许用户取消；
- 超时产生明确状态，不把未知结果标为失败或成功；
- Agent 在取消后产生的迟到事件仍需根据 session 状态拒绝或隔离。

## 8. 图状态与存储

### 8.1 事件归约

`graph-core` 使用纯函数：

```ts
reduce(snapshot, event) => nextSnapshot | DomainError
```

相同快照和事件序列必须生成字节语义等价的结果。时间、随机 ID 和文件读取不得隐藏在 reducer 内部。

### 8.2 存储布局

- 规范事件日志：按 workspace 隔离、只追加；
- workspace identity 基于规范化 roots 与 repository identity；地图状态再按 Git branch key 隔离；
- 快照：包含 branch key、base Git revision、最后事件序号、协议版本和内容哈希；
- 用户布局按 workspace + branch 保存，与 Agent 语义事件分离；
- 标注与 Agent 回答：默认本地存储，与地图实体通过稳定 ID 关联，不进入 Git；
- 可共享架构基线：用户显式选择后才写入仓库；
- 临时 IPC、令牌和运行状态永不提交 Git；
- 数据清理必须保留用户要求保留的共享基线，并明确展示删除范围。

默认保留策略：架构基线保留到用户删除；原始 Agent 事件、回答和 Diff 关联保留 30 天，之后压缩为不含对话正文的结构快照；未解决或固定标注不自动清理，解决后 30 天清理正文。Diff 只持久化 revision、文件范围、统计和哈希，不复制完整源码内容；原 Git 对象消失后证据可显示为不可用。Telemetry 默认关闭。

### 8.3 快照与恢复

- 达到事件数量或日志体积阈值时异步创建快照；
- 先写临时快照，校验哈希后原子替换；
- 启动时从最近有效快照回放剩余事件；
- 损坏事件进入 quarantine，其他有效事件继续处理；
- 任何自动迁移前创建可恢复备份；
- Stage 0 用 100K 事件验证回放时间和内存上限。

### 8.4 分支与并发状态

- 默认分支的已确认快照可作为新分支初始基线；分叉后事件与布局独立；
- 分支切换由 Git Adapter 产生领域命令，先暂停当前可写 session，再加载目标 branch state；
- 单写者租约绑定 workspace、branch、session 和 Agent Adapter；
- 尚未获写入授权的解释任务不持有写租约；
- 外部文件写入与当前 ChangeSet 重叠时产生 `conflicted`，不得自动归因或覆盖；
- 无 Git 工作区使用 `no-git` branch key，但只开放建图、浏览和解释；
- 接受 ChangeSet 只更新领域状态，不改变 Git index 或提交历史。

## 9. VS Code 扩展设计

### 9.1 激活与生命周期

- 仅在用户打开 God View、执行命令或工作区存在 God View 配置时激活；
- 激活路径不做全仓扫描；
- 文件监听器、子进程和 Disposable 全部注册到统一生命周期容器；
- 扩展停用时停止接收新任务，刷写已接受事件并终止子进程；
- 所有长操作显示进度且可取消。

### 9.2 Extension Host 性能

- 同步工作单次不得超过 100 ms；
- 图布局、快照压缩、大批量校验放入 Worker 或子进程；
- 文件事件进行去重和防抖，只校验受影响邻域；
- 发送给 Webview 的是增量 patch 或聚合快照，不频繁复制完整大图；
- 大型 payload 记录大小而不是完整内容，避免日志和内存二次放大。

### 9.3 Webview 安全

- 严格 Content Security Policy 和 nonce；
- 禁止内联脚本、远程脚本和任意 HTML 注入；
- Agent 文本以纯文本或经过白名单处理的 Markdown 渲染；
- 外部链接通过扩展侧校验后打开；
- Webview 消息全部执行 Schema 校验与命令授权；
- Webview 永远不接收密钥、环境变量或完整 Agent 凭据。

## 10. Webview 与可视化

### 10.1 渲染分层

1. `graph-core` 提供与布局无关的图数据；
2. View Model 负责过滤、聚合和可见邻域；
3. Layout Worker 计算位置；
4. Cytoscape Adapter 映射节点、边和交互；
5. React 负责工具栏、详情、标注线程和讲解控制。

不得将业务真源存放在 Cytoscape 实例或 React 组件局部状态中。

### 10.2 图复杂度控制

- 极小项目允许少于 5 个一级模块；一般项目默认 5–9 个；复杂项目通过嵌套领域/子系统分组覆盖所有一级区域；
- 每个纳入范围的第一方源文件必须归入模块/分组或显式“未分类”节点；项目配置和资源可按用途聚合；不得用渲染阈值静默丢弃；
- `.git`、`node_modules`、虚拟环境、vendor、缓存、覆盖率、构建输出、生成产物和第三方依赖内部文件不进入项目图；
- 构建/部署产物可作为单一语义 artifact 节点存在，但其输出目录文件不进入 Inventory 实体集；
- lockfile 与依赖清单只提供边界证据；架构相关的外部系统可显示为单一边界节点；
- 同一画布使用 LOD：远景分组、中景模块、近景目录/文件；不以分页或断开的子图替代全项目覆盖；
- 视口裁剪只减少绘制，不影响搜索、覆盖率和实体可寻址性；
- 多条底层关系在远景聚合为带计数的模块边，放大后再拆分；
- 聚焦模式只渲染目标的一到两层邻域；
- 过滤和布局计算在 Worker 中进行；
- 选择、悬停和播放状态不得触发全图重新布局。

### 10.3 声明式动画

- Agent 只提交 `GuidedStory`，不提交动画代码；
- Story step 只能引用存在的实体 ID；
- 播放器负责镜头、高亮、方向动画和降级；
- `prefers-reduced-motion` 或 VS Code 减少动态设置优先于项目配置；
- 帧率不足时依次关闭粒子、减少阴影、缩小可见邻域；
- 每种动画都有无动画的步骤列表替代体验。

## 11. Validation Engine

### 11.1 校验等级

| 等级 | 来源       | 示例                           |
| ---- | ---------- | ------------------------------ |
| L0   | 文件事实   | 文件存在、路径、大小、Git 状态 |
| L1   | 显式语法   | import/export、清单依赖        |
| L2   | Agent 声明 | 模块职责、业务关系、预计影响   |
| L3   | 系统推断   | 可能影响、未验证调用           |

UI 必须展示来源和验证状态。L2/L3 不得显示为 L0/L1 事实。

### 11.2 Validator 接口

每个语言 Validator：

- 声明支持的文件类型和能力；
- 接收文件 URI、内容版本和取消信号；
- 返回证据位置及稳定错误码；
- 不修改文件；
- 单文件失败不影响其他 Validator；
- 不支持的语法返回 `unsupported`，不返回空的“验证成功”。

## 12. 安全与隐私

### 12.1 路径安全

- 所有 Agent 提供的路径先规范化为工作区 URI；
- 拒绝路径穿越、工作区外路径和符号链接逃逸，除非用户逐次授权；
- 遵循 `.gitignore`、God View exclude 和敏感文件规则；
- 不根据未经校验的路径执行命令；
- 临时文件使用权限受限目录和随机名称。

### 12.2 权限模型

| 操作                    | 默认权限                               |
| ----------------------- | -------------------------------------- |
| 浏览地图、查询快照      | 只读、无需额外确认                     |
| Agent 解释标注          | 无 God View 写入授权，发送前预览上下文 |
| Agent 请求写入入口      | 只创建升级请求，不授予写权限           |
| Agent 提出方案          | 无写入授权，不修改代码                 |
| 执行修改方案            | 用户明确批准后，在限定作用域内可写     |
| 读取工作区外文件        | 默认拒绝，逐次授权                     |
| 上传代码/调用云端 Agent | 展示 Agent 数据边界并由用户确认        |

无 Git 工作区不得获得执行修改权限。MVP 不提供自动执行白名单；每个修改方案均需二次确认。

### 12.3 MVP 运行环境

- 完整支持：macOS、Windows、Linux 的本地 VS Code + Git 工作区；
- 降级支持：本地无 Git 工作区，可建图、浏览、讲解和无写授权的解释；
- 多根工作区：每个 root 独立 identity、branch state、覆盖率和权限；
- Beta 兼容验证：Remote/SSH、WSL、Dev Container，不阻断首个 MVP 发布；
- 无 Codex/Claude Code：只读浏览已有数据，不尝试以其他进程冒充 Agent。

### 12.4 日志脱敏

- 不记录 Token、环境变量值、完整源码和完整命令行；
- 文件路径可按隐私设置截断为 workspace 相对路径；
- payload 默认记录类型、大小、哈希和处理结果；
- 调试模式增加日志前必须提示其数据范围；
- 导出诊断包前展示文件清单并允许用户删减。

## 13. 可观测性

- 使用结构化日志：时间、组件、操作 ID、session ID、耗时、结果码；
- 每个用户动作到 Agent 事件再到 UI 更新共享 correlation ID；
- VS Code Output Channel 展示对用户有帮助的错误，不倾倒内部堆栈；
- 本地诊断页展示事件队列、地图版本、快照、Validator 和 Agent 能力；
- Telemetry 默认关闭；用户主动开启后也不包含路径、源码、标注正文或 Agent 回答；
- Telemetry 设置、事件清单和发布政策必须可审查。

## 14. 构建与发布

### 14.1 工具链

- 使用 Corepack 固定 pnpm 版本；
- 根 `package.json` 只定义工作区脚本和开发工具；
- TypeScript、ESLint、测试框架在根目录统一版本；
- 扩展使用 esbuild 输出 Node bundle 和 source map；
- Webview 使用 Vite 生成带内容哈希的静态资源；
- VSIX 打包前检查产物清单、许可证、体积和 source map 发布策略。
- 公开版本发布到 VS Code Marketplace，同时保留与同一 commit 对应的可验证 VSIX；发布流程包含签名/发布凭据隔离、CHANGELOG、隐私说明和回滚版本。

### 14.2 CI 阶段

```text
install --frozen-lockfile
→ generated-files-check
→ format-check
→ lint
→ typecheck
→ unit + contract tests
→ dependency-boundary-check
→ build
→ VS Code integration + Webview E2E
→ security/license scan
→ package VSIX
→ smoke install
```

主分支保护和发布门禁见 [代码质量评估规范](./CODE_QUALITY_STANDARD.md)。

## 15. Stage 0 必须完成的技术验证

### 15.1 图渲染选型

使用相同数据对 Cytoscape.js 进行测试，并准备 Sigma.js 作为对照：

- 1K、5K、10K 节点；
- 平均 2、4、8 条边/节点；
- 首次渲染、缩放、聚焦、筛选、布局和动画帧率；
- 内存峰值和从讲解切换到自由探索的响应时间；
- 键盘导航和高对比度模式可实现性。

数据集必须同时包含嵌套模块、未分类第一方文件和大量可排除依赖目录，验证“全覆盖但不展开依赖”而不仅是随机图帧率。

若 Cytoscape.js 无法满足质量预算，再通过渲染适配器替换，不改领域模型。

### 15.2 存储验证

- 100K 事件冷启动回放；
- 快照后增量回放；
- 进程中断、半写文件和损坏事件恢复；
- 两个 Agent Gateway 同时投递的顺序与幂等；
- 日志压缩期间继续接收事件；
- 工作区移动或重命名后的身份恢复。

### 15.3 Agent 接入验证

- Codex 和 Claude Code 均完成能力发现、建图、解释、提出方案和批准后修改闭环；
- 两个 Adapter 通过同一 contract suite，错误码和状态语义一致；
- 至少一个只能通过生成任务/事件文件接入的降级路径；
- `enforced` 与 `monitored` 两种解释权限模式、写入申请和意外文件修改检测；
- 写入申请本身不授予权限，批准前写入进入 `unexpected_write` 且保留可见 Diff；
- 取消、超时、迟到事件和 Agent 崩溃；
- 用户不提供 API Key 给 God View 也能完成接入。

### 15.4 Git 与并发验证

- 有任务前未提交改动时正确区分 Agent 新 Diff；
- 修改方案与已有改动重叠时再次确认；
- Codex 与 Claude Code 竞争写租约时只有一个成功；
- 活跃 ChangeSet 中切换分支会暂停任务并使批准失效；
- 写入后取消/崩溃保留 Diff 和 `interrupted` 状态；
- 无 Git 环境无法获得写权限；
- God View 不执行 add、commit、push 或自动回滚。

Stage 0 同时确定最低 VS Code API 版本和对应 Extension Host 运行时，写入 `engines.vscode`、构建 target、支持矩阵与 CI；不得只在开发者当前最新版本上测试后宣称兼容。

## 16. 暂不引入的技术

- 远程数据库或团队后端：MVP 默认本地个人使用；
- 微服务：当前规模下只增加部署和调试成本；
- 3D 引擎：尚未验证产品价值；
- 通用全语言 AST 平台：与 Agent 驱动路线冲突；
- 自研图渲染引擎：先验证成熟图库；
- Redux 等重型全局状态框架：当前 UI 状态不需要；
- 在 Webview 中运行任意 Agent 代码：安全边界不可接受。

## 17. ADR 管理

以下变化必须新增 Architecture Decision Record：

- 替换图渲染、存储或协议真源；
- 改变包依赖方向；
- 引入云端服务或账号系统；
- 修改 Agent 写权限模型；
- 改变事件一致性或快照策略；
- 引入新的运行时、语言或原生依赖。

ADR 至少包含：背景、决策、候选方案、取舍、影响、迁移方案和回滚方式。已接受 ADR 不直接覆写历史；新决策通过新的 ADR 取代旧决策。
