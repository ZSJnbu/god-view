# Upgrade and rollback

> Applies to the local VS Code extension and Gateway runtime. God View does not modify Git
> history or roll back user source files.

## Compatibility contract

- Protocol `1.x` readers accept compatible `1.x` events and snapshots, including unknown
  optional fields. A different major version is rejected with an explicit diagnostic.
- Branch data remains isolated under the extension storage root. An unusable snapshot falls
  back to replaying its append-only event log; invalid log lines are quarantined without
  copying their payload.
- `fixtures/compat/v0.1.0` is the first immutable release fixture. Every later release must
  restore the immediately previous stable fixture without rejected or quarantined records.

### Protocol 1.0 → 1.1

Protocol 1.1 adds the optional `stories` snapshot/read-model field plus the `story_upsert` event
and `upsert_story` tool. Existing 1.0 snapshots require no rewrite: a 1.1 reader treats a missing
`stories` field as an empty collection, and the permanent 0.1.0 fixture proves that path. A 1.0
Gateway cannot author stories but can continue reading the node/edge subset; copy Agent setup and
restart MCP to enable the new tool.

### Protocol 1.1 → 1.2

Protocol 1.2 adds annotation threads, structured Agent answers and write-access/proposal records.
Missing collections restore as empty. Approval remains a separate user-owned event; an explanation
never implies write authorization.

### Protocol 1.2 → 1.3

Protocol 1.3 adds approval tokens, monitored active ChangeSets, metadata-only Git Diff summaries,
completed-change review records, and a separate facts revision for non-graph updates. Snapshots reset
the facts baseline on branch reload. Diff persistence contains paths, counts, attribution and a hash,
not source contents. Re-copy Agent setup after this upgrade so Codex and Claude Code use their
separate `--adapter` identities. Active ChangeSets are interrupted before a branch rebind; this ends
the God View state only and deliberately leaves source-file changes untouched. Explicitly declared
TypeScript/JavaScript relative imports can now receive L1 validation; aliases and other languages
remain unverified rather than being inferred. On branch open, raw events older than 30 days are
compacted behind the current structural snapshot; old resolved/unpinned annotation bodies are
redacted, while unresolved or pinned annotations remain intact.

## Extension upgrade

On activation the extension copies its bundled Gateway to the version-independent location
`globalStorage/runtime/god-view.mjs`, then writes `runtime.json` with the extension and protocol
versions. Agent configuration therefore survives replacement of the versioned extension
installation directory.

### 0.1.0 → 0.2.0

Version 0.2.0 closes the gap between copying an onboarding task and actually registering the bundled
Gateway with an Agent. Installing the VSIX upgrades the runtime to protocol 1.3, but an Agent process
that was already running keeps its startup-time tool list. After installing 0.2.0:

1. Reload VS Code and run **God View: Open Project Map** for the target workspace.
2. Run **God View: Configure Agent MCP**, choose the Agent, review the data boundary and confirm.
3. Require the success message that says the official `mcp get god-view` verification passed.
4. Exit the existing Codex or Claude Code session, start a new one in the same workspace directory,
   and call `get_map` before pasting an initialization or maintenance task.
5. Check `.godview/session.json` reports protocol `1.3`; do not edit that file manually.

Version 0.2.0 also declares untrusted and virtual workspaces unsupported. If the extension is disabled
after upgrade, verify the folder is a local file-backed workspace and use VS Code Workspace Trust only
after reviewing the repository. Do not bypass this boundary merely to make God View activate.

**Copy Agent Setup** is now a fallback for manual configuration, not the recommended onboarding path.
The extension never silently rewrites a conflicting same-name configuration; replacement needs an
additional user confirmation.

After any upgrade:

1. Run **God View: Show Diagnostics** and require `runtimeGateway=ready` with the installed
   extension version.
2. Run **God View: Configure Agent MCP** again when diagnostics ask for it, require successful
   verification, then exit and restart the Agent session.
3. Open an existing map and verify that its branch, revision, annotations and history are
   present before accepting the release.

The Gateway bundle is replaced before its small metadata file. If metadata writing is
interrupted, the complete new Gateway remains executable while diagnostics may report the old
version until the next activation repairs metadata. The source bundle is fully read before any
replacement, and each individual file uses atomic replacement, so a missing or half-read VSIX
asset cannot destroy the installed runtime. This deliberate roll-forward behavior avoids a
second fallible write while attempting to restore an older bundle.

## Roll back the extension

1. Keep the VSIX for the last known-good commit.
2. Install that VSIX through VS Code's **Install from VSIX...** action and reload the window.
3. Run **God View: Show Diagnostics**. If the stored protocol major is newer than the rolled-back
   reader, do not write new events; reinstall the newer extension or restore a pre-upgrade data
   backup.
4. Run **God View: Configure Agent MCP** and restart the Agent session so the stable runtime is
   refreshed from the rolled-back VSIX.

Before a release that changes storage or protocol major version, make a copy of the workspace's
God View extension storage. Restore by closing all VS Code windows for the workspace and copying
that backup back as a unit. Never combine a snapshot from one backup with an event log from
another.

## Release evidence

A release candidate records:

- current and previous VSIX versions;
- the previous-version fixture test result;
- Extension Host integration result;
- `runtime.ready` and diagnostics output after an actual window reload;
- stable Gateway `--help` smoke-test result;
- any migration failure, quarantine or rejected-event count.
