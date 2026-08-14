# Support matrix

God View 0.3.34 targets local, trusted, file-backed VS Code workspaces. Claims below distinguish
recorded evidence from targets that still require CI or environment-owner verification.

| Environment                      | Status              | Evidence / limitation                                                               |
| -------------------------------- | ------------------- | ----------------------------------------------------------------------------------- |
| macOS, VS Code stable, local Git | Verified in source  | 12 Extension Host journeys plus Chromium and Claude/Codex CLI argument smoke        |
| VS Code 1.96.0 minimum           | Verified in CI      | Linux 1.96.0 Extension Host journey passed in GitHub Actions run 31571426772        |
| Linux, VS Code stable and 1.96.0 | Verified in CI      | Both `xvfb-run` matrix entries passed in GitHub Actions run 31571426772             |
| Windows, VS Code stable          | Verified in CI      | Extension Host matrix entry passed in GitHub Actions run 31571426772                |
| Non-Git local folder             | Supported read-only | Map, explanation and inventory work; writable ChangeSets are rejected               |
| Untrusted workspace              | Disabled            | VS Code blocks extension activation through manifest capabilities                   |
| Virtual workspace                | Disabled            | Local filesystem watching, Git and `.godview/session.json` are required             |
| Remote SSH / WSL / Dev Container | Beta, unverified    | Not a first-MVP blocker; do not describe as supported until a recorded smoke passes |
| VS Code for the Web              | Unsupported         | The extension and bundled stdio Gateway require a desktop Extension Host            |

Automatic first-map initialization launches a new constrained CLI subprocess: Codex receives a
read-only sandbox and Claude receives an explicit read/MCP allowlist plus write/shell denylist.
Already-open or manually launched Agent sessions remain `monitored`; God View can surface their
out-of-scope Git changes but cannot prevent those external processes from writing them.
Managed editing runs add a protocol-level pre-write gate: the Agent requests new paths, the user
decides in God View, and the Extension Host updates authoritative scope before resuming the same
session. This is still monitored behavior, not a per-file operating-system sandbox.
