# God View

God View 是一个 VS Code 项目地图扩展：外部 Agent 通过 MCP 声明模块、关系与证据，扩展把
代码事实、Agent 声明和用户确认分开呈现，并提供讲解、原位标注、用户批准、monitored
ChangeSet 与 Git Diff 验收闭环。

当前版本是 `0.3.38` 本地发布候选。首次建图可在面板中打开官方 Codex/Claude 终端；已有地图
可由用户确认后根据当前仓库状态重新初始化，旧地图在新 ChangeSet 完成前保持可用。
地图与底部原生 Agent 入口之间的分隔条可拖动或用键盘调整，高度会按工作区保留。
普通点击模块不会移动镜头或隐藏其他模块；局部浏览会显示醒目状态和返回完整地图入口。
结构变化会用可中断动画保持视觉连续；拖动一个模块不会再触发整图重排。
工具栏的“拓扑排序”可按依赖方向重新整理手工坐标、降低交叉并保存结果；关系线始终绕开模块，
颜色跟随起点，悬停时显示关系类型和原因。关系线使用独立平行线槽，不会共线覆盖；不得不
交叉时用电路跳线表示。
God View 不再实现独立 Agent 对话或权限协议：扩展直接承载官方 Codex/Claude TUI，系统权限、
提问、历史与恢复全部由官方终端处理；UserPromptSubmit hook 注入轻量画布上下文，MCP 回写
结构化地图事件。节点标注与“要求修改”都会发送到同一个原生终端，业务方案和文件范围仍由
God View 审批。Agent 准备修改批准范围外文件时会先提交扩围申请；用户批准后权威 ChangeSet
更新，并自动通知当前官方终端继续。
执行失败、授权过期、正在执行和等待验收会显示为不同状态；失败重试必须由用户重新批准，
扩展会签发新令牌并创建新一轮 ChangeSet，不会静默复用旧授权或重复执行成功方案。
画布会记录本次打开后收到的 MCP 地图补丁，可暂停、逐步、变速并回放 AI 对画布的调整。
工具栏的「历史回放」按当前分支的提交历史重放项目如何一点点长起来：模块逐个出现、体量随
代码量增长、本次提交改动的节点高亮，位置全程固定；只读 Git，不修改工作区。
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
push 或自动回滚。扩展不会覆盖 Codex/Claude 自己的 sandbox 与 approval 配置；系统权限按
用户本地官方 Agent 设置执行。God View 的业务文件范围仍是 `monitored`，不能替代操作系统沙箱。

许可证：[MIT](./LICENSE)。
