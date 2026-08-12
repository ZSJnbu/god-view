# Release checklist

## Automated evidence

- `pnpm run generated-files-check`
- `pnpm run check`
- `pnpm run test:coverage`
- `pnpm run build`
- `pnpm run test:webview`
- `pnpm run test:integration` on stable and minimum VS Code across Linux/macOS/Windows CI
- `pnpm run release:verify` (Workspace Trust/virtual-workspace manifest, required package files,
  forbidden-file scan, Webview gzip budget and official registry audit)
- `pnpm --filter "./apps/vscode-extension" run package`
- inspect the VSIX file list: no source maps, source files, `node_modules` or workspace data
- run `pnpm audit --prod` and record any build-only advisory separately

## Manual release evidence

- Install the VSIX into a clean VS Code profile and open a Git and a no-Git workspace.
- Run **Show Agent Adapters** and **Configure Agent MCP** for both Codex and Claude Code; require the
  built-in `mcp get god-view` verification, exit each old Agent session, reopen it in the workspace,
  and call `get_map` before giving it an initialization task.
- Exercise **Copy Agent Setup** as the manual fallback without claiming that copying alone connects
  the current Agent session.
- Complete one clean approved ChangeSet and one deliberate out-of-scope write; verify no automatic
  `git add`, commit, push, deletion or rollback.
- Reload the VS Code window with the map open and verify Webview restoration.
- Run **Clear Current Workspace Data** on a disposable workspace; verify only God View local state
  is removed and source files, Git history, index and working tree remain unchanged.
- Verify upgrade from the previous immutable fixture and retain the previous VSIX.
- Confirm Marketplace publisher ownership, icon/metadata, privacy link, signing/publish token isolation
  and release notes before uploading. Publishing is an explicit human action.
- Protect the `marketplace` GitHub Environment with a required reviewer and store `VSCE_PAT` there;
  never expose it to pull-request jobs or artifact logs.
- Replace any placeholder publisher/repository/support URLs, create the first immutable Git commit and
  require a green `Release candidate` workflow for the exact version tag.

## Current beta compatibility

Remote SSH, WSL and Dev Container require recorded smoke results but do not block the first local MVP.
The public release must not describe monitored external-Agent permissions as enforced.
