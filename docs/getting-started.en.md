# Start your first research

[简体中文](getting-started.md) · English

This guide is for the **standalone application**. For the DSH integration, use its [getting-started guide](https://github.com/Ethan-decoy/QuestBranch-DSH/blob/main/docs/getting-started.en.md): models, tools and native sessions are managed by the host.

## 1. Install and choose your workspace

Download the package matching your OS and CPU from [Releases](https://github.com/Ethan-decoy/QuestBranch/releases). No Node.js or pnpm is required for an application package. See [installation and upgrades](desktop-installation.en.md); Windows portable users should also read the [isolated trial guide](windows-trial.en.md).

The starter workspace contains example research and imported project material. You can read it without connecting a model. Use **Create your own research** or the plus button beside Workspaces to create a space for your own question; the example remains available.

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

In **Settings → Local storage**, inspect the actual research path. Desktop relocation copies and checks the database before switching locations and restarting, with the source retained as a backup. Stop active work first and choose an empty destination. `QUESTBRANCH_DATA_DIR` overrides the saved choice; a portable Windows launch script uses this override.

JSON export includes research nodes, messages, reports, sources, run records, revisions and views. It does **not** contain model credentials, external agent work files or complete native-session state. The current format is 3 and can import formats 1 and 2. Import creates a separate space rather than overwriting one already present; the file limit is 64 MB. A full backup must also retain configuration, credentials and external agent state as appropriate. Reinstalling an older app is not a database downgrade.

Do not run two instances against one research directory. If a selected disk is unavailable, reconnect it or restore the path before reopening.

## Connection details and recovery

- Direct account connections use OM working memory by default. API connections check native compaction capabilities; OM can also be selected explicitly under More settings. An unknown capability or connection failure is reported instead of silently switching strategy.
- Native ACP runs currently start a new native session with the branch material QB selected. Hidden conversation history in another client is not automatically restored. The default agent working directory is `agent-workspace` under the research directory; it is not included in research JSON or database relocation.
- Ordinary model chat does not automatically retrieve web pages. An optional Tavily key can supply public web material for report generation. ACP search and skills depend on the configured backend; use the actual activity record to see what ran.
- If you close an OAuth page, use Continue authorization, Reconnect or Cancel in QB. Esc or closing the model panel cancels an unfinished wait without logging out an already connected account.
- Desktop model networking follows the system proxy; loopback model services, callbacks and research MCP stay local. The browser-preview server uses its process proxy environment. ACP backends follow their own network configuration.
- Desktop credentials use safeStorage when available; support depends on the OS credential backend. Research stays local, but cloud models and external tools receive the material needed for their configured requests.
- Connection diagnostics are in `logs/network.log` under the desktop user-data directory, or the preview research directory. Logs rotate and omit keys, authorization codes and research text. Remove private details before sharing.

Change the interface language under **Settings → General → Interface language**. Research content and existing drafts remain in their original language. See [FAQ](faq.en.md) for common questions and [Issues](https://github.com/Ethan-decoy/QuestBranch/issues) for feedback.
