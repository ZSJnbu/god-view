# God View 编码与可维护性规范

> 状态：MVP 强制规范
> 关联文档：[技术架构](./TECHNICAL_ARCHITECTURE.md) · [代码质量评估规范](./CODE_QUALITY_STANDARD.md)
> 更新时间：2026-08-07

## 1. 目标与适用范围

本规范用于让 God View 在持续增加 Agent、语言校验器和可视化能力时仍然容易理解、测试和修改。它适用于人工与 Agent 产生的所有仓库代码。

规范优先级：

1. 正确性、安全和隐私；
2. 清晰的模块边界；
3. 可测试和可观测；
4. 可读性；
5. 性能；
6. 代码简短。

不得为了减少行数牺牲错误处理、类型安全或领域语义。

## 2. 自动执行的基础规则

- TypeScript 开启 `strict`，并启用 `noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitOverride` 和 `useUnknownInCatchVariables`；
- 禁止提交未通过 Prettier 的文件；
- ESLint 使用需要类型信息的 typescript-eslint 规则集；
- 禁止未解释的 `eslint-disable`、`@ts-ignore` 和覆盖率忽略；
- 禁止生产代码中的 `console.log`，统一使用结构化 Logger；
- 禁止导入其他 package 的 `src/` 或内部路径；
- 禁止循环依赖；
- 生成文件必须标注来源，且不得人工修改；
- lockfile 必须提交，CI 使用 frozen lockfile；
- 编辑器设置、Node/pnpm 版本和工具配置进入仓库，不依赖个人全局环境。

允许例外时使用最小作用域，并附原因、负责人和清理条件。

## 3. 模块设计

### 3.1 单一职责

一个模块应回答一个清晰问题。例如：

- `graph-core` 回答“事件如何改变图状态”；
- `validation-core` 回答“声明与代码证据是否一致”；
- `webview` 回答“状态如何呈现和交互”；
- `agent-gateway` 回答“Agent 如何调用 God View 协议”。

同时读取 VS Code、修改图状态、写存储并更新 UI 的类属于职责泄漏，必须拆分。

### 3.2 依赖倒置

- 领域层定义端口接口，基础设施层实现；
- 领域对象不导入 `vscode`、Node `fs`、React、Cytoscape 或具体 Agent SDK；
- 时间、ID、文件、Git、网络和日志通过显式依赖注入；
- 禁止隐藏的全局单例；仅组合根可以管理进程级实例；
- 测试替身实现端口接口，不通过 monkey patch 修改模块内部。

### 3.3 公开 API

- 每个 package 只有一个或少量明确的公开入口；
- 默认不导出实现类、内部工具和可变状态；
- 对外返回只读结构或副本；
- 删除或改变公共 API 前先检查所有工作区消费者；
- 跨包 API 变化必须包含迁移修改，不允许长期保留无负责人兼容层。

## 4. TypeScript 类型规范

### 4.1 禁止逃逸类型系统

- 禁止 `any`；外部不可信输入使用 `unknown` 并在边界解析；
- 禁止无验证的类型断言 `as SomeType`；
- 禁止非空断言 `!`，除非附近有无法被类型系统表达的不变量说明；
- 使用判别联合表达有限状态；
- 使用 exhaustive check 处理所有状态分支；
- ID 使用 branded type 或明确包装，避免 `NodeId`、`EdgeId`、`SessionId` 混用；
- 时间在协议中使用 RFC 3339 字符串，在领域内部使用明确类型，不混用毫秒和秒数值。

推荐：

```ts
type AnnotationState =
  | { kind: 'draft' }
  | { kind: 'sent'; requestId: RequestId }
  | { kind: 'answered'; answerId: AnswerId }
  | { kind: 'plan_proposed'; proposalId: ProposalId }
  | { kind: 'in_progress'; changeSetId: ChangeSetId }
  | { kind: 'resolved'; resolvedAt: Timestamp };
```

不推荐用多个可能互相矛盾的布尔值：

