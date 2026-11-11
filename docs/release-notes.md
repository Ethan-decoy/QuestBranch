# QuestBranch v0.3.0-dev.8

简体中文 · English below

Windows、macOS、Linux 开发者预发布，非 Latest。项目采用 MIT；第三方组件保留各自许可。

## 这次更新

- AppImage 在目标文件系统暂存并校验新映像，再原子替换。替换失败时保留当前文件并允许重试，成功后通过原路径重启。
- ACP 重建按失败运行定位原连接，保留其他连接的绑定。桌面与浏览器预览均可在研究记录中重建，再继续对话。
- 原始请求与本地关联 ID 分开记录，保留旧历史及 DSH 请求结构。原生响应未完成、无效压缩及退出中断均保存实际状态与已知用量。
- 发行装配逐项核对六个交付包与对应平台验收记录，阻止漏记、错配及字节变更。
- 继续使用固定的 SessionWeave `0.1.0-beta.3`、材料会话 v4 与研究导出格式 3。

## 下载与升级

| 平台        | 附件                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------- |
| Windows x64 | `QuestBranch-Setup-0.3.0-dev.8-x64.exe` 或 `QuestBranch-0.3.0-dev.8-windows-x64.zip`        |
| macOS       | `QuestBranch-0.3.0-dev.8-macos-arm64.dmg` / `QuestBranch-0.3.0-dev.8-macos-x64.dmg`         |
| Linux x64   | `QuestBranch-0.3.0-dev.8-linux-amd64.deb` / `QuestBranch-0.3.0-dev.8-linux-x86_64.AppImage` |

核对 `SHA256SUMS.txt`。升级前正常退出并备份完整配置、研究目录及需要保留的外部智能体文件。**dev.7 及更早的 AppImage 请手动下载本版一次**，此后使用修复后的内置更新。Windows dev.6 及更早版本也需手动安装一次。Windows ZIP 使用顶层 `Start-QuestBranch.cmd` 隔离试用，其 `data/` 单独保存。

ZIP／目录版、macOS DMG 和 DEB 使用手动升级。更新检查走系统代理，不消耗模型额度。自动研究备份位于研究目录 `backups/`；回退应使用升级前完整备份，重装旧程序不等于资料降级。

## 验证与限制

四个原生目标为 Windows x64、macOS 15 Apple Silicon／Intel、Ubuntu 24.04 x64。实际安装、资料重开、对话、双主题图谱、打包 OM SDK、许可与附件校验结果见 `VERIFICATION.json`。

Windows 使用公开 dev.7 的真实安装器和旧研究验证升级及重开。Linux 直接加载本版安装包中的安全更新器，对公开 dev.7 AppImage 注入替换失败，检查旧包与研究可重开，再用同一更新器重试，并检查新窗口使用的程序字节和研究库。Mac／DEB 覆盖新装、同版本重装、资料保留和移除，历史原生包的其他升级路径继续按实际记录判断。

Windows 未签名；Mac 为 ad-hoc 签名，尚无 Developer ID 或公证。Ubuntu 优先使用 DEB；AppImage 不依赖 FUSE2，系统限制用户命名空间时，上游启动器可能回退为 `--no-sandbox`。固定响应不代表全部真实账号、keyring 后端或长期研究质量均已验证。

[安装与恢复](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.8/docs/desktop-installation.md) · [第一次研究](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.8/docs/getting-started.md) · [FAQ](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.8/docs/faq.md) · [DSH 集成](https://github.com/Ethan-decoy/QuestBranch-DSH)

## English

This developer prerelease fixes AppImage replacement, ACP session recovery in desktop and browser preview, and diagnostic records. It is marked as a prerelease. QB is MIT licensed, with third-party licenses retained.

- AppImages stage and verify the downloaded image on the destination filesystem before atomic replacement. A failed replacement preserves the current executable and supports retry.
- ACP recovery targets the connection captured by the failed run. Both desktop and browser preview can rebuild and continue while preserving research history.
- Developer diagnostics retain actual request parameters separately from local correlation IDs, and preserve incomplete, failed and interrupted call states with known usage.
- Release assembly requires each platform's complete accepted package list and verifies its hashes.
- SessionWeave remains pinned to `0.1.0-beta.3`, with material-session format v4 and research export format 3.

Choose the Windows x64 installer/ZIP, the arm64 or x64 Mac DMG, or the Linux x64 DEB/AppImage. Verify `SHA256SUMS.txt`. **AppImage users on dev.7 or earlier should download this version manually once**, then use the repaired built-in updater. Windows dev.6 or earlier also requires one manual installation. Back up complete configuration, research and required external agent files first. Windows ZIP trials use `Start-QuestBranch.cmd` and separate `data/`.

Directory/ZIP editions, Mac DMGs and DEBs update manually. Checks use the system proxy and make no model requests. Automatic research backups are under the research directory's `backups/`; rolling back requires a compatible app and a complete pre-upgrade backup.

`VERIFICATION.json` records actual native installation, research/reopen, conversation, both graph themes, packaged OM SDK and byte checks. Windows upgrades a real released dev.7 installation. Linux exercises the updater loaded from this package against a released dev.7 AppImage, injects a failed replacement, reopens the original application and research, retries with the same updater, and checks the relaunched candidate's bytes and open database. Mac/DEB checks cover the documented installation paths.

Windows is unsigned. Mac uses ad-hoc signing without Developer ID or notarization. Prefer DEB on Ubuntu; the FUSE2-free AppImage launcher may fall back to `--no-sandbox` when user namespaces are restricted. Local fixtures do not establish coverage of every real account, keyring backend or long-running research workload.

[Installation](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.8/docs/desktop-installation.en.md) · [First research](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.8/docs/getting-started.en.md) · [FAQ](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.8/docs/faq.en.md) · [DSH integration](https://github.com/Ethan-decoy/QuestBranch-DSH/blob/main/README.en.md)

反馈 / Feedback: [Issues](https://github.com/Ethan-decoy/QuestBranch/issues). Include version, OS, connection type and reproducible steps; remove credentials and private research.
