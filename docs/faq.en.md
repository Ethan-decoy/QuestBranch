# Frequently asked questions

[简体中文](faq.md) · English

## How is QB different from ordinary AI chat or a mind map?

Each node is a research topic with its own conversation, reports, sources and report versions. The map shows relationships and progress. Continue a direction or compare specific report versions while keeping the original trail. A report is material stored under a node, rather than a task you must complete.

## Should I use the standalone app or the DSH integration?

The [standalone app](https://github.com/Ethan-decoy/QuestBranch) has its own model and ACP connections. The [DSH integration](https://github.com/Ethan-decoy/QuestBranch-DSH) runs inside DeepSeek Harness and uses the host's models, tools and native sessions. They are two ways to use the same research workspace. Follow each edition's installation, support and storage instructions; never have both write directly to one research database at the same time.

## Do I need a QB account or a paid model service?

The single-user app does not require a QB account. Reading and organizing research does not require a model. For AI conversations, bring a supported account, API, local model or ACP backend. QB's MIT license does not include a provider's paid service or guarantee access to models listed in a catalog.

## Does it automatically search the web?

Ordinary direct-model chat does not automatically search. An optional Tavily key can supply web material for report generation, or you can use an ACP agent configured with the required search tools. An account login alone does not establish web access. Check the actual activity record for tools that ran.

## How do I save a report and create branches?

Ask in the current node's chat: “Save a stage report and create the pending directions we just agreed on.” AI uses QB tools to save the report and branches while preserving earlier messages and report versions. A report-only request need not create branches. Child research does not start automatically. The empty-chat suggestion fills an editable draft; you decide when to send.

## Why is New direction unavailable?

Manual branch creation needs a source report belonging to the current parent node. Ask AI to save that node's discussion first, or to save a research plan and its directions together. An ancestor's report can be background material but is not the current parent's report. Comparing branches needs reports in at least two nodes.

## How do I start my own research?

The example workspace demonstrates the map, reports and sources. Use Create your own research or the plus button beside Workspaces to start a separate space; the example remains available. You can also discuss its questions. Its imported project material is not a result from your own research.

## Does local-first mean no data leaves my computer?

The research database is local. Cloud models and external tools receive relevant material for the requests you configure. Tools used with a local model may also make network requests. Credentials are separate from research JSON, and credential encryption depends on the actual OS backend and configuration.

## Where is research stored, and how do I move it?

Inspect the actual path in Settings → Local storage. The standalone desktop app can copy and check the database into an empty directory, then restart; the source is retained as a backup. Research JSON moves reports, conversations and sources across systems, but omits credentials, complete native state and external work files. See the [usage guide](getting-started.en.md) for full backups. DSH has its own storage and session-backup instructions.

## Does stopping or closing the app undo completed work?

Saved content and successful research operations remain. Stop is not a rollback. Quit normally and reopen the same research location to continue. Keep a backup before upgrading; launching an older program is not a safe downgrade of a database already written by a newer one.

## Which platforms and providers have been verified?

Published desktop packages cover Windows x64, both macOS 15 architectures, and Ubuntu 24.04 x64. Windows is unsigned; Mac packages have no Developer ID or notarization. Other OS versions and ARM Linux are not covered. Packaged model, OAuth and agent checks use isolated fixed responses, rather than verifying every real provider or long-running research. See the actual [release assets](https://github.com/Ethan-decoy/QuestBranch/releases) and `VERIFICATION.json`.

See [installation](desktop-installation.en.md) and [your first research](getting-started.en.md). To report a problem, include the version, OS/CPU, connection type, steps and expected/actual result in [Issues](https://github.com/Ethan-decoy/QuestBranch/issues). Remove keys, authorization codes and private research first.