```ts
// 禁止：可能同时出现 isResolved=true 与 isInProgress=true
interface AnnotationFlags {
  isSent: boolean;
  isInProgress: boolean;
  isResolved: boolean;
}
```

### 4.2 可选值

- “缺失”“未知”“空集合”和“未加载”具有不同语义时必须使用不同状态；
- 不使用空字符串代替缺失值；
- 不使用 `undefined` 表示错误；
- 数组字段在协议中明确是必需空数组还是可选字段；
- Map/Set 仅用于进程内模型，协议和持久化层使用稳定可序列化结构。

## 5. 命名规范

| 对象         | 规则                                       | 示例                                       |
| ------------ | ------------------------------------------ | ------------------------------------------ |
| 文件         | kebab-case，React 组件可 PascalCase        | `reduce-graph-event.ts`、`GraphCanvas.tsx` |
| 类型/类/组件 | PascalCase                                 | `GraphSnapshot`、`AnnotationPanel`         |
| 函数/变量    | camelCase，动词开头                        | `validateEvent`、`loadSnapshot`            |
| 布尔值       | `is`/`has`/`can`/`should`                  | `isValidated`、`canExecute`                |
| 常量         | camelCase；真正全局常量可 UPPER_SNAKE_CASE | `defaultNodeLimit`                         |
| 事件         | 已发生的过去式                             | `ChangeProposed`、`NodeRemoved`            |
| 命令         | 祈使/动作名                                | `ProposeChange`、`ResolveAnnotation`       |
| 查询         | `Get`/`List`/`Find`                        | `GetMapSnapshot`                           |
| 错误码       | 稳定 UPPER_SNAKE_CASE                      | `STALE_MAP_REVISION`                       |

避免 `data`、`info`、`manager`、`helper`、`utils` 等无法表达职责的名称。确需通用工具时按领域命名，例如 `path-normalization.ts`。

## 6. 函数、类与文件

### 6.1 函数

- 一个函数只做一个可命名的动作；
- 参数超过 3 个时优先使用带名称的参数对象；
- 不使用布尔参数改变函数行为，拆为不同函数或使用明确枚举；
- 领域转换优先使用无副作用纯函数；
- 副作用在名称和返回类型中可识别；
- 复杂条件提取为有领域名称的谓词；
- 尽早返回，减少深层嵌套；
- 圈复杂度目标不超过 10，超过 15 属于质量门禁失败；
- 函数超过约 60 行或嵌套超过 3 层时必须在评审中说明为何不拆分。

长度是诊断信号，不是为了达标而机械拆出无语义函数。

### 6.2 类

- 默认使用函数和数据结构；只有需要封装生命周期、不变量或端口实现时使用类；
- 构造函数不执行 I/O 或启动后台任务；
- 可变字段保持私有，通过行为方法维护不变量；
- 避免继承体系，优先组合和明确接口；
- 一个类不同时实现多个不相关端口；
- 所有拥有资源的类提供明确 `dispose()` 或等价生命周期。

### 6.3 文件

- 一个文件围绕一个主要概念组织；
- 文件超过约 400 行时检查是否混合职责；超过 600 行需在评审中给出保留理由；
- `index.ts` 仅用于公开导出，不包含业务逻辑；
- 不创建不断增长的 `constants.ts`、`types.ts` 或 `utils.ts`；类型和常量靠近所属领域；
- 测试与被测代码采用可预测的相邻命名或镜像目录。

## 7. 错误处理

### 7.1 错误分类

- **ValidationError：** 外部输入不符合 Schema；
- **DomainError：** 合法输入违反状态不变量；
- **InfrastructureError：** 文件、Git、进程或存储失败；
- **Cancelled：** 用户或系统主动取消；
- **Unsupported：** 当前适配器明确不支持；
- **Bug：** 不应发生的内部状态。

不要用同一个通用 Error 隐藏所有类别。

### 7.2 规则

