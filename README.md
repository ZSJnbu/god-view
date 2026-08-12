# God View

God View 是一个 VS Code 项目地图扩展：外部 Agent 通过 MCP 声明模块、关系与证据，扩展把
代码事实、Agent 声明和用户确认分开呈现，并提供讲解、原位标注、用户批准、monitored
ChangeSet 与 Git Diff 验收闭环。

当前版本是 `0.2.0` 本地 MVP 发布候选。可安装包、完整功能、接入步骤和已知限制见
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
push 或自动回滚。Codex/Claude Code 接入属于 `monitored` 模式：能报告越界 Diff，但不能
强制沙箱化外部 Agent。

许可证：[MIT](./LICENSE)。
