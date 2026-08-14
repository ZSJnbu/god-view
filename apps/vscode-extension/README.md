# God View

让 Agent 在写代码的同时维护项目地图，让开发者实时看见项目如何被构建。

> **当前阶段：0.3.31 本地发布候选版。**
> 持续建图、GuidedStory、原位解释、修改方案、用户批准、monitored ChangeSet、
> Git Diff 摘要与用户验收已形成闭环，并由单元、Chromium 和 Extension Host 自动化覆盖。
> 扩展未发布到 Marketplace。当前 VSIX 已内置 `god-view` Gateway/CLI，安装后可通过
> `God View: Configure Agent MCP` 显式配置并复验当前工作区的 Codex 或 Claude Code；
> 空地图面板可直接启动新的受控 Agent 会话完成首次建图；地图完成后可在工具栏选择
> **重新初始化**，根据当前仓库状态完整重绘；`God View: Copy Agent Setup`
> 和可复制任务保留为手动接入兜底。
>
> **分支热切换已通过真实端到端验证**：同一个 Extension Host、同一个未重启的 MCP 进程
> 完成 main → feature/x → main 往返，两个分支的事件日志完全隔离。
>
> **文件变更增量漂移已通过真实端到端验证**：不重开地图的情况下，删除文件、恢复文件、
> 重命名整个目录都会当场反映到覆盖率与漂移上；跨分支往返后事实基线正确重置。
> 修复涉及三层根因：
>
> 1. 增量选择只看 `node.paths` 而忽略 `node.locations`，且不处理目录级删除/重命名；
> 2. `git ls-files --cached` 把已删除但未 `git add` 的文件继续算进覆盖率分母；
> 3. 事实更新沿用图版本排序，而文件变化不改变图版本，消息在 Webview 侧被判为过期丢弃
>    （现由独立的 `map/facts` 消息与 `factsRevision` 解决）。
>
> 地图面板会保存所属的 `workspaceId`；窗口重载后由 `WebviewPanelSerializer` 重新绑定
> 原工作区并恢复内容。状态中不保存地图或源码。

## 它做什么

- Agent 通过 MCP 工具声明模块、关系与证据，God View 把它们归约成一张项目地图；
- 地图区分**代码可证实**、**Agent 声明**和**用户确认**三条独立的轴，不把声明呈现为事实；
- 覆盖率以插件自己生成的第一方文件清单为分母，未分类的文件显式可见，不被静默丢弃；
- 地图按工作区与 Git 分支隔离，切分支会重新绑定到该分支的日志。
- 手工拖乱地图后可显式选择“拓扑排序”：按依赖层级动画整理并保存坐标，尽量减少交叉；
  关系线绕开模块并使用独立平行线槽，不会彼此覆盖；悬停/选中时显示类型与原因，
  不可避免的交叉以电路跳线呈现。
- 切分支前自动把旧分支的活动 ChangeSet 标记为 interrupted；用户也可点“停止并保留 Diff”。
- 对 Agent 显式标为 `explicit_import` 的 TypeScript/JavaScript 关系核对真实相对 import；
  alias、运行时调用和其他语言明确保持未验证。
- Agent 可提交三类声明式讲解，用户可播放、暂停、逐步导航、变速、重播和退出；
  减少动态效果设置会关闭镜头补间。
- 用户可在节点上创建解释/风险/修改标注；创建后插件内部自动启动独立 Agent 子线程并实时
  显示输出，只有 `answer_annotation` 真正回写权威地图后才显示完成与原位结构化答案；
  “复制手动任务”仅保留为内部 Agent 无法启动时的兜底；
- “要求修改”会先让只读 Agent 回答并提交文件/结构/风险/验证方案；用户缩小并批准范围后，
  插件内部直接启动可写 Agent 子线程。编辑、验证、节点与关系更新、ChangeSet 完成和 Git
  Diff 待验收必须全部成功，任务才会显示完成；接受 Diff 后原标注自动标为已解决；
- Agent 可申请写入并提交方案；用户缩小范围后批准，Gateway 以时效令牌启动 ChangeSet；
- 托管编辑 Agent 准备修改 `approvedScope` 外的文件时，必须先通过
  `request_scope_expansion` 提交文件列表和原因并停止本轮；用户批准后，扩展宿主先写入
  权威审批事件、扩大本次 ChangeSet 范围，再恢复同一个 Codex/Claude 会话。拒绝不会扩围；
- 空地图中可自动启动新的 Codex/Claude CLI 会话，流式显示进度、停止进程，并在 Agent
  提出 2–3 个结构化选项时让用户选择后恢复同一会话；