- `catch` 中的值按 `unknown` 处理；
- 只在能够恢复、转换或增加上下文的层捕获错误；
- 不吞掉异常，不把失败转换为空数组或 `undefined`；
- 用户消息说明发生了什么、影响和下一步；内部日志保留 cause 与 correlation ID；
- 错误消息不得包含密钥、完整源码或未脱敏命令；
- 取消不是错误，不记录为 error 级别；
- 批处理允许部分成功时，返回逐项结果和汇总，不因一个文件失败丢弃全部结果；
- 稳定错误码属于协议兼容面，修改时遵循版本规则。

## 8. 异步、并发与生命周期

- 所有可能超过 100 ms 的操作设计为异步；
- 长操作接受取消信号，并定期检查取消状态；
- Promise 必须 `await`、返回或显式交给受控后台任务管理器；禁止悬空 Promise；
- 并发必须有上限，禁止对全仓文件直接 `Promise.all`；
- 文件监听事件先规范化、去重、防抖，再进入领域层；
- 单 workspace 图状态使用单写者模型；
- 单 workspace 同时只允许一个可写 ChangeSet；尚未获写入授权的解释任务不得持有写租约；
- 写租约必须绑定 workspace、Git branch、session 和 Agent，分支变化立即失效；
- 不依赖事件到达顺序，使用序号、revision 和幂等 ID 校验；
- Disposable、Worker、子进程、监听器和定时器都由生命周期容器管理；
- 测试必须覆盖取消、迟到响应、重复事件和关闭时仍在运行的任务。

## 9. 不可变事件与状态机

- 已接受 Event 永不原地修改；修正通过新 Event 表达；
- Event 名称使用过去式，payload 只包含复现事实所需信息；
- Reducer 是确定性纯函数；
- 状态转换在领域层集中定义，UI 不自行拼接状态；
- 非法转换返回稳定 DomainError；
- ChangeSet、Annotation 和 GuidedStory 使用显式状态机；
- 稳定实体 ID 不得由可变 label 单独计算；Agent 改名不应改变模块身份；
- 每个状态机有状态转移表和覆盖所有合法/非法路径的测试；
- 时间和 ID 在命令处理层生成后传入 reducer。

## 10. 协议与序列化

- JSON Schema 是外部协议真源；
- 任何来自 Agent、Webview、文件或旧快照的数据都是 `unknown`；
- 验证成功后才进入领域类型；
- 序列化字段顺序不作为语义，测试比较结构而非原始 JSON 文本；
- 哈希需要规范化序列化时使用唯一实现并固定测试向量；
- 不在协议中发送 class instance、Map、Set、BigInt 或函数；
- 新字段优先可选并提供明确默认语义；
- Schema、生成类型、样例和契约测试在同一 PR 中更新。

## 11. VS Code 扩展代码

- `activate()` 只完成注册和轻量初始化；
- VS Code API 调用集中在 adapter 层；
- 使用 `vscode.Uri` 处理路径，不自行拼接平台分隔符；
- 所有命令 ID、view ID 和配置 key 集中定义并通过 manifest 测试校验；
- 用户可见长任务使用 `withProgress` 并支持取消；
- 工作区未受信任时禁用 Agent 写入和外部命令能力；
- 多根工作区必须携带 workspace identity，禁止默认取第一个 root；
- 地图、布局、批准令牌和 ChangeSet 必须携带 Git branch key；
- Git 分支切换时先暂停可写任务，再切换领域状态；
- God View 的“接受结果”不得隐式执行 add、commit 或 push；
- Remote/SSH/Container 环境不得假定本地路径等于扩展运行路径；
- 文件写入采用临时文件 + 原子替换，不直接覆盖关键快照；
- 每个注册的 Disposable 都进入 `context.subscriptions` 或子容器。

## 12. Webview 与 React

