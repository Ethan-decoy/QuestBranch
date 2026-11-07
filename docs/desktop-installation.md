# 安装、试用与升级 / Installation

从 [Releases](https://github.com/Ethan-decoy/QuestBranch/releases) 下载与你的系统及处理器匹配的附件，并核对 `SHA256SUMS.txt`。无需安装 Node.js。各版本提供的平台以实际附件和 `VERIFICATION.json` 为准。

| 系统 | 附件 | 使用方式 |
| --- | --- | --- |
| Windows x64 | `QuestBranch-Setup-…-x64.exe` | 运行安装程序，支持当前用户安装和选择程序目录。 |
| Windows x64 | `QuestBranch-…-windows-x64.zip` | 完整解压，双击顶层 `Start-QuestBranch.cmd` 隔离试用。 |
| macOS Apple Silicon | `QuestBranch-…-macos-arm64.dmg` | 打开磁盘映像，将 QuestBranch 拖入“应用程序”。 |
| macOS Intel | `QuestBranch-…-macos-x64.dmg` | 与 Apple Silicon 安装方式相同，选择 x64 附件。 |
| Ubuntu / Debian x64 | `QuestBranch-…-linux-amd64.deb` | 用系统软件安装器或 `sudo apt install ./文件名.deb` 安装。 |
| Linux x64 便携版 | `QuestBranch-…-linux-x86_64.AppImage` | 赋予执行权限后运行：`chmod +x 文件名.AppImage`，再 `./文件名.AppImage`。 |

首轮 macOS 成品在 macOS 15 的两种原生架构验收；Linux 成品在 Ubuntu 24.04 x64 验收。其他系统版本、发行版、桌面环境和 ARM Linux 尚未覆盖。

## 系统提示

Windows 安装程序未签名。macOS 使用 ad-hoc 签名并校验包内完整性，尚无 Developer ID 或 Apple 公证，系统可能阻止首次打开；请按“系统设置 → 隐私与安全性”中针对该应用的提示处理。SHA-256 只验证文件字节，不能替代发行者签名。

Ubuntu 优先使用 DEB。它复用 electron-builder 的桌面入口、sandbox helper 和 AppArmor 集成。AppImage 使用无需 FUSE2 的运行时；其 Chromium sandbox 由上游启动器按系统的用户命名空间能力选择，受限系统上可能回退为 `--no-sandbox`。这不等同于所有 Linux 环境都具备相同隔离条件。

## 研究资料

普通安装版使用系统应用配置目录，研究默认放在其 `research/` 子目录。可在“设置 → 本地存储”查看实际路径并迁移到另一磁盘。程序目录与研究目录分别管理。

Windows ZIP 顶层脚本使用同级 `data/`，与普通安装版分别存放配置和研究。详见 [Windows 指南](windows-trial.md)。各平台的凭据依赖系统凭据存储；Linux 桌面的 keyring 配置会影响其能力，固定响应验收不代表所有系统凭据后端均已验证。

跨系统迁移时，在旧版导出研究空间 JSON，再在新系统导入。原始报告、对话及来源关系随研究保留；模型凭据、外部智能体的工作文件和完整原生状态不在研究 JSON 中，需要重新连接或另行迁移。保留原配置与研究目录的备份。

## 升级与卸载

1. 正常退出 QB，备份配置和研究目录。
2. Windows 运行新版安装程序；macOS 用新版应用替换“应用程序”中的旧版；DEB 用系统包管理器更新；AppImage 下载新文件后替换旧文件。
3. 重新打开并核对研究与连接。当前没有自动更新或热更新模块。

卸载 Windows 安装版、移除 macOS 应用或卸载 DEB 均保留用户研究，不能替代备份。Windows ZIP 的 `data/` 应与应用文件分别保留。回退使用升级前备份，重装旧程序不等同于资料降级。

macOS/Linux 是首次提供原生成品，验证了新装、同版本重装、资料保留和移除应用；尚无历史原生安装包的跨版本升级验收。Windows 验证从已发布 `.4` 安装器升级。模型与智能体使用本地固定响应，真实账号、服务可用性和长时间研究质量不在本轮验收范围。

问题反馈：[Issues](https://github.com/Ethan-decoy/QuestBranch/issues)。请提供版本、系统、处理器架构、安装方式和操作步骤，移除私人研究与凭据。

## English

Download the asset matching your OS and CPU from [Releases](https://github.com/Ethan-decoy/QuestBranch/releases), then verify `SHA256SUMS.txt`. Windows offers a per-user installer and an isolated portable ZIP. macOS has separate Apple Silicon and Intel DMGs; drag the app into Applications. Ubuntu/Debian x64 users can install the DEB with their package manager. Linux x64 users can mark the AppImage executable and run it.

Native checks cover macOS 15 on both architectures and Ubuntu 24.04 x64. Other OS versions, Linux distributions and desktop environments are not covered. Windows is unsigned. macOS uses verified ad-hoc signatures without Developer ID or notarization, so first launch may require approval in System Settings → Privacy & Security. Checksums do not replace publisher signatures.

Prefer the DEB on Ubuntu. Its standard packaging includes desktop, sandbox-helper and AppArmor integration. The AppImage uses a FUSE2-free runtime; its upstream launcher may fall back to `--no-sandbox` when user namespaces are unavailable. Linux credential protection depends on the desktop keyring configuration.

Quit before updating and back up both settings and research. Export/import research JSON to move between operating systems; it does not include credentials, external agent files or complete native-session state. Reconnect providers when needed. Removing the installed application preserves research. No automatic or hot updates are provided.

These are the first native macOS/Linux packages: fresh installation, reinstall, research retention and removal are checked, without claiming an upgrade from a historical native release. Tests use local model/OAuth/agent fixtures rather than real accounts. See `VERIFICATION.json` for the accepted source and actual checks.
