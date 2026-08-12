# Changelog

All notable changes to God View are documented here.

## 0.2.0 - 2026-08-12

- Added explicit, user-confirmed Codex and Claude Code MCP configuration from the command palette and empty-map onboarding.
- Added immediate verification through each Agent's official `mcp get god-view` command and explicit conflict replacement consent.
- Added mandatory restart guidance because an already-running Agent session cannot hot-load newly configured MCP tools.
- Made generated initialization and maintenance tasks stop before repository scanning when required God View tools are absent.
- Kept copyable manual MCP commands as a fallback when CLI configuration or verification fails.
- Added a Chromium journey covering both Agent configuration buttons and the task/manual fallback actions.
- Disabled activation in untrusted and virtual workspaces through native VS Code capabilities.
- Added a Marketplace PNG icon, explicit support matrix and release-candidate artifact verification.

## 0.1.0 - 2026-08-12

- Added branch-isolated, append-only project maps with live branch rebinding.
- Added incremental coverage and drift refresh for files, locations, directory changes and Git deletions.
- Added searchable multi-level map UI, source navigation and declarative GuidedStory playback.
- Added in-place annotations, structured Agent explanations and evidence links.
- Added write-access requests, change proposals, user-owned approval tokens and monitored ChangeSets.
- Added metadata-only Git Diff review, scope-violation warnings and user acceptance without Git mutation.
- Added user interruption with retained Diff and automatic old-branch interruption before rebinding.
- Added L1 verification for explicitly declared TypeScript/JavaScript relative import relationships.
- Added distinct Codex CLI and Claude Code MCP adapter identities plus JSON/JSONL fallback import.
- Added Webview restoration, Chromium/axe tests, cross-platform Extension Host CI and VSIX packaging.
- Added an explicit, confirmed local-data clear command and workspace-isolated layout keys.
- Added per-workspace data-boundary consent before copying any cloud-capable Agent setup.
- Added 30-day event compaction with resolved-annotation body redaction while retaining the current map and pinned/unresolved annotations.
- Added a completed ChangeSet history selector with status, timestamp, file count and retained Diff metadata.
- Added explicit export of the current protocol map snapshot without source contents or Git mutation.

### Known limitations

- Codex and Claude Code are MCP guided-call adapters; the extension cannot actively start or stop them.
- Permission mode is `monitored`: God View detects out-of-scope Git changes but cannot sandbox an external Agent process.
- Agent-side cloud transfer, cost and retention follow the selected Agent's own policy.
- Remote SSH, WSL and Dev Container are beta compatibility targets and are not release-gated yet.
