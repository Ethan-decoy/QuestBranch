# QuestBranch v0.3.0-dev.5

Windows、macOS、Linux 开发者预发布，非 Latest。项目采用 MIT；第三方组件保留各自许可。

## 下载

- `QuestBranch-Setup-0.3.0-dev.5-x64.exe`：Windows x64 当前用户安装程序。
- `QuestBranch-0.3.0-dev.5-windows-x64.zip`：Windows 完整免安装包，解压后用 `Start-QuestBranch.cmd` 隔离试用。
- `QuestBranch-0.3.0-dev.5-macos-arm64.dmg` / `macos-x64.dmg`：分别用于 Apple Silicon / Intel，拖入“应用程序”安装。
- `QuestBranch-0.3.0-dev.5-linux-amd64.deb` / `linux-x86_64.AppImage`：Linux x64 安装与便携包，Ubuntu 优先使用 DEB。
- `SHA256SUMS.txt`：全部附件的 SHA-256；`VERIFICATION.json`：公开构建提交、实际成品与验收结果。
- `README-TRIAL.md`：资料位置、安装、升级和恢复说明。

安装或升级前请正常退出 QB 并备份研究。安装版保留普通桌面资料与自选研究位置；旧 ZIP 的独立 `data/` 不自动合并，迁移到安装版时先导出研究 JSON，再在新版导入。卸载保留资料，不能替代备份。

## 修复与变化

- 补齐 macOS 和 Linux 的原生成品及验收，沿用同一研究核心和界面。
- 各平台按实际依赖生成许可，检查内置智能体二进制、编译内容及实际 OM SDK。
- 使用 Windows `.4` 的合成研究验证跨系统导入、原文与来源保留；依赖版本、固定 SessionWeave 快照及数据格式 3 不变。

## 验证范围

四个原生目标：Windows x64、macOS 15 Apple Silicon、macOS 15 Intel、Ubuntu 24.04 x64。验证安装后的研究闭环、14 项对话、15 项 ACP/MCP、亮/深各 12 项画布、实际 OM SDK 固定响应及成品与构建输入的一致性。macOS/Linux 另执行模型、代理和 OAuth 的本地固定响应，以及 Windows 研究导入与重开。

Windows 从已发布 `.4` 安装器升级；macOS/Linux 是首次原生成品，验证新装、同版本重装和移除应用后资料保留。AppImage 验证实际启动器的研究与重开。版本、架构与结果以 `VERIFICATION.json` 为准。

## 限制与反馈

Windows 未签名；macOS 的 ad-hoc 签名已验证，尚无 Developer ID 和 Apple 公证，首次打开可能需在系统设置允许。未提供自动更新与热更新。模型、授权与智能体使用本地固定响应，没有调用真实账号，不代表所有厂商、keyring 后端、桌面环境或长时间研究均已验证。

Linux 首轮覆盖 Ubuntu 24.04 x64；DEB 复用系统 sandbox/AppArmor 集成。AppImage 的 FUSE2-free 启动器按用户命名空间能力选择 sandbox，受限系统可能回退 `--no-sandbox`。请阅读 `README-TRIAL.md` 的平台条件与安装方式。

反馈入口：[Issues](https://github.com/Ethan-decoy/QuestBranch/issues)。请提供版本、系统、连接方式和步骤，并移除凭据及私人研究内容。

## English

This developer prerelease adds native Apple Silicon / Intel macOS DMGs and Linux x64 DEB / AppImage packages alongside the Windows installer and isolated ZIP. Verify `SHA256SUMS.txt`; `VERIFICATION.json` identifies the accepted source and four native targets. Windows upgrades from the published `.4` installer. First-time macOS/Linux packages are tested for installation, reinstall, research retention and removal, including import/reopen of Windows-produced synthetic research.

Acceptance includes research, conversation, both canvas themes, real packaged OM SDK fixtures and native agent version checks. macOS/Linux additionally exercise local model, proxy and OAuth fixtures. Accepted binaries are uploaded, downloaded and hash-checked before publication. Runtime dependencies and research format 3 remain unchanged.

Windows is unsigned; macOS has verified ad-hoc signatures without Developer ID or notarization. Linux is tested on Ubuntu 24.04 x64; prefer the DEB there. The FUSE2-free AppImage launcher may fall back to `--no-sandbox` if user namespaces are unavailable. Other OS versions, distributions, keyring backends, real-provider coverage, long-running research and automatic updates are not validated.
