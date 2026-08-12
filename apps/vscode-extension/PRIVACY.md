# Privacy

God View has no telemetry, analytics, account system or network client. It stores project-map state,
event logs, annotations, layout and metadata-only Diff summaries locally in VS Code extension storage
and the workspace `.godview` runtime directory.

God View does not copy source contents into Diff history. Stored Diff data is limited to paths,
change types, line counts, attribution labels, timestamps and a hash. The extension invokes local
`git` commands for read-only inspection and never runs `git add`, commit, push or automatic rollback.

Codex CLI and Claude Code are separate external products. When you choose to send a God View task to
an Agent, that Agent may transmit workspace content to its provider. God View cannot determine or
control that transfer, price or retention. Review the selected Agent's settings and data policy before
use. God View never reads or copies Agent API keys, credentials or login configuration.

God View declares untrusted and virtual workspaces unsupported. VS Code therefore blocks activation
until the user trusts a local file-backed workspace; this prevents the extension from launching Git,
Agent CLI or Gateway subprocesses for untrusted repository contents.

To stop collection, remove the Agent-side `god-view` MCP configuration and stop using the extension.
Use **God View: Clear Current Workspace Data** before uninstalling to remove the selected workspace's
extension state and `.godview` runtime directory without touching source or Git history. Uninstalling
alone does not delete local extension storage.
