# God View

God View 是一个 VS Code 项目地图扩展：外部 Agent 通过 MCP 声明模块、关系与证据，扩展把
代码事实、Agent 声明和用户确认分开呈现，并提供讲解、原位标注、用户批准、monitored
ChangeSet 与 Git Diff 验收闭环。

当前版本是 `0.3.30` 本地发布候选。首次建图可在面板中启动新的 Codex/Claude CLI；已有地图
可由用户确认后根据当前仓库状态重新初始化，旧地图在新 ChangeSet 完成前保持可用。
地图与底部 Agent 输出之间的分隔条可拖动或用键盘调整，高度会按工作区保留。
普通点击模块不会移动镜头或隐藏其他模块；局部浏览会显示醒目状态和返回完整地图入口。
结构变化会用可中断动画保持视觉连续；拖动一个模块不会再触发整图重排。
工具栏的“拓扑排序”可按依赖方向重新整理手工坐标、降低交叉并保存结果；关系线始终绕开模块，
颜色跟随起点，悬停时显示关系类型和原因。关系线使用独立平行线槽，不会共线覆盖；不得不
交叉时用电路跳线表示。
节点标注会在插件内部启动独立 Agent 子线程，实时显示输出，并在 `answer_annotation` 真正
回写权威地图后把结构化答案呈现在原标注中；复制任务仅作为启动失败时的兜底。
“要求修改”标注可在内部完成分析、方案、文件范围批准、可写 Agent 编辑、验证、地图节点/
关系同步与 Git Diff 验收；只有代码 Diff 和地图影响均已落库才显示完成。
托管编辑 Agent 准备修改批准范围外文件时会先提交扩围申请；面板展示文件和原因，只有用户
批准并由扩展宿主更新权威范围后，才恢复同一个 Codex/Claude 会话继续执行。
执行失败、授权过期、正在执行和等待验收会显示为不同状态；失败重试必须由用户重新批准，
扩展会签发新令牌并创建新一轮 ChangeSet，不会静默复用旧授权或重复执行成功方案。
会话可查看实时进度、回答结构化问题，并在最终地图复核后提示重启已有 Agent 会话。
可安装包、完整功能、接入步骤和已知限制见
[扩展 README](./apps/vscode-extension/README.md)。

## 开发与验证

```bash
pnpm install --frozen-lockfile
pnpm run generated-files-check
pnpm run check
pnpm run test:coverage
pnpm run test:webview
pnpm run test:integration
pnpm run release:verify
pnpm --filter './apps/vscode-extension' run package
```

发布支持范围见 [Support Matrix](./docs/SUPPORT_MATRIX.md)，升级和回滚见
[Upgrade and Rollback](./docs/UPGRADE_AND_ROLLBACK.md)，本地发布证据见
[Release Evidence](./docs/RELEASE_EVIDENCE_2026-08-12.md)。

## 安全与权限

God View 不在不受信任或虚拟工作区激活，不读取 Agent 密钥，也不执行 Git add、commit、
push 或自动回滚。自动首次建图进程使用 Codex 只读 sandbox，或 Claude 的读取/MCP 工具
白名单；用户自行打开的其他 Agent 会话仍属于 `monitored` 模式，God View 不能强制隔离它们。

许可证：[MIT](./LICENSE)。
