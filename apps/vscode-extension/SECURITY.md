# Security

Report security issues privately to the publisher contact configured on the Marketplace listing before
public disclosure. Include the God View version, VS Code version, operating system, reproduction steps
and whether a writable ChangeSet was active. Do not include credentials or private source code.

God View treats all Agent text and protocol input as untrusted. Webview text is rendered as text, not
HTML; protocol input is schema-validated; paths must remain workspace-relative; approvals are bound to
workspace, branch, map revision, Git HEAD, path scope and expiry.

The extension declares untrusted and virtual workspaces unsupported, so VS Code blocks activation
before God View can launch local Git, Agent CLI or Gateway subprocesses. Trust only repositories you
intend to run local development tools against.

The current Codex/Claude integration is `monitored`, not an enforcement sandbox. An external Agent can
still write outside the approved paths before God View observes the Git change. God View then reports
the scope violation and preserves the Diff for review; it does not delete or roll back files. Use the
Agent host's own sandbox/permission controls for prevention.

For managed editing runs, God View requires `request_scope_expansion` before an Agent writes a new
path. The Extension Host—not Agent text—records approve/reject decisions and widens `approvedScope`
before resuming the same CLI session. A process that ignores this protocol can still write because the
workspace sandbox is not path-aware; God View rejects post-write approval and preserves that write as
a scope violation.
