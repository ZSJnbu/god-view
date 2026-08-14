# Changelog

All notable changes to God View are documented here.

## 0.3.29 - 2026-08-14

- Adds pre-write scope expansion requests for managed Codex and Claude editing runs. The Agent must list new files and a reason, then stop before writing them.
- Shows a dedicated approve/reject card in the project Agent conversation. The Extension Host records the user decision and expands the authoritative ChangeSet scope before resuming the same CLI session.
- Prevents Agent-authored or post-write approval from widening scope, preserves request/decision audit history, and keeps rejected files outside the approved scope.
- Stops treating task-preexisting out-of-scope changes alone as a new Agent scope violation while retaining their `preexisting_overlap` Diff attribution.

## 0.3.28 - 2026-08-14

- Allows project-level change requests directly from Agent chat without requiring the user to select a map node first.
- Uses a deterministic, bounded set of active top-level semantic nodes as project context, with safe fallbacks for malformed or file-only maps.
- Explains the inferred project context beside the composer and adds unit plus real-browser regressions for the previously disabled checkbox.

## 0.3.27 - 2026-08-13

- Keeps change requests in the project Agent conversation after analysis by rendering the proposed file scope, structural changes, risks and validation plan directly in the same pane.
- Replaces the misleading completed state with an explicit “waiting for approval” handoff; approving the selected scope immediately starts the internal editing Agent.
- Explains that non-Git workspaces need an initial Git baseline before God View can attribute Agent edits, enforce scope and present a trustworthy Diff review.

## 0.3.26 - 2026-08-13

- Adds a versioned map-change timeline for the current Agent session, keeping the authoritative map revision separate from the revision currently rendered on screen.
- Adds pause, resume, single-step, 0.5×/1×/2× speed, replay-session and jump-to-latest controls while preserving the latest authoritative state.
- Rejects stale map patches, bounds the in-memory replay history and adds regression coverage for rapid multi-revision Agent updates.

## 0.3.25 - 2026-08-13

- Waits for the authoritative map to consume accepted annotation and approved-edit events before deciding whether an internal Agent run succeeded, eliminating false failures caused by event-projection latency.
- Collapses large MCP JSON payloads into concise map-read, write-accepted and write-rejected activity lines while retaining the exact raw stream in exported diagnostics.
- Adds bounded convergence, non-convergence and raw-output regressions so the UI never claims success before authoritative state confirms it.

## 0.3.24 - 2026-08-13

- Replaces the nearly invisible 8px floating-window drag target with a full, labelled title bar and clear move cursor/hover feedback.
- Fixes cumulative pointer deltas that made repeated floating-window rerenders produce unstable or ineffective dragging.
- Adds arrow-key movement from the title bar, with Shift for larger steps, while continuing to persist the final workspace position.

## 0.3.23 - 2026-08-13

- Adds Markdown export for the complete project Agent conversation, including workspace/map context, transcript, activities and the latest raw run output for maintenance diagnostics.
- Adds a persistent docked/floating mode switch for project Agent chat. The floating window can be dragged and resized while keeping the same live Agent thread.
- Saves floating mode, position and size per workspace and clamps the window to usable viewport bounds.

## 0.3.22 - 2026-08-13

- Adds a persistent, resizable in-map Agent conversation with continuous natural-language turns and live output.
- Keeps ordinary conversation read-only; “Request change” enters the existing proposal, file-scope approval, internal editing and Diff review journey.
- Preserves the user's current camera during map patches. Added, updated and removed modules/relationships now transition continuously and touched entities receive a soft visual pulse.
- Fixes incremental map updates fitting the whole graph and making unaffected modules appear to disappear.

## 0.3.21 - 2026-08-13

- Adds an internal project-editing Agent thread. Approved proposals now start Codex or Claude directly inside God View, with live output, cancellation and follow-up answers instead of copying an authorization task to an external session.
- Adds **Request Change** as a first-class annotation type. The read-only analysis thread must answer the annotation, request write access and submit a scoped file/structure/risk/validation proposal before any edit can start.
- Keeps the user-controlled file-scope gate: the editing thread receives a short-lived approval token, starts an approved monitored ChangeSet and runs with workspace-write permissions only after explicit approval.
- Requires editing Agents to update affected God View nodes and relationships with the same ChangeSet. A run cannot report success unless both a reviewable Git Diff and at least one authoritative map node/edge update exist.
- Marks annotations as in progress while editing, needs clarification on failed/interrupted completion, and resolved only after the user accepts the resulting Diff.
- Shows the change summary plus touched module and relationship IDs in the Diff review, and adds free-form follow-up input when an Agent asks for clarification.
- Adds reducer, runner, command-boundary and real Chrome coverage for approve → internal edit stream → code/map synchronization → Diff review.