- 领域状态来自 typed bridge，不在 UI 复制第二套业务规则；
- 服务端状态、派生 view model 和瞬时 UI 状态分开存储；
- 组件默认保持小而无副作用，数据获取和命令发送放在 hooks/service；
- selector 必须避免大图上无关状态导致全树重渲染；
- 节点 hover 不写入规范图状态；
- 所有用户输入在提交前校验，渲染 Agent 内容时默认按纯文本；
- 不使用 `dangerouslySetInnerHTML`；确需 Markdown 时使用固定白名单 sanitizer；
- 交互元素使用语义化元素和可访问名称；
- 不只依赖颜色表达状态；
- 动画读取统一的 reduced-motion 设置，不在组件内各自判断；
- Story 播放器是确定性状态机，测试可使用虚拟时间推进。

## 13. 图与动画代码

- 图真源不存放在渲染库实例中；
- 所有渲染库调用位于 adapter，避免业务层依赖 Cytoscape.js；
- 布局输入输出是可序列化数据，可在 Worker 中运行；
- 节点/边样式由设计 token 和状态映射决定，禁止散落魔法颜色；
- GuidedStory 只能引用实体 ID，不包含任意 CSS、HTML 或脚本；
- 播放过程中不得修改架构快照；
- 临时高亮与规范状态分层；
- 动画性能降级路径必须可测试：粒子 → 简单边高亮 → 静态步骤；
- 退出播放后恢复用户原来的选择、缩放和过滤状态。

## 14. Agent Adapter 与工具

- Adapter 只负责能力发现、调用和协议转换，不包含领域决策；
- 不根据 Agent 名称推断能力，使用显式 capability；
- 工具描述简短、无歧义，并写明是否需要写入授权；
- Adapter 必须声明权限模式：支持原生限制时为 `enforced`，否则为 `monitored`；不得把监控能力描述成运行时强制；
- 所有写工具要求 workspace、session、revision 和幂等 key；
- 可写工具还必须携带批准令牌和规范化路径作用域；`enforced` 模式执行硬限制，`monitored` 模式在执行前警示并持续检测文件/Git 变化；
- 越界写入统一转换为 `SCOPE_VIOLATION`，不得作为普通文件变化继续；
- `request_write_access` 只能创建权限升级请求，不能生成批准令牌、写租约或可写 ChangeSet；
- 未获批准的解释工具不能直接或间接调用写工具；若检测到写入，统一转换为 `UNEXPECTED_WRITE`、暂停任务并保留 Diff；
- 修改方案和执行修改使用不同工具与权限；
- Adapter 不读取、打印或保存用户 Agent 密钥；
- Agent 输出超出 Schema 时返回可修正错误，不尝试宽松猜测；
- 流式输出必须处理断线、取消和重复尾包；
- 第三方 Agent 差异通过 adapter 隔离，不在领域层出现品牌判断。
- Codex 与 Claude Code Adapter 必须实现同一公共 contract suite；新增某一 Adapter 特例时先证明无法通过 capability 表达；

## 15. 文件、路径与命令安全

- Agent 路径必须转换为 workspace 相对 URI 并重新解析；
- 第一方内容分类、排除原因和“未分类”必须显式可测试；不得用文件数量上限丢弃源文件；
- `.git`、依赖目录、虚拟环境、vendor、缓存、构建/覆盖率输出和生成产物使用集中规则排除，禁止各组件维护不同名单；
- 拒绝 `..` 穿越、绝对路径逃逸和符号链接逃逸；
- 不使用 shell 拼接执行用户或 Agent 字符串；
- 必须执行命令时使用参数数组和受控 executable；
- 不将文件内容、Token 或环境变量插入日志；
- 临时目录使用系统安全 API，任务结束后按策略清理；
- 删除、覆盖、迁移等操作先解析精确目标并提供恢复策略；
- 仓库内容永远不作为可执行 UI 资源加载。

## 16. 日志与可观测性

- 通过注入的 Logger 记录结构化字段；
- 日志级别：debug 用于本地诊断，info 记录生命周期，warn 记录降级，error 记录未恢复失败；
- 每个跨组件流程携带 correlation ID；
- 日志写事件类型、数量、耗时、结果码，不写完整 payload；
- 用户可见错误与内部日志分离；
- 性能测量使用统一 timer，禁止到处手写 `Date.now()`；
- 测试断言关键错误是否记录一次，避免重复多层日志。

