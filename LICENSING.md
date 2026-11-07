# Licensing

QuestBranch is available under the [MIT License](LICENSE), copyright (c) 2026 Ethan-decoy. This grant also covers the project-authored source in this repository's existing Git history and previously distributed QuestBranch versions, including v0.3.0-dev.2. Third-party components retain their own licenses.

## Fixed SessionWeave snapshot

On 2026-11-05, the owner authorized MIT licensing and public redistribution of the exact SessionWeave snapshot bundled with QuestBranch, including the snapshot already present in v0.3.0-dev.2 and repository history.

- Source commit: `79a076ecdf6d45208762556c609046156444ea4c`.
- Archive: `vendor/sessionweave-79a076e.tgz`.
- SHA-256: `8cc6c9e34aabd060b6147f0c76aee004c8c50b8e89ba3f62a42902aa84667d07`.
- Applicable license: [MIT](licenses/sessionweave.LICENSE). Provenance: [vendor/sessionweave-source.json](vendor/sessionweave-source.json).
- Public upstream: [Ethan-decoy/session_weave](https://github.com/Ethan-decoy/session_weave).

The historical archive and its package metadata remain unchanged. Its embedded `UNLICENSED` declaration describes the state before this grant; the supplemental MIT license above applies to this exact snapshot. Existing published tags and binary attachments have not been replaced.

## Third-party components

[THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt) preserves the installed production inventory, original notices and explicit supplemental license evidence. Electron's accompanying `LICENSE.electron.txt` and `LICENSES.chromium.html` must remain with the application.

Binary packages preserve the project license, this licensing guide, third-party notices, the `licenses/` directory and SessionWeave provenance in the platform resources directory: `QuestBranch.app/Contents/Resources/` on macOS and `resources/` on Windows/Linux. This keeps data files in the standard macOS bundle resource location; their contents are checked against the build inputs.

Three packages declare MIT in their original package manifests but provide no separate license or copyright file: `@standard-community/standard-json@0.3.7`, `@standard-community/standard-openapi@0.2.11`, and `proxy-agent-negotiate@1.1.0`. Their original declarations are preserved under `licenses/`, together with the standard MIT terms. Those entries identify this evidence and do not claim that an upstream copyright notice was found.