## 0.3.20 - 2026-08-13

- Turns annotation creation into an internal Agent journey: the extension starts a dedicated Codex or Claude child session automatically instead of asking users to copy the question into an external session.
- Streams the child session's live output in the resizable Agent pane and binds the run to its annotation, with retry and cancellation remaining inside God View.
- Requires both `get_map` and `answer_annotation` in the child prompt, and only reports success after the authoritative map actually contains an Agent answer for the same annotation ID.
- Keeps “Copy Manual Task” strictly as a fallback when the configured internal Agent cannot start, and deduplicates repeated nested CLI stream text.
- Adds command-boundary, runner, map write-back, XSS and real Chrome journey coverage for create → stream → `answer_annotation` → structured inline answer → resolve.

## 0.3.19 - 2026-08-13

- Makes module-to-module overlap a hard layout constraint. Semantic layout, topological sorting and incremental AI-added nodes now resolve collisions using the nodes' rendered rectangles plus a readable safety gap.
- Replaces the old center-coordinate collision check with actual rectangular overlap assertions, catching the partially stacked modules that previously passed validation.
- Dragging a module onto another module now snaps the moved module to the nearest valid edge rather than leaving both cards stacked.
- Exposes the real rendered overlap count and adds dense-map Chrome regressions requiring zero overlaps after initial drawing, interrupted redraws and topological sorting.

## 0.3.18 - 2026-08-13

- Turns missing drawing levels into explicit next actions: module-only maps now offer **AI Complete Group Hierarchy** and **AI Complete Key File Relationships** instead of silently hiding the missing capabilities.
- Adds dedicated incremental Agent runs for group and file completion. They preserve existing modules, relationships, stable IDs and manual layout instead of reinitializing the full map.
- File completion asks the Agent for evidenced entry/boundary files and verified cross-module relationships, explicitly preventing thousands of repository files from being flattened onto the canvas.
- Shows completion-specific progress, cancellation and verified-success states, while preventing completion from racing an active Agent run or ChangeSet.

## 0.3.17 - 2026-08-13

- Renames the ambiguous top-level controls to **Drawing Level**, **Group Overview**, **Module Relationship Map** and **File Relationship Map**, making clear that these controls change graph structure rather than open detail pages or zoom the camera.
- Hides group/file drawing levels when selecting them would produce the same graph as the module level, removing controls that appeared broken on module-only maps.
- Directs users to click a module for the actual responsibilities, file paths and annotations, while explaining that the file relationship map only draws file nodes explicitly declared by the Agent.
- Adds real Chrome coverage for both module-only maps and a genuine group → module → file hierarchy, proving that every visible drawing-level control changes the rendered graph.

## 0.3.16 - 2026-08-13

- Fixes the annotation action appearing broken after users selected context paths. The action is always clickable; missing content now focuses and scrolls to the text field with a concrete inline error.
- Makes the annotation submit area sticky at the bottom of the details panel, so the input requirement and action remain understandable even with dozens of context paths.
- Constrains context paths to a scrollable list with included/total counts plus Select All and Select None controls, clarifying that paths are optional context rather than the annotation body.
- Shows an explicit “annotation created and sent” status after submission and labels the action according to the selected annotation type.

## 0.3.15 - 2026-08-13

- Removes all inline Cytoscape relation text and text backgrounds, eliminating the black rectangles that appeared when many related lines were highlighted in dark themes.
- Hovering or selecting a module now only highlights its connected lines. It never opens labels for all connected relations at once.
- Hovering one relation opens at most one upright React tooltip containing relationship type, direction and reason; it does not rotate, scale with the graph or stack with other labels.
- Adds a real Chrome regression asserting dense maps keep inline edge labels disabled while module highlighting preserves all 26 visible lines.

## 0.3.14 - 2026-08-13

