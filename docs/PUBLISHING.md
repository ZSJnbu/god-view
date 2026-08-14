# Marketplace publishing handoff

The implementation and local VSIX are release-candidate ready. Public upload is deliberately gated on
repository and publisher ownership that code cannot choose on the owner's behalf.

## One-time owner setup

1. The primary source repository is `https://gitee.com/zsjfj/god_view.git`. Make the first reviewed
   commit there; do not tag uncommitted files. If GitHub Actions is used for release evidence, configure
   a GitHub mirror and keep tag SHAs identical instead of treating two diverging repositories as proof.
2. The confirmed VS Code Marketplace Publisher ID is `ZengShaoJie` (case-sensitive), and the extension
   manifest uses it. Reconfirm publisher ownership before rotating or replacing the publishing token.
3. The extension manifest uses the Gitee repository, homepage and issues URLs. Verify they remain
   public and reachable before Marketplace upload; the public release verifier fails if they are removed.
4. In the GitHub Actions mirror, create an Environment named `marketplace`, require a human reviewer, and store the
   Marketplace personal access token as the environment secret `VSCE_PAT`. Do not put the token in a
   repository secret, shell history, source file, issue or artifact.
5. Enable branch protection so CI and the release-candidate workflow are required before merging or
   tagging.

## Candidate and publish sequence

1. Push the reviewed commit and require green CI on Linux, Windows, macOS and VS Code 1.96.0.
2. Run `Release candidate` with `workflow_dispatch`. Inspect the VSIX and SHA-256 artifact.
3. Create the immutable version tag matching the manifest, for example `v0.3.36`; require the tag-run
   release workflow to pass as well.
4. In Actions, run `Publish to VS Code Marketplace` with that tag and type `publish` exactly.
5. Approve the protected `marketplace` environment only after comparing the artifact checksum and
   release evidence. The job rebuilds and reruns public gates before uploading the exact VSIX.
6. After upload, install the Marketplace version into a clean profile, open a disposable workspace,
   configure one Agent, restart it, call `get_map`, and record the listing URL and smoke result.

## Rollback

Marketplace versions are immutable. For a release defect, remove/deprecate the affected listing version
according to Marketplace owner policy and publish a higher patch version after the same gates. Keep the
previous VSIX and follow `UPGRADE_AND_ROLLBACK.md`; never overwrite map storage or user source files to
simulate an extension rollback.
