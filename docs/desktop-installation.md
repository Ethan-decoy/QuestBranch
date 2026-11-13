# 安装、试用与升级

简体中文 · [English](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.9/docs/desktop-installation.en.md)

从 [Releases](https://github.com/Ethan-decoy/QuestBranch/releases) 下载与你的系统及处理器匹配的附件，并核对 `SHA256SUMS.txt`。无需安装 Node.js。各版本提供的平台以实际附件和 `VERIFICATION.json` 为准。

| 系统                | 附件                                  | 使用方式                                                                 |
| ------------------- | ------------------------------------- | ------------------------------------------------------------------------ |
| Windows x64         | `QuestBranch-Setup-…-x64.exe`         | 运行安装程序，支持当前用户安装和选择程序目录。                           |
| Windows x64         | `QuestBranch-…-windows-x64.zip`       | 完整解压，双击顶层 `Start-QuestBranch.cmd` 隔离试用。                    |
| macOS Apple Silicon | `QuestBranch-…-macos-arm64.dmg`       | 打开磁盘映像，将 QuestBranch 拖入“应用程序”。                            |
| macOS Intel         | `QuestBranch-…-macos-x64.dmg`         | 与 Apple Silicon 安装方式相同，选择 x64 附件。                           |
| Ubuntu / Debian x64 | `QuestBranch-…-linux-amd64.deb`       | 用系统软件安装器或 `sudo apt install ./文件名.deb` 安装。                |
| Linux x64 便携版    | `QuestBranch-…-linux-x86_64.AppImage` | 赋予执行权限后运行：`chmod +x 文件名.AppImage`，再 `./文件名.AppImage`。 |

首轮 macOS 成品在 macOS 15 的两种原生架构验收；Linux 成品在 Ubuntu 24.04 x64 验收。其他系统版本、发行版、桌面环境和 ARM Linux 尚未覆盖。

## 系统提示

Windows 安装程序未签名。macOS 使用 ad-hoc 签名并校验包内完整性，尚无 Developer ID 或 Apple 公证，系统可能阻止首次打开；请按“系统设置 → 隐私与安全性”中针对该应用的提示处理。SHA-256 只验证文件字节，不能替代发行者签名。

Ubuntu 优先使用 DEB。它复用 electron-builder 的桌面入口、sandbox helper 和 AppArmor 集成。AppImage 使用无需 FUSE2 的运行时；其 Chromium sandbox 由上游启动器按系统的用户命名空间能力选择，受限系统上可能回退为 `--no-sandbox`。这不等同于所有 Linux 环境都具备相同隔离条件。

DEB 推荐安装 `fonts-noto-cjk` 以显示中文。AppImage 依赖系统字体；如果中文显示为方框，请通过发行版包管理器安装 CJK 字体，例如 Ubuntu 的 `fonts-noto-cjk`。

## 研究资料

普通安装版使用系统应用配置目录保存项目索引与全局连接。一个项目可容纳多项研究，共同保存在项目文件夹的 `.questbranch/research.sqlite`；创建项目时可自选文件夹，默认放在研究目录的 `projects/` 下。侧栏加号后的“选择文件夹”也能重新打开已有项目。“设置 → 本地存储”可迁移整个项目，无需重启；研究菜单可单独移动研究。旧共享库作为“已有研究”项目保留。程序目录与研究目录分别管理。

Windows ZIP 顶层脚本使用同级 `data/`，与普通安装版分别存放配置和研究。详见 [Windows 指南](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.9/docs/windows-trial.md)。各平台的凭据依赖系统凭据存储；Linux 桌面的 keyring 配置会影响其能力，固定响应验收不代表所有系统凭据后端均已验证。

迁移时可正常退出后复制完整项目文件夹，在新系统点击侧栏加号、选择该文件夹并打开项目；QB 管理的会话状态随项目保留，模型账号重新连接。研究 JSON 也可跨系统导入，但会创建独立会话，不包含完整原生状态。外部智能体的原生会话、账号和工作文件按其规则另行备份。保留原配置与研究目录的备份。

## 升级与卸载

1. 正常退出 QB，备份配置和研究目录。
2. Windows 运行新版安装程序；macOS 用新版应用替换“应用程序”中的旧版；DEB 用系统包管理器更新；AppImage 下载新文件后替换旧文件。
3. 重新打开并核对研究与连接。

在“设置 → 关于”检查版本，或点击侧栏版本号进入。Windows 安装版和可写的 Linux AppImage 可下载、校验后重启更新；ZIP／目录版、DMG 和 DEB 提供官方下载入口。定期检查与下载使用系统代理，下载由你选择。

研究、账号连接或资料迁移尚未结束时，重启更新会被阻止，需要结束后再次点击。正常退出不会自动安装，也不在运行中替换应用文件。稳定版检查稳定通道，预览版检查同名预览通道及后续稳定版本，不自动降级。

**dev.7 及更早 AppImage 请手动下载本版一次**，此后的内置更新使用修复后的替换流程。Windows dev.6 及更早版本先手动安装一次，macOS 使用 DMG 手动升级。

本版项目 SQLite 升级至 schema 4，旧库打开升级前保留快照；研究 JSON 仍为格式 3。SessionWeave 固定为 `0.1.0-beta.3`，材料会话为 v4。已有 `backups/` 随整项目迁移保留，其中可能含历史加密配置和对应旧密钥，应作为完整本机恢复档案保管；当前全局凭据不复制到项目研究库。升级前仍需备份完整配置、项目目录及外部智能体文件。

卸载 Windows 安装版、移除 macOS 应用或卸载 DEB 均保留用户研究，不能替代备份。Windows ZIP 的 `data/` 应与应用文件分别保留。回退使用升级前备份，重装旧程序不等同于资料降级。

Windows 使用公开 dev.7 的真实安装器准备旧资料，再驱动本版安装器更新并重开。Linux 从最终包加载安全更新器，注入替换失败后验证旧包与研究重开，再以同一更新器重试，并核对新窗口中的程序字节和研究库。DMG／DEB 检查新装、同版本重装、资料保留和移除。模型使用本地固定响应，实际结果见 `VERIFICATION.json`。

问题反馈：[Issues](https://github.com/Ethan-decoy/QuestBranch/issues)。请提供版本、系统、处理器架构、安装方式和操作步骤，移除私人研究与凭据。

继续见[第一次研究](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.9/docs/getting-started.md)与[常见问题](https://github.com/Ethan-decoy/QuestBranch/blob/v0.3.0-dev.9/docs/faq.md)。