- Prevents visible relation lines from sharing a collinear segment and appearing to be one missing line. Collinear overlap is now a hard routing constraint rather than merely a crossing penalty.
- Adds multiple deterministic ports around every module and parallel lane candidates around occupied segments, so same-source and same-target relations fan out immediately.
- Replaces the shared outer-bus fallback with independent parallel outer channels. Dense cyclic maps may use more canvas space, but every rendered relation remains individually traceable.
- Adds overlap-pair and overlap-length metrics plus unit and real Chrome regressions requiring zero visible relation overlap after topological sorting.

## 0.3.13 - 2026-08-13

- Added an explicit **Topological Sort** action. It discards stale manual coordinates only when clicked, breaks cyclic dependency direction deterministically, layers modules by dependency and applies barycenter sweeps to reduce crossings before persisting the result.
- Strengthened circuit routing so no failure path can fall back to a diagonal through a module. Routed lines expose measured crossing and node-intersection metrics; unavoidable crossings keep rounded jump-wire bridges and insulation gaps.
- Relation lines now explain themselves without covering the map: outgoing color follows the source module, arrowheads show direction, hover/selection reveals the relationship type plus its map reason, and a permanent legend explains arrows and circuit bridges.
- Added unit and real Chrome regressions covering deterministic cyclic topology, coordinate replacement, zero line-through-module intersections, measurable crossing reduction, saved layout and all 9 modules/26 rendered lines remaining visible.

## 0.3.12 - 2026-08-13

- Fixed dragging a module making every relation disappear. Obstacle routing can legitimately produce a direct route with no intermediate controls; this now restores Cytoscape's valid straight-segment defaults instead of writing empty control arrays.
- Added a real Chrome pointer-drag regression on the 9-module/26-line topology and verifies all 9 modules and all 26 lines remain rendered and visible after rerouting.

## 0.3.11 - 2026-08-13

- Replaced unreadable always-on relation labels with labels that appear only for the selected or hovered module/line, eliminating the black blocks seen at normal zoom.
- Gives every visible module a stable distinct color and derives outgoing relation colors from their source module, so dense flows can be traced visually.
- Routes relations with a deterministic obstacle-aware circuit router: rounded orthogonal paths avoid module rectangles, penalize crossings, and insert visible jump-wire arcs plus insulation gaps where crossings remain unavoidable.
- Invalidates pre-routing saved coordinates once so the new semantic layout is not overridden by positions created for straight-line rendering; new user drags remain persistent.

## 0.3.10 - 2026-08-13

- Fixed interrupted Cytoscape transitions leaving most existing relations permanently transparent. Every render, selection and completed drag now clears transition-only opacity and verifies actual rendered/visible element counts.
- Separates the number of visible lines from the number of underlying declared relations, so aggregation can no longer look like missing content.
- Increased relation contrast and highlights all connected relations for the selected module without dimming or hiding the rest of the map.

## 0.3.9 - 2026-08-13

- Added object-constancy transitions for every structural graph change: retained modules move smoothly, new modules expand from related nodes and fade in, removed modules fade out, and relations transition with them.
- Made graph transitions interruptible. Rapid view changes cancel the obsolete animation and continue from the current visual state instead of queuing stale screens.
- Smoothly fits the resulting graph after structural transitions while ordinary selection remains camera-neutral; `reducedMotion` still switches immediately without animation.
- Fixed dragging one module making other modules appear to disappear. A drag now silently merges and persists only that node's coordinates without notifying React, recomputing the whole layout, fitting the camera or moving any other module.
- Exposes transition busy state for accessibility and regression tests, distinguishing an intentional visual transition from a stalled map.

## 0.3.8 - 2026-08-13

- Removed the remaining automatic camera centering from ordinary node selection. Clicking a module now only highlights it and opens details; it never pans, zooms, filters or hides the rest of the graph.
- Renamed the ambiguous distance controls to **Project Overview**, **Full Module Map** and **File Details**, with a persistent explanation of what each view draws and how many declared nodes are represented.
- Replaced the easy-to-misread “focus neighborhood” action with explicit **Show Related Modules** terminology. Local view now displays a prominent banner, focus depth, and the exact number of hidden nodes.
- Added always-visible **Show Full Module Map** and **Exit Local View** recovery actions. Returning resets to the module map, closes stale details and explicitly fits every visible module.
- Switching view levels automatically exits local view so users cannot accidentally stack two filtering modes and lose track of where the other modules went.