## 17. 测试代码规范

- 测试名称描述行为和结果，不复述函数名；
- 使用 Arrange / Act / Assert 结构，但不要求写注释标签；
- 一个测试聚焦一个行为；参数化测试用于相同规则的多输入；
- 优先使用内存 adapter 和固定 fixture，不模拟私有实现；
- 时间、随机数、ID、文件系统和 Agent 响应必须可控制；
- 不使用真实网络、用户目录、真实 Agent 账号或不稳定睡眠；
- 异步测试等待可观察条件，不以固定长延时碰运气；
- Snapshot test 只用于稳定、可审阅结构，禁止用巨大快照替代行为断言；
- Bug 修复必须先有能复现问题的测试；
- 测试数据不得包含真实密钥、个人路径或私有代码。

## 18. 注释与文档

### 18.1 代码注释

注释解释“为什么、约束和风险”，不重复代码做了什么。以下情况必须注释：

- 不明显的协议兼容行为；
- 性能优化为何安全；
- 安全校验不能删除的原因；
- 第三方 API 的已知限制；
- 临时 workaround 的跟踪编号和移除条件。

公开 API 使用 TSDoc 描述语义、错误、取消和副作用。简单内部函数不要求机械添加注释。

### 18.2 工程文档

- 新包提供 README：职责、公开 API、依赖方向、运行与测试方式；
- 重大决策写 ADR，不只留在聊天或 PR 评论中；
- 用户可见配置同步更新 manifest、文档和默认值测试；
- 协议变更提供迁移说明和兼容样例；
- 性能优化记录基线、数据集和前后结果。

## 19. 依赖管理

- 新依赖必须说明用途、替代方案、许可证、维护状态、体积和安全影响；
- 能用平台标准 API 清晰实现时不引入小型依赖；
- 生产依赖与开发依赖严格区分；
- Webview 依赖关注 bundle 体积，Extension 依赖关注启动与原生兼容；
- 不引入功能重复的多个状态、Schema、日期或工具库；
- 原生模块需要 ADR，说明 macOS/Windows/Linux 与 Remote 环境打包策略；
- 依赖升级分批进行，不将大版本升级与业务功能混在同一 PR；
- 高危漏洞无法立即修复时必须有风险评估、缓解和截止日期。

## 20. Pull Request 规范

每个 PR 应：

- 聚焦一个可描述的变更；
- 说明问题、方案、非目标、风险和验证方式；
- 标明是否修改协议、存储、安全边界或性能关键路径；
- 包含相关测试和文档；
- 展示 UI 变化的截图或短录屏；
- 不混入无关格式化、重命名或依赖升级；
- 不降低质量阈值或添加永久豁免；
- 对 Agent 生成的代码由提交者承担同等审查责任。

推荐控制在约 400 行有效变更内。超过 800 行时应拆分；无法拆分时在 PR 中提供阅读顺序和原因。生成文件不计入，但必须单独标识。

## 21. Definition of Done

一项开发任务只有满足以下条件才算完成：

- 验收行为已实现且没有未说明的范围变化；
- 类型检查、Lint、格式、测试和构建通过；
- 新增状态、错误和取消路径有测试；
- Agent/外部输入经过运行时验证；
- 用户数据、路径和日志经过隐私检查；
- 性能关键路径没有超出预算；
- 可访问性和减少动态效果可用；
- 文档、Schema、生成类型和样例保持同步；
- 没有新增无负责人 TODO；
- 评审者能够从命名和包边界理解实现，而不依赖作者口头解释。

## 22. 规范例外

确需违反规范时，在代码或 PR 中记录：

1. 被违反的规则；
2. 无法遵守的技术原因；
3. 风险和缓解措施；
4. 负责人；
5. 复查或移除日期。

“赶时间”“Agent 自动生成”或“以后再整理”不是有效理由。
