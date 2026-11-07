# QuestBranch v0.3.0-dev.6

简体中文 · English below

Windows、macOS、Linux 开发者预发布，非 Latest。项目采用 MIT；第三方组件保留各自许可。

## 这次更新

- 统一中英文 README、安装与升级、第一次研究、FAQ 和独立应用／DSH 入口。
- 初始研究空间有“示例”标记，首次可直接创建自己的研究。
- 空节点提供模型或智能体入口，以及可编辑的示例提问；只填入空草稿，不覆盖输入或自动发送。
- 明确连接能力和父节点报告要求。报告由 AI 工具保存在节点内，新方向等待你选择研究。
- 接收已评审的共享主干与回归，保留现有跨平台交付。运行依赖、固定 SessionWeave 快照及研究格式 3 不变。
- 增加延迟响应下的真实工具回归，对齐集成等待预算和原生成品的父报告提示检查。

## 下载与开始

- Windows x64：`QuestBranch-Setup-0.3.0-dev.6-x64.exe` 安装，或完整解压 `QuestBranch-0.3.0-dev.6-windows-x64.zip`，用顶层 `Start-QuestBranch.cmd` 隔离试用。
- macOS：Apple Silicon 选 `QuestBranch-0.3.0-dev.6-macos-arm64.dmg`，Intel 选 `QuestBranch-0.3.0-dev.6-macos-x64.dmg`，拖入“应用程序”。
- Linux x64：Ubuntu 优先用 `QuestBranch-0.3.0-dev.6-linux-amd64.deb`；便携版为 `QuestBranch-0.3.0-dev.6-linux-x86_64.AppImage`，赋予执行权限后运行。
- 先核对 `SHA256SUMS.txt`；`VERIFICATION.json` 记录接受的源码、成品和实际验收。安装、备份和恢复见 `README-TRIAL.md`。

打开示例或创建自己的根问题，连接模型／智能体，在节点中讨论。方向明确后，请 AI 保存阶段报告并建立待研究分支，再选一个方向继续。普通模型对话不会自动搜索网页，搜索和技能取决于连接的实际配置。

[第一次研究](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.6/docs/getting-started.md) · [FAQ](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.6/docs/faq.md) · [DSH 集成](https://github.com/Ethan-decoy/QuestBranch-DSH)

## 安装、升级与验证范围

升级前停止运行并正常退出 QB，备份研究和配置。安装版继续使用普通桌面配置和自选研究位置；ZIP 的独立 `data/` 不自动合并。跨配置或系统可导出研究 JSON 后导入，凭据和完整原生状态另行备份。卸载保留资料，重装旧程序不等于数据库降级。

四个原生目标为 Windows x64、macOS 15 Apple Silicon／Intel、Ubuntu 24.04 x64。安装后的研究、对话、双主题画布、实际打包 OM SDK 固定响应与成品输入一致性均由流程检查。macOS/Linux 另检查本地模型、代理、OAuth 和跨系统研究导入。Windows 使用公开 `.5` 安装器验证升级；Mac/Linux 覆盖新装、同版本重装、资料保留与移除，尚未验证历史原生包跨版本升级。最终结果以本版 `VERIFICATION.json` 为准。

Windows 未签名；Mac 使用 ad-hoc 签名，尚无 Developer ID 和 Apple 公证。Ubuntu 优先使用 DEB；AppImage 不依赖 FUSE2，用户命名空间受限时上游启动器可能回退为 `--no-sandbox`。未提供自动更新或热更新。固定响应验收不代表全部真实账号、keyring 后端、系统或长期研究均已验证。

反馈：[Issues](https://github.com/Ethan-decoy/QuestBranch/issues)。请提供版本、系统、连接方式和复现步骤，去掉凭据及私人研究。

## English

This developer prerelease updates the first-research experience and bilingual documentation. It is a prerelease, not Latest. QB is MIT-licensed; third-party components keep their own licenses.

### Changes

- Complete Chinese/English README, installation and upgrade instructions, first-research guides and FAQ, with reciprocal standalone/DSH entries.
- An Example marker identifies the starter workspace; first-time users can create their own research directly.
- Empty nodes offer the existing model/agent connection entry and an editable sample question. Suggestions fill only empty drafts, without overwriting or sending them.
- Connection capabilities and parent-report prerequisites are clearer. AI tools save reports under their nodes; child directions do not run automatically.
- Reviewed shared-main changes and regressions are integrated while retaining native packages. Runtime dependencies, the fixed SessionWeave archive and research format 3 are unchanged.
- Delayed-response tool regressions align integration-test wait budgets, and packaged prerequisite checks match the new parent-report hint.

### Download and start

Use the Windows x64 installer, or extract the complete Windows ZIP and launch its top-level `Start-QuestBranch.cmd` for isolated data. On Mac, select the arm64 DMG for Apple Silicon or x64 for Intel, then drag QB to Applications. On Linux x64, prefer the DEB on Ubuntu, or make the AppImage executable and run it. Application packages do not require Node.js or pnpm.

Verify `SHA256SUMS.txt`. `VERIFICATION.json` identifies the accepted source, native assets and actual checks. Open the example or create a root question, connect a model/agent and discuss it. Ask AI to save a stage report and agreed pending directions, then choose one to continue. Ordinary model chat does not automatically search the web; tools and skills depend on the connection's configuration.

[Installation](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.6/docs/desktop-installation.en.md) · [First research](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.6/docs/getting-started.en.md) · [FAQ](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.6/docs/faq.en.md) · [DSH integration](https://github.com/Ethan-decoy/QuestBranch-DSH/blob/main/README.en.md)

### Updates, checks and limitations

Stop work, quit and back up before updating. Installed apps retain their ordinary profile and chosen research location; portable ZIP data is separate. JSON moves research between configurations or systems, without credentials or complete native-session state. Removing an app preserves research but does not replace a backup; reinstalling an older app does not downgrade its database.

Native targets are Windows x64, both macOS 15 architectures and Ubuntu 24.04 x64. The workflow checks installed research, conversation, both canvas themes, packaged OM SDK fixtures and content integrity. Mac/Linux also exercise local model, proxy, OAuth and cross-system import fixtures. Windows upgrades from the actual published `.5` installer. Mac/Linux cover fresh installation, same-version reinstall, retention and removal; upgrades from earlier native packages are unverified. Use this release's `VERIFICATION.json` for the final evidence.

Windows is unsigned. Mac uses ad-hoc signing without Developer ID or notarization. Prefer the DEB on Ubuntu; the FUSE2-free AppImage launcher may fall back to `--no-sandbox` when user namespaces are restricted. Automatic/hot updates, all real accounts, keyring backends, other systems and long-running research are not validated.

Report versions, OS, connection type and steps through [Issues](https://github.com/Ethan-decoy/QuestBranch/issues), without credentials or private research.
