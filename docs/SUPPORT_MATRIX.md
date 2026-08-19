# Support matrix

God View 0.3.38 targets local, trusted, file-backed VS Code workspaces. Claims below distinguish
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

First-map initialization opens an official Codex or Claude Code terminal and does not override the
Agent's native sandbox or approval configuration. God View adds a project UserPromptSubmit hook and
MCP registration; Codex may require native project-hook trust on first use. Source writes remain
`monitored`: God View can surface out-of-scope Git changes but cannot replace the Agent or operating
system sandbox. The protocol pre-write gate records requested paths, the user decides in God View,
and the Extension Host updates authoritative scope before notifying the same native terminal.