- 已有地图可由用户确认后重新初始化：旧地图在新 ChangeSet 完成前保持可用，职责仍一致的
  节点/关系保留稳定 ID，变化区域更新，过时关系与节点被清理；活动 ChangeSet 期间禁止重绘；
- 地图与底部 Agent 进度/输出之间可拖动调整高度，也可用方向键微调或双击恢复默认值；
  高度按工作区保存，调整时只 resize 画布，不重新布局或移动模块；
- 普通点击模块只高亮并打开详情，不移动镜头或隐藏其他模块；层级以“项目概览 / 模块全图 /
  文件明细”表达，局部视图会醒目标明隐藏数量，并始终提供“显示完整模块图”返回入口；
- 结构变化使用可中断的连续动画：保留模块平滑移动、新模块从相关位置展开、旧模块淡出；
  拖动单个模块只保存该节点坐标，不重新布局、移动或隐藏其他模块；
- Gateway 写事件后等待扩展归约确认；只有 reducer 真正接受才返回 `accepted: true`，
  未知 ChangeSet、悬空关系和确认超时会显式返回错误；
- 扩展监控 Git Diff、标记越界文件，并由用户接受或带问题接受；任务开始前已有的未提交文件
  单独标为 `preexisting_overlap`，不会仅因不在范围内就把本次 ChangeSet 判成越界；接受不会
  执行 Git add/commit/push。
- ChangeSet 历史可按完成时间查看状态、文件范围与保存的 Diff 元数据，并重新打开仍可用的 Git Diff。
- 自动首次建图可停止由扩展启动的 CLI 子进程；中断可写 ChangeSet 仍只结束 God View
  状态并保留现有文件修改，不会终止用户在别处打开的 Agent 会话。
- 打开或切换分支时执行 30 天本地保留压缩：当前地图、未解决/固定标注保留；过期原始事件和
  已解决且未固定的对话正文被清理。用户也可用清理命令删除当前工作区的全部 God View 本地数据。

## 它不做什么

- 不直接修改你的代码；批准令牌授予外部 Agent 工作流，God View 负责协议、监控和审查；
- 不读取 Agent 密钥或登录态。自动首次建图只新建 CLI 子进程，不能接管或热加载已经打开的
  Agent UI 会话；
- 自动建图为 Codex 设置只读 sandbox，为 Claude 仅开放读取和 God View MCP 工具并禁用
  Bash/Edit/Write；用户自行启动的 Agent 仍是 monitored 模式，God View 不能阻止其写入；
- 托管编辑的扩围审批是协议与宿主状态机边界，不是逐文件操作系统沙箱；若 Agent 进程绕过
  工具先写文件，God View 会拒绝事后补批、标记 `scope_violation` 并保留 Diff；
- 不自动创建分支/worktree，也不执行 Git add、commit、push、回滚或删除越界文件；
- 不向云端发送任何数据，也没有任何遥测代码。
- 不在不受信任或虚拟工作区激活；God View 会启动本地 Git、Agent CLI 与 Gateway 子进程，
  需要用户先用 VS Code 的 Workspace Trust 明确信任本地文件工作区。

## 命令

| 命令                                     | 说明                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| `God View: Open Project Map`             | 打开项目地图                                                                      |
| `Reveal in God View`                     | 从当前编辑器定位到对应节点                                                        |
| `God View: Generate Agent Task`          | 生成一段可粘贴给 Agent 的任务描述                                                 |
| `God View: Configure Agent MCP`          | 确认后配置所选 Agent，并用官方 `mcp get` 立即复验                                 |
| `God View: Copy Agent Setup`             | 复制内置 Gateway 的手动 MCP 接入配置                                              |
| `God View: Show Agent Adapters`          | 只读检测 Codex/Claude 及显示能力                                                  |
| `God View: Show Diagnostics`             | 打开输出面板并记录当前地图状态                                                    |
| `God View: Clear Current Workspace Data` | 确认后清除当前工作区的地图、事件、标注、Diff 元数据、布局与接入确认；不碰源码/Git |
| `God View: Export Current Map Snapshot`  | 用户选择位置后导出可审查的协议 JSON；不含源码正文，也不自动提交 Git               |

## 运行方式

安装 VSIX 后，先执行 `God View: Open Project Map`，再执行
`God View: Configure Agent MCP` 并选择 Codex 或 Claude Code。扩展会先展示数据边界与
具体工作区，只有用户确认后才调用该 Agent 的官方 CLI 写入配置，并立即执行 `mcp get god-view`
复验；不会读取 Agent 密钥。若已有同名配置，必须再次确认才能替换。取消不会写入任何配置。

