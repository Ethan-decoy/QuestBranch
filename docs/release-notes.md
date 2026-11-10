# QuestBranch v0.3.0-dev.7

简体中文 · English below

Windows、macOS、Linux 开发者预发布，非 Latest。项目采用 MIT；第三方组件保留各自许可。

## 这次更新

- 新增“设置 → 关于”：检测版本、下载进度、校验和按安装方式更新；侧栏版本号也可进入。
- Windows 安装版与可写的 Linux AppImage 提供“重启并更新”，安装后重新打开。研究、账号连接或资料迁移进行中会阻止重启；正常退出不自动安装。
- 升级至官方 SessionWeave `0.1.0-beta.3`。研究背景以稳定身份保存修订，不变的材料不重复追加，修订保留来源和历史。
- 首次写入新格式研究材料前备份研究库及已有本地凭据密钥；备份失败保留原始资料并停止升级。
- 清理过期的开发提示，统一中英文安装、更新、恢复与 FAQ 入口。研究导出仍为格式 3。

## 下载与升级

| 平台 | 附件 |
| --- | --- |
| Windows x64 | `QuestBranch-Setup-0.3.0-dev.7-x64.exe` 或 `QuestBranch-0.3.0-dev.7-windows-x64.zip` |
| macOS | `QuestBranch-0.3.0-dev.7-macos-arm64.dmg` / `QuestBranch-0.3.0-dev.7-macos-x64.dmg` |
| Linux x64 | `QuestBranch-0.3.0-dev.7-linux-amd64.deb` / `QuestBranch-0.3.0-dev.7-linux-x86_64.AppImage` |

核对 `SHA256SUMS.txt`。升级前正常退出并备份完整配置、研究目录及需要保留的外部智能体文件。**dev.6 及更早版本需手动安装本版一次。** Windows ZIP 使用顶层 `Start-QuestBranch.cmd` 隔离试用；其 `data/` 不自动合并到安装版。

ZIP／目录版、macOS DMG 和 DEB 使用手动升级。更新检查走系统代理，不消耗模型额度。自动研究备份位于研究目录 `backups/`；回退应使用升级前完整备份，重装旧程序不等于资料降级。

## 验证与限制

四个原生目标为 Windows x64、macOS 15 Apple Silicon／Intel、Ubuntu 24.04 x64。实际安装、资料重开、对话、双主题图谱、打包 OM SDK、许可与附件校验结果见 `VERIFICATION.json`。

Windows 更新交接使用公开 dev.6 的真实安装器和旧研究，由当前 SDK 驱动安装本版并重新打开；AppImage 检查真实旧映像的替换与重新启动。验收驱动不代表 dev.6 自带更新入口。Mac／DEB 覆盖新装、同版本重装、资料保留和移除，不声称已测历史原生包的全部升级路径。

Windows 未签名；Mac 为 ad-hoc 签名，尚无 Developer ID 或公证。Ubuntu 优先使用 DEB；AppImage 不依赖 FUSE2，系统限制用户命名空间时，上游启动器可能回退为 `--no-sandbox`。固定响应不代表全部真实账号、keyring 后端或长期研究质量均已验证。

[安装与恢复](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.7/docs/desktop-installation.md) · [第一次研究](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.7/docs/getting-started.md) · [FAQ](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.7/docs/faq.md) · [DSH 集成](https://github.com/Ethan-decoy/QuestBranch-DSH)

## English

This developer prerelease adds **Settings → About** for version checks and updates, and adopts the official SessionWeave `0.1.0-beta.3` package. It is not Latest. QB is MIT licensed; third-party licenses remain in force.

- Installed Windows editions and writable Linux AppImages can download, verify, install and reopen. Active research, account connection or data migration blocks restart. Normal exit does not install an update.
- Stable research-material identities avoid appending unchanged background repeatedly. Revisions preserve earlier material and provenance.
- Before writing new-format material, QB backs up the research database and any local credential key. A failed backup stops the upgrade. Research export remains format 3.
- Installation, recovery and FAQ pages now use the same bilingual entry names and remove outdated development notices.

Choose the Windows x64 installer/ZIP, the arm64 or x64 Mac DMG, or the Linux x64 DEB/AppImage. Verify `SHA256SUMS.txt`. **From dev.6 or earlier, install this version manually once.** Back up complete configuration, research and required external agent files first. Windows ZIP trials use `Start-QuestBranch.cmd` and separate `data/`.

Directory/ZIP editions, Mac DMGs and DEBs update manually. Checks use the system proxy and make no model requests. Automatic research backups are under the research directory's `backups/`; rolling back requires a compatible app and a complete pre-upgrade backup.

`VERIFICATION.json` records actual native installation, research/reopen, conversation, both graph themes, packaged OM SDK and byte checks. Windows uses a real released dev.6 predecessor and the current SDK to install/relaunch this version. AppImage checks replace a real predecessor image and relaunch the candidate. These are external acceptance drivers; dev.6 has no updater UI. Mac/DEB checks do not establish every historical upgrade path.

Windows is unsigned. Mac uses ad-hoc signing without Developer ID or notarization. Prefer DEB on Ubuntu; the FUSE2-free AppImage launcher may fall back to `--no-sandbox` when user namespaces are restricted. Local fixtures do not establish coverage of every real account, keyring backend or long-running research workload.

[Installation](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.7/docs/desktop-installation.en.md) · [First research](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.7/docs/getting-started.en.md) · [FAQ](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.7/docs/faq.en.md) · [DSH integration](https://github.com/Ethan-decoy/QuestBranch-DSH/blob/main/README.en.md)

反馈 / Feedback: [Issues](https://github.com/Ethan-decoy/QuestBranch/issues). Include version, OS, connection type and reproducible steps; remove credentials and private research.
