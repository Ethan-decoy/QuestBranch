# Start your first research

[简体中文](getting-started.md) · English

This guide is for the **standalone application**. For the DSH integration, use its [installation and usage instructions](https://github.com/Ethan-decoy/QuestBranch-DSH/blob/main/README.en.md): models, tools and native sessions are managed by the host.

## 1. Install and choose your workspace

Download the package matching your OS and CPU from [Releases](https://github.com/Ethan-decoy/QuestBranch/releases). No Node.js or pnpm is required for an application package. See [installation and upgrades](desktop-installation.en.md); Windows portable users should also read the [isolated trial guide](windows-trial.en.md).

Use the plus button beside **Projects** to create a named project. A default location is ready to use; choosing a folder is optional. If the folder already contains a QB project, choose **Open project** to reopen it. Then use the plus button on its project row to create research. Each project can hold multiple independent studies. The starter example remains available under the existing-research project.

Enter a root question and, optionally, a name and constraints. For example: “How should we choose an AI connection for a local-first research tool?”

## 2. Choose the connection your task needs

| Need                                   | Entry                        | What to expect                                                                                                              |
| -------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Use an account, API or custom service  | Models & connections → Model | Model conversations and QB research tools; ordinary chat does not automatically search the web.                             |
| Use an agent's search, tools or skills | Models & connections → Agent | Codex or a custom ACP backend; actual capabilities depend on the backend and its configuration.                             |
| Run a model on your device             | Model → Ollama               | Prepare Ollama and a model first, then check its address and model selection. Tool support and quality depend on the model. |

The model catalog does not guarantee that your account or plan can use every entry. Cloud provider charges and account access are separate from QB's MIT license. Connecting an account does not import tools or plugins from another client.

For Codex, choose **Agent → Codex → Connect**, follow the backend's login flow, choose its actual model and reasoning options, then use that agent. Its credentials are managed separately from the direct-model account login.

For direct models, select an account or API provider and connect. API services require their own credentials; a custom service also needs its protocol and endpoint. Save the selection before returning to your node. Without a model, you can still organize, read, import and export research.

## 3. Discuss, then save a plan and branches

The input always sends a conversation message to the selected node, including when you are reading its report or sources. Enter sends by default, Shift+Enter adds a line, and confirming an IME composition does not send. Change the shortcut in **Settings → Shortcuts**.

You can start with this editable request:

> Clarify the goal and constraints of this question, then propose independent research directions. Save the plan as a stage report and create the pending branches. Do not start researching the child branches yet.

The empty-chat suggestion fills a draft; it does not send or start work. Edit it to match your intent and send when ready. A model or agent saves the report and agreed directions through QB tools; there is no separate “generate report” step or button to find.

Reports remain material stored under a node, rather than tasks to complete. Original messages and earlier report versions remain available. The new branches wait for your selection instead of running automatically.

## 4. Continue one direction and compare findings

Select a node on the map or in the sidebar. Read its report and sources, or open Chat and ask a follow-up. The composer remains visible; long drafts scroll inside it. The model and effort controls apply to the next message and show only options the connection actually supplies.

Manual **New direction** needs a report belonging to the current parent node. Ask AI to save the current discussion first, or use the combined save-report-and-directions request above. An ancestor's report can be background material, but cannot replace the current parent's source report.

Each branch retains the report version from which it was created. A newer parent report does not silently replace that reference. Use the source link to return to the exact version. Horizontal and mind-map views preserve their own camera and manual positions; changing the view does not change research relationships.

Once two nodes have reports, open **Compare branches**. Choose the specific versions and common comparison dimensions. Synthesis is saved under direction A's node; the window shows the ownership. The model should distinguish agreement, conflict, conditions and unknowns. If the selected materials exceed the budget, adjust the budget or instruction and retry; QB does not silently omit a selected report.

## 5. Stop, reopen and back up

During a run, the send position becomes a stop control. Stopping retains text already received and research operations that succeeded. Public tool activity is shown in the conversation; native permissions are answered on the agent's request card. Tool completion is not independent verification of a research claim.

Quit normally and reopen the same application/profile and research location. Check that the question, branches, conversation, reports, sources and history remain. Export a space as JSON when you need a portable research copy.

Desktop navigation has two levels: **Project → Research**. Each project folder contains one `.questbranch/research.sqlite` holding all its studies, research navigation preferences and QB-managed session state. Projects can start empty. The default location is under `projects/` in the original research directory. Existing files in a chosen folder remain in place; QB manages its own `.questbranch/` directory.

Right-click a project or study, or use its `⋯` button, to rename or pin it. Drag above or below another item to reorder, then release to save. Studies stay within their project; pinned projects and ordinary projects sort within their own group. Alt+↑/↓ provides a keyboard alternative. Renaming changes the display name without changing the folder or root question. Switching studies restores the selected node, canvas, report reading position and draft. Under **Archived research → study name** in its project's menu, open read-only, export or restore an archived study. Reading and exporting preserve its archived state; editing and sending messages require restoring it. Closing a project retains its files; use the plus button and select its existing folder to reopen it.

In **Settings → Local storage**, **Move this project** copies and checks all research, drafts, QB-managed session state and existing recovery archives in the current project, then switches without restarting. The source remains as a backup. Other files in the folder and external agents' native files are not moved. **Move to project** in a study's menu transfers only that study, preserving its identity and continuity. Finish active conversations and connections in the affected projects first.

The project's recovery backup directory and its descendants cannot be relocation targets. QB checks real paths when choosing a folder and again before migration, rejecting overlap while retaining the original project.

Older single-study folders upgrade on opening while retaining their identities and session state. A snapshot is retained in `backups/` beside the database before its first schema upgrade. The legacy shared library appears as one existing-research project and is not split by topic automatically. Move it as a whole or transfer individual studies from their menu. Do not write to an upgraded database using an older app.

The application profile's `application.sqlite` holds the folder index, global model settings and encrypted credentials; current credentials stay out of active project databases. Historical recovery archives in `.questbranch/backups/` may include earlier encrypted settings and their old keys. Relocation preserves their original bytes; protect them as complete local backups. They do not replace current global account settings. Copy the complete project folder to retain research and QB session state, then reconnect models on another machine. Native sessions, accounts and files owned by external agents require their own backup; copying a QB folder does not guarantee external-session continuity. A missing folder stays marked as unavailable until you reopen its correct location. QB does not silently write to an older copy.

`storage-location.json` and `QUESTBRANCH_DATA_DIR` still select the legacy shared library and the parent of default project folders. The environment variable takes precedence. Browser preview retains a single research database, defaults to `.questbranch/research.sqlite` in the working directory, and has no native folder picker.

JSON export includes research nodes, messages, reports, sources, run records, revisions and views. It does **not** contain model credentials, external agent work files or complete native-session state. SQLite uses schema 4; research JSON remains format 3 and can import formats 1 and 2. Import restores into the current project and rejects an already-registered study or conflicting record IDs. Use **Move to project** to reorganize existing research; use an isolated application profile and data directory to test a separate restore. The file limit is 64 MB. A full backup must also retain configuration, credentials and external agent state as appropriate. Reinstalling an older app is not a database downgrade.

Do not run two instances against one research directory. If a selected disk is unavailable, reconnect it or restore the path before reopening.

## Connection details and recovery

- Direct account connections use OM working memory by default. API connections check native compaction capabilities; OM can also be selected explicitly under More settings. An unknown capability or connection failure is reported instead of silently switching strategy.
- ACP uses the selected project folder as its default working directory; legacy libraries retain `agent-workspace`. An explicitly configured working directory takes precedence. QB retains its conversation and native-session bindings with the project, but hidden history and files owned by another client follow that backend's storage rules and are not included in research JSON or database relocation.
- Ordinary model chat does not automatically retrieve web pages. An optional Tavily key can supply public web material for report generation. ACP search and skills depend on the configured backend; use the actual activity record to see what ran.
- If you close an OAuth page, use Continue authorization, Reconnect or Cancel in QB. Esc or closing the model panel cancels an unfinished wait without logging out an already connected account.
- Desktop model networking follows the system proxy; loopback model services, callbacks and research MCP stay local. The browser-preview server uses its process proxy environment. ACP backends follow their own network configuration.
- Desktop credentials use safeStorage when available; support depends on the OS credential backend. Research stays local, but cloud models and external tools receive the material needed for their configured requests.
- Connection diagnostics are in `logs/network.log` under the desktop user-data directory, or the preview research directory. Logs rotate and omit keys, authorization codes and research text. Remove private details before sharing.

Change the interface language under **Settings → General → Interface language**. Research content and existing drafts remain in their original language. See [FAQ](faq.en.md) for common questions and [Issues](https://github.com/Ethan-decoy/QuestBranch/issues) for feedback.