配置成功后，**退出已经打开的 Agent 会话，并在当前工作区目录重新启动**。MCP 工具清单在
会话启动时加载，旧会话不会热加载 `get_map` 等工具。空地图面板会显示绿色勾选和已复验的
CLI/工作区信息；点击 **启动首次建图** 后，扩展会新建一个受控会话并展示输出。若 Agent
需要决策，直接在面板选择；只有最终 `get_map` 的 revision、节点数和覆盖数字通过结构化
复核后才显示完成。自动配置或执行失败时，可使用 `God View: Copy Agent Setup` 和
`God View: Generate Agent Task` 手动继续。

地图完成后，工具栏中的 **重新初始化** 会再次确认影响，再启动独立的全图重绘任务。它不会
先清空当前地图，也不会修改源码；只有新的 ChangeSet 完成并通过最终 `get_map` 复核后，界面
才切换到重绘结果。若已有活动 ChangeSet 或 Agent 任务，按钮会禁用并提示先处理现有任务。

### 源码开发

以下命令假设仓库位于 `<REPO>`。

### 1. 构建

```bash
cd <REPO>
pnpm install
pnpm run build
```

### 2. 启动扩展

用 VS Code 打开 `<REPO>`，按 **F5**。会开出一个 Extension Development Host 窗口，
默认加载 `fixtures/sample-project` 作为工作区（见 `.vscode/launch.json`）。
想换成自己的项目，把 `launch.json` 里的路径改掉，或者用「不指定工作区」那条配置再手动打开目录。

在新窗口里执行 **God View: Open Project Map**。扩展会写出 `.godview/session.json`，
Agent 靠它确定事件归属哪张地图——**这一步必须先做**。

### 3. 接上 Agent

推荐在 Extension Development Host 中执行 **God View: Configure Agent MCP**，确认后即可从
空地图面板启动新的首次建图会话。已经打开的其他 Agent 会话仍需退出并重开才能加载 MCP。
下面的命令只用于调试手动接入：

源码开发时也可以直接使用构建进 VSIX 的 Gateway。支持 MCP 的 Agent：

```bash
claude mcp add --scope local god-view -- \
  node <REPO>/apps/vscode-extension/dist/gateway/god-view.mjs serve \
  --workspace <你的项目目录> --adapter claude-code
```

不支持 MCP 的工作流，把事件文件投递到收件箱：

```bash
node <REPO>/apps/vscode-extension/dist/gateway/god-view.mjs \
  emit events.jsonl --workspace <你的项目目录>
```

两条路径都依赖第 2 步写出的 `.godview/session.json`。

### 想先看到一张非空的图

`fixtures/sample-project/README.md` 里有完整的六步手测流程和验收要点。

## 测试

单元测试跟随仓库根的 `pnpm run check`。Extension Host 集成测试单独跑：

```bash
pnpm --filter "./apps/vscode-extension" run test:integration
```

它会下载一份 VS Code 并在真实 Extension Host 里跑
`integration/facts-refresh.test.ts`，覆盖「文件变化 → watcher → MapService →
MapPanel 消息路由 → `map/facts` 协议解析」这条链路。Webview store 对消息的应用由
`apps/webview/src/app-store.test.ts` 覆盖；关键真实 DOM 旅程由 Playwright 覆盖。
这条链路连续出现过多次「单元测试全绿、真实链路不通」的缺陷，是本仓库最需要
真实环境回归的部分。Webview 的搜索、聚焦、打开源码、GuidedStory、键盘顺序和 axe
门禁由 `pnpm run test:webview` 在真实 Chromium 中覆盖，包括方案审批、Diff 与验收。

TLS 被代理拦截、Node 下载不了 VS Code 时，指向本地已安装的版本：

```bash
GOD_VIEW_VSCODE_PATH="/Applications/Visual Studio Code.app/Contents/MacOS/Code" \
  pnpm --filter "./apps/vscode-extension" run test:integration
```

## 设置

| 设置              | 默认 | 说明                                        |
| ----------------- | ---- | ------------------------------------------- |
| `godView.exclude` | `[]` | 额外排除的 glob。依赖、构建产物等已默认排除 |

只暴露真正被读取的设置。早期版本里的 `maxFileSizeKb`、`saveHistory`、`telemetry`
已移除——它们在代码里没有任何消费者，留着会让人以为改了能生效。
