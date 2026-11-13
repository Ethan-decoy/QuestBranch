# QuestBranch v0.3.0-dev.9

简体中文 · English below

项目与多研究管理开发者预发布。MIT；第三方组件保留各自许可。

## 这次更新

- 桌面侧栏采用“项目 → 研究”。项目可以从空文件夹开始，也能打开已有项目；项目和研究支持改名、固定与直接拖拽排序。
- 一个项目文件夹保存多项研究、阅读现场、草稿以及 QB 管理的会话状态。切换研究时恢复各自的节点、画布和阅读位置，后台回复仍归属原研究。
- 项目可以整体迁移，无需重启；单项研究也能跨项目移动，保留原始记录与会话身份，并支持中断后的转移恢复。
- 归档研究可从项目菜单只读打开、导出或恢复。阅读和导出不解除归档，恢复前不能修改或发送对话。
- 整体迁移保留历史恢复档案并逐文件校验，拒绝符号链接、目录联接及源备份树中的目标，失败保留来源。
- 研究 JSON 仍为格式 3；项目 SQLite 升级至 schema 4，旧库升级前保留恢复副本。固定 SessionWeave `0.1.0-beta.3`、材料会话 v4 和运行依赖不变。

## 下载、升级与恢复

| 系统 | 附件 |
| --- | --- |
| Windows x64 | `QuestBranch-Setup-0.3.0-dev.9-x64.exe` 或 `QuestBranch-0.3.0-dev.9-windows-x64.zip` |
| macOS | `QuestBranch-0.3.0-dev.9-macos-arm64.dmg` / `QuestBranch-0.3.0-dev.9-macos-x64.dmg` |
| Linux x64 | `QuestBranch-0.3.0-dev.9-linux-amd64.deb` / `QuestBranch-0.3.0-dev.9-linux-x86_64.AppImage` |

核对 `SHA256SUMS.txt` 后安装。升级前正常退出，备份完整应用配置、项目文件夹和需要保留的外部智能体资料。旧共享研究库作为“已有研究”项目保留，旧单研究文件夹打开时升级；请勿用旧应用写入升级后的库。回退需要兼容应用和完整的升级前备份。

全局账号配置仍在应用配置目录，当前凭据不复制进项目研究库；历史恢复档案可能含旧加密设置及旧密钥，应按完整本机备份保管。项目目录复制可保留 QB 管理的会话状态，外部智能体的原生文件与账号另行备份。

Windows 安装版和 dev.8 起的可写 AppImage 可使用“设置 → 关于”下载并重启更新。dev.7 及更早 AppImage、dev.6 及更早 Windows 安装版应手动安装当前版本一次；ZIP、DMG 和 DEB 手动更新。ZIP 使用顶层 `Start-QuestBranch.cmd` 隔离试用。

本版验证并发布后，清理 dev.9 之前的旧安装附件及更新文件，保留源码标签、版本说明与历史验收记录；旧 Release 将注明新版下载入口。

## 验证与限制

`VERIFICATION.json` 记录本版四个原生目标的实际成品检查，包括安装、研究重开、对话、双主题图谱、打包 OM SDK、项目导航／拖放／归档／迁移，以及 Windows 和 AppImage 的升级。前版为验收时仍可下载的最新已发布低版本；Mac／DEB 继续验证安装、同版本重装、资料保留和移除。

Windows 未签名；Mac 使用 ad-hoc 签名，尚无 Developer ID 和公证。Ubuntu 优先使用 DEB；AppImage 无需 FUSE2，系统限制用户命名空间时，上游启动器可能回退为 `--no-sandbox`。测试使用隔离固定响应和本地协议夹具，真实厂商模型调用为 0，不代表全部账号、系统凭据后端或长期研究质量均已验证。

[安装](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.9/docs/desktop-installation.md) · [第一次研究](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.9/docs/getting-started.md) · [FAQ](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.9/docs/faq.md) · [DSH 集成](https://github.com/Ethan-decoy/QuestBranch-DSH)

## English

This developer prerelease introduces project folders and multiple studies per project. QB is MIT licensed; third-party licenses are retained.

- Desktop navigation is Project → Research. Create or open projects, rename and pin items, and drag them to reorder. A project can start empty.
- Studies retain their own selected node, canvas, reading position and drafts. Background replies stay with their originating study. QB-managed session state is stored with the project.
- Relocate a whole project without restarting, or transfer one study while preserving its identity and records. Interrupted transfers have durable recovery.
- Archived studies can be opened read-only, exported or restored from the project menu. Reading and exporting preserve the archived state.
- Relocation verifies historical recovery archives byte for byte, rejects links and destinations inside its own backup tree, and preserves the source on failure.
- Research JSON remains format 3. Project SQLite upgrades to schema 4 with a pre-upgrade backup. SessionWeave stays pinned to `0.1.0-beta.3`, material sessions remain v4, and runtime dependencies are unchanged.

Choose the Windows x64 installer/ZIP, the appropriate Mac DMG, or Linux x64 DEB/AppImage, then check `SHA256SUMS.txt`. Quit normally and back up application configuration, project folders and required external-agent files before upgrading. Older shared libraries remain available as an existing-research project; older single-study folders upgrade on opening. Do not write upgraded databases with older apps. Rollback requires the complete compatible pre-upgrade backup.

Current global credentials remain in the application profile. Historical recovery archives can include old encrypted settings and keys; protect them as complete local backups. Copying projects preserves QB-managed sessions, while external agents' native data and accounts need separate backups.

Windows installers and writable AppImages from dev.8 onward support download and restart through Settings → About. Earlier AppImages and Windows dev.6 or earlier require one manual installation of the current release. ZIP, DMG and DEB updates remain manual. ZIP trials use the top-level `Start-QuestBranch.cmd`.

After this release is verified and published, installer assets and update feeds older than dev.9 are retired. Source tags, release records and historical verification remain, with a replacement-download notice on previous releases.

`VERIFICATION.json` identifies the accepted native packages and actual checks, including 22 project-navigation, drag, archive and relocation cases on each installed platform. Windows and AppImage upgrade checks use the latest lower published version with downloadable packages. Mac/DEB cover installation, same-version reinstall, data retention and removal.

Windows is unsigned; Mac uses ad-hoc signing without Developer ID or notarization. Prefer DEB on Ubuntu; the FUSE2-free AppImage launcher may fall back to `--no-sandbox` when user namespaces are restricted. Isolated fixtures and local protocols make zero real model requests and do not establish coverage of every account, keyring backend or long-running research workload.

[Installation](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.9/docs/desktop-installation.en.md) · [First research](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.9/docs/getting-started.en.md) · [FAQ](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.9/docs/faq.en.md) · [DSH integration](https://github.com/Ethan-decoy/QuestBranch-DSH/blob/main/README.en.md)

反馈 / Feedback: [Issues](https://github.com/Ethan-decoy/QuestBranch/issues). Include version, OS, connection type and reproducible steps; remove credentials and private research.
