# sample-project 手测夹具

`packages/testkit` 的 `sampleProjectEvents()` 声明的就是这个项目的结构。两边保持一致，
地图里的路径才能真的落到磁盘上的文件，覆盖率与漂移检测才有意义。

## 结构

| 节点               | 路径          | 说明                   |
| ------------------ | ------------- | ---------------------- |
| `module.api`       | `src/api`     | HTTP 入口              |
| `module.orders`    | `src/orders`  | 下单、改单与取消       |
| `module.payment`   | `src/payment` | 发起支付并处理回调     |
| `storage.postgres` | —             | 外部存储，无第一方文件 |
| `external.stripe`  | —             | 第三方支付服务         |

`config/app.json` 与 `src/unclassified.ts` 故意不属于任何节点：前者用来验证配置文件
按用途聚合，后者用来验证「未分类文件必须显式可见」而不是被静默丢弃。

## 端到端手测步骤

1. 在仓库根执行 `pnpm run build`。
2. VS Code 打开仓库，按 F5 启动 Extension Development Host。
3. 在新窗口里打开 `fixtures/sample-project` 作为工作区。
4. 执行命令「God View: Open Project Map」。此时地图为空，状态栏应显示覆盖率与未分类数量。
5. 回到仓库根，把示例事件写成 JSONL 后投递：

   ```bash
   node -e "import('./packages/testkit/dist/index.js').then(m => \
     process.stdout.write(m.sampleProjectEvents().map(e => JSON.stringify(e)).join('\n')))" \
     > /tmp/sample-events.jsonl
   node apps/agent-gateway/dist/bin/god-view.js emit /tmp/sample-events.jsonl \
     --workspace fixtures/sample-project
   ```

   `sampleProjectEvents()` 的事件信封写死为 `ws-test/main`，而扩展写出的
   `.godview/session.json` 用的是真实工作区哈希，两者不一致时事件会被
   `WORKSPACE_MISMATCH` 拒绝——这是正确行为。手测时按 `session.json` 里的
   `workspaceId` 与 `branchKey` 改写事件信封：

   ```bash
   node -e "
     const fs = require('node:fs');
     const d = JSON.parse(fs.readFileSync('fixtures/sample-project/.godview/session.json', 'utf8'));
     const lines = fs.readFileSync('/tmp/sample-events.jsonl', 'utf8').trim().split('\n');
     process.stdout.write(lines.map(l => JSON.stringify({
       ...JSON.parse(l), workspaceId: d.workspaceId, branchKey: d.branchKey,
     })).join('\n'));
   " > /tmp/sample-events-scoped.jsonl
   node apps/agent-gateway/dist/bin/god-view.js emit /tmp/sample-events-scoped.jsonl \
     --workspace fixtures/sample-project
   ```

6. 地图应在不刷新的情况下增量出现五个节点与四条关系。

## 验收要点

- 入口在左、存储与外部系统在右，方向可读；
- `module.payment` 的详情里显示「Agent 声明的不确定点」；
- 所有节点的代码校验状态是「未校验」或「已证实」，不得显示成事实；
- 状态栏的未分类数量至少为 1（`src/unclassified.ts`）；
- 拖动节点后重新打开地图，位置保持不变。

## 分支热切换闭环手测

逻辑层已有回归测试（`branch-binding.test.ts`、`branch-follow.test.ts`、
`operation-queue.test.ts`），但「扩展 + Gateway + Webview 三方在同一次运行里跨分支往返」
只能人工验证。以下流程走 main → feature → main，**全程不重启 MCP 进程**。

前置：夹具目录需要是一个 Git 仓库。

```bash
cd fixtures/sample-project
git init && git add -A && git commit -m init
```

1. 起 Extension Development Host，打开该目录，执行 **God View: Open Project Map**。
2. 保持 `god-view serve` 或复用同一个 MCP 会话，在 **main** 上让 Agent 建一个节点
   （或用 `emit` 投递一条 `node_upsert`）。确认地图出现该节点。
3. 切分支：

   ```bash
   git checkout -b feature/x
   ```

4. **不重启任何进程**，在 feature 上再建一个不同 id 的节点。

   预期：
   - Webview 整张图被替换，只剩 feature 上刚建的节点，main 的节点消失；
   - 状态栏分支标签变成 `feature/x`；
   - 写工具的返回值里带一条 warning，提示分支已切换、需要重新 `get_map`；
   - 侧边栏结构树与 Webview 内容一致（不一致说明只有一侧收到了更新）。

5. 切回 `git checkout main`，确认 main 的节点原样回来，feature 的节点不出现。

6. 核对落盘结果。存储根按 workspaceId + branchKey 分目录：

   ```bash
   # macOS 下 Extension Development Host 的全局存储
   find ~/Library/Application\ Support/Code/User/globalStorage/god-view.god-view \
     -name events.jsonl -exec sh -c 'echo "--- $1"; cat "$1"' _ {} \;
   ```

   预期：两个分支各一份 `events.jsonl`，每条事件的 `branchKey` 与它所在的目录一致，
   **没有任何一条事件出现在另一个分支的日志里**。

7. 核对 `fixtures/sample-project/.godview/map.json` 的 `branchKey` 与当前分支一致。

### 已知限制

`.git/HEAD` 监听覆盖不到 git worktree 与 submodule。这两种情况下分支变化要靠再次执行
**God View: Open Project Map** 触发同步。

## 文件增量漂移手测

分支热切换与文件增量漂移都已在真实 Extension Host 中验证通过。下面保留为可重复的
人工验收流程；自动化回归位于 `apps/vscode-extension/integration/facts-refresh.test.ts`。

1. 打开地图，确认 `module.payment` 的代码校验状态是「已证实」。
2. 删除 `src/payment/index.ts`。

   预期：约 1 秒后状态栏出现漂移计数，`module.payment` 变成「已漂移」。

3. 恢复该文件。

   预期：漂移计数回落，节点状态回到「已证实」。

4. 重命名整个 `src/payment` 目录。

   预期：同样触发漂移——目录级变化只会报告目录一条路径，声明它的节点必须被选中。

5. 打开输出面板查看 `facts.incremental` 日志行，核对 `changedPaths` 与 `affectedIds`。

   `affectedIds` 为 0 而文件确实属于某个节点，说明问题在增量选择链路；
   `affectedIds` 不为 0 但漂移没变，说明问题在校验器或聚合。

6. **不重新打开地图**，确认状态栏的漂移与覆盖率数值当场变化。

   这一步单独列出来，是因为它曾经独立失效过：后端数据全对、`map.json` 也对，
   但事实更新沿用图版本排序被 Webview 判为过期丢弃，UI 一直停在旧值，
   重新打开面板才正确。现在走独立的 `map/facts` 消息与 `factsRevision`。

### 覆盖率分母

删除一个已跟踪文件后，状态栏的「纳入范围」总数应当立即减一。之前
`git ls-files --cached` 会把已删除但未 `git add` 的文件继续算进分母，
导致覆盖率虚低且用户在仓库里找不到那个文件。