## 0.3.7 - 2026-08-13

- Added a draggable horizontal splitter between the project map and Agent progress/output, allowing users to choose the height of both panes without changing graph content or node positions.
- Supports keyboard resizing with Arrow Up/Down and Home/End, double-click reset, visible hover/focus feedback, and accessible separator values.
- Persists the chosen Agent pane height per workspace and restores it when the map is reopened, with minimum and maximum sizes that prevent either pane from being squeezed away.
- Observes canvas container size changes and resizes Cytoscape without re-running layout or auto-fitting, so modules stay in place while panes are resized.

## 0.3.6 - 2026-08-13

- Added an explicit **Reinitialize** action for completed maps. After user confirmation, a controlled Agent re-reads the current repository and redraws the whole map while the previous map remains visible until completion.
- Reinitialization preserves stable IDs for responsibilities that still match, updates changed areas, and removes obsolete edges before obsolete nodes instead of blindly clearing or only appending to the map.
- Blocks reinitialization while another Agent run or ChangeSet is active, preventing duplicate single-writer sessions and the `CONCURRENT_CHANGE_SET` failure loop.
- Keeps reinitialization read-only for user source and reports its purpose and progress separately from first-map initialization.

## 0.3.5 - 2026-08-12

- Stabilized map exploration: selecting a node now updates its highlight and details without re-running layout or forcing a zoom change.
- Automatically fits the full graph on first render and explicit level/focus changes, tightened semantic lanes, localized relation labels, and improved edge readability.
- Changed the details sidebar into a closeable overlay so opening a node no longer resizes the graph canvas.
- Treats declared directory paths as Explorer targets instead of trying to open them as text files.
- Added `@/` to `src/` import validation and projected live L0/L1 validation results into the Webview, eliminating false drift warnings for common TypeScript aliases.
- Prevented semantic-lane coordinate collisions and cache-busted the standalone layout Worker across extension upgrades.
- Versioned persisted layout state so coordinates produced by older layout algorithms cannot override the corrected map after upgrade.
- Retries a brand-new Codex initialization session once when the selected model is temporarily at capacity, but only before any tool call or structured interaction so an active ChangeSet can never be duplicated.

## 0.3.2 - 2026-08-12

- Added active ChangeSet summaries to `get_map`, allowing Agents to identify an abandoned single-writer lease instead of repeatedly retrying `begin_change`.
- Updated initialization guidance to request explicit user confirmation before interrupting an existing ChangeSet.
- Preserved the Agent's structured final failure reason in the progress panel instead of misreporting every domain rejection as an authentication problem.

## 0.3.1 - 2026-08-12

- Added standard MCP safety annotations to every God View tool so non-interactive Codex runs can distinguish read-only map reads, non-destructive idempotent map writes and destructive removals.
- Fixed automatic Codex initialization cancelling `get_map` and `begin_change` before the request reached the Gateway.
- Verified the fix against Codex CLI 0.146.1 with real read and write-tool smoke calls.

## 0.3.0 - 2026-08-12

- Added green, checked Agent configuration cards with verified CLI, version, workspace and MCP status.
- Added one-click first-map initialization through a new Codex or Claude CLI subprocess, with bounded streaming output, cancellation and same-session resume after structured user choices.
- Restricted automatic initialization to repository reads and God View MCP calls; it cannot edit user source or run shell commands.
- Made completion depend on a structured final `get_map` result instead of CLI exit code alone, and prompt users to restart other already-open Agent sessions.
- Added extension-to-Gateway event acknowledgements so `accepted` now means the reducer actually accepted the event; reducer rejection and acknowledgement timeout are returned to the Agent.
- Made `begin_change` return the real `changeSetId` and instructed Agents never to invent one.
- Added unit, Chromium and real Extension Host coverage for Agent progress, choices, completion and reducer acknowledgement/rejection.

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

- Automatic execution starts a new CLI subprocess; it cannot hot-load, control or resume an unrelated Agent UI session that was already open.
- Automatic first-map initialization is read-only for user source, but manually opened Agent sessions remain `monitored`: God View detects out-of-scope Git changes but cannot sandbox those external processes.
- Agent-side cloud transfer, cost and retention follow the selected Agent's own policy.
- Remote SSH, WSL and Dev Container are beta compatibility targets and are not release-gated yet.
