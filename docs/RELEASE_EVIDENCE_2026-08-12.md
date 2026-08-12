# Local release evidence — 2026-08-12

## Automated results

| Gate                                                  | Result                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| Generated protocol files                              | Pass                                                               |
| Format, lint, strict typecheck, dependency boundaries | Pass                                                               |
| Unit tests                                            | 48 files / 593 tests passed                                        |
| Coverage                                              | Statements 96.73%, branches 91.99%, functions 95.18%, lines 96.97% |
| Webview Chromium journeys and axe                     | 9 / 9 passed                                                       |
| Real VS Code Extension Host journeys                  | 11 / 11 passed                                                     |
| Official npm registry audit                           | No known vulnerabilities found                                     |
| 5,000 / 10,000 entity pure projection-layout budgets  | Pass; see `PERFORMANCE_RESULTS.md`                                 |
| Build                                                 | Pass                                                               |
| VSIX package                                          | 15 files, 437.22 KB                                                |
| Bundled Gateway `--help`                              | Pass                                                               |
| Clean-profile VSIX install                            | `god-view.god-view@0.2.0` installed successfully                   |
| Local 0.1.0 → 0.2.0 install and uninstall             | Pass                                                               |
| Production license allowlist                          | MIT, ISC, BSD-2-Clause, BSD-3-Clause only                          |

VSIX SHA-256: `1e3243ec4b5ea4ddfb4afaad800e2eb0d2ecf88fd93c58d355f42482a09d55bb`.

The final VSIX contains the manifest, README, changelog, privacy/security/license documents,
compiled extension, compiled Webview, layout worker, bundled Gateway and icon. It contains no
TypeScript source, source maps, `node_modules` or workspace data.

The 0.2.0 onboarding fix was also exercised against the installed Claude and Codex CLIs in isolated
temporary configurations. Codex accepted and returned the workspace-specific stdio configuration.
Claude accepted local-scope configuration and reported `Status: ✔ Connected` to the real bundled
Gateway; the temporary entry was removed immediately afterward. A failed Claude subprocess was
observed to return exit code 0, so verification now rejects its `Failed to connect` status explicitly.

## Locally release-gated journeys

- branch-isolated main → feature → main rebinding and old-branch ChangeSet interruption;
- file/directory delete, restore and rename incremental facts refresh;
- explicit TypeScript/JavaScript import drift and recovery;
- annotation → Agent explanation → resolution;
- proposal → user approval → monitored ChangeSet → Diff → user review;
- user interruption with retained file changes;
- completed ChangeSet history selection;
- 30-day event compaction and resolved/unpinned annotation redaction;
- explicit workspace-data clear and map snapshot export.
- native VS Code disablement for untrusted and virtual workspaces;
- release artifact allowlist/denylist checks and a 300 KB Webview gzip budget (recorded: 254,668 bytes).

## Evidence still requiring an external environment or owner action

- obtain green CI runs on Linux, Windows, macOS and minimum VS Code 1.96.0 from the checked-in matrix;
- record Remote SSH, WSL and Dev Container beta smoke results;
- confirm the real Marketplace publisher, repository/support/privacy URLs and publishing credentials;
- perform Marketplace upload/signing as an explicit human release action.

The local minimum-VS-Code download was attempted and failed before launching tests because the local
network injects a self-signed TLS certificate. This is recorded as **not run**, not a compatibility
failure or pass. The release workflow performs the same 1.96.0 journey on a clean Linux runner.

God View must continue to describe Codex/Claude permissions as `monitored`. The current MCP adapters
cannot actively start, sandbox or terminate those external processes, and unknown file writes cannot
be reliably attributed to a particular Agent without host-provided task identity.

## Quality score and release decision

| Dimension                     |        Score | Evidence                                                                                                  |
| ----------------------------- | -----------: | --------------------------------------------------------------------------------------------------------- |
| Correctness and tests         |      23 / 25 | High coverage and local critical journeys pass; remote cross-platform evidence remains pending            |
| Maintainability               |      19 / 20 | Strict lint/type gates, no dependency cycles, documented boundaries and release automation                |
| Protocol and data reliability |      15 / 15 | Schema generation, deterministic replay, 0.1.0 compatibility fixture and branch isolation pass            |
| Performance and stability     |      12 / 15 | Pure 5K/10K budgets and bundle budget pass; end-user paint and 100K replay remain limited evidence        |
| Security and privacy          |      14 / 15 | No known dependency vulnerabilities, Workspace Trust boundary, scoped paths and documented monitored mode |
| UX and accessibility          |       9 / 10 | 9 Chromium journeys, axe and keyboard route pass; multi-platform visual exploration remains pending       |
| **Total**                     | **92 / 100** | Local quality level A                                                                                     |

Local hard gates pass with no known P0/P1 defects and no quality waiver. Public Marketplace release
is **not yet authorized** because the exact commit has no cross-platform CI result and the Marketplace
publishing credential is still missing. Publisher ownership is confirmed as `ZengShaoJie`. The primary
Gitee repository URL is known, but a GitHub Actions mirror or equivalent Gitee pipeline must produce the
checked-in matrix evidence. Those are ownership/evidence gates, not implementation defects.
