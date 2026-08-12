# Support matrix

God View 0.2.0 targets local, trusted, file-backed VS Code workspaces. Claims below distinguish
recorded evidence from targets that still require CI or environment-owner verification.

| Environment                      | Status              | Evidence / limitation                                                                                            |
| -------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| macOS, VS Code stable, local Git | Verified            | 11 Extension Host journeys, clean-profile VSIX install, Claude/Codex CLI configuration smoke                     |
| VS Code 1.96.0 minimum           | CI target           | Checked into the release matrix; the current local network cannot download it because of a self-signed TLS proxy |
| Linux, VS Code stable and 1.96.0 | CI target           | GitHub Actions matrix uses `xvfb-run`; a green remote run is required before public upload                       |
| Windows, VS Code stable          | CI target           | GitHub Actions matrix; a green remote run is required before public upload                                       |
| Non-Git local folder             | Supported read-only | Map, explanation and inventory work; writable ChangeSets are rejected                                            |
| Untrusted workspace              | Disabled            | VS Code blocks extension activation through manifest capabilities                                                |
| Virtual workspace                | Disabled            | Local filesystem watching, Git and `.godview/session.json` are required                                          |
| Remote SSH / WSL / Dev Container | Beta, unverified    | Not a first-MVP blocker; do not describe as supported until a recorded smoke passes                              |
| VS Code for the Web              | Unsupported         | The extension and bundled stdio Gateway require a desktop Extension Host                                         |

Codex and Claude Code integrations are `monitored`, not enforcement sandboxes. God View can surface
out-of-scope Git changes but cannot prevent an external Agent process from writing them.
