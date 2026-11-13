# QuestBranch 问之

简体中文 · [English](README.en.md)

**AI-Native Branching Research Workspace**

**看清每条研究分支，接着已有认识继续。**

提出问题，让研究沿着分支逐渐深入。用可视化的研究图看清每个方向已经了解到什么、还有哪些问题，再选中一个节点让 AI 继续研究。

一个节点对应一项研究；节点保存对话、完整报告、来源与报告历史。后续问题成为可以继续深入的子节点。

本仓库提供独立应用的源码、版本和使用文档。当前提供公开开发者预发布。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/workspace-dark.png">
  <img src="docs/images/workspace-light.png" alt="问之研究工作台：分支导航、研究图谱与报告">
</picture>

## 选择使用方式

| 使用方式                                                   | 模型与工具                                | 开始入口                                                                                           |
| ---------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 独立应用（当前仓库）                                       | 自己的模型账号、API、Ollama 或 ACP 智能体 | [下载](https://github.com/Ethan-decoy/QuestBranch/releases) · [安装](docs/desktop-installation.md) |
| [DSH 集成](https://github.com/Ethan-decoy/QuestBranch-DSH) | DeepSeek Harness 的模型、工具与原生会话   | 按插件仓库的安装方式与兼容范围使用。                                                               |

## 下载与开始

公开开发者预发布提供 Windows x64 安装程序/ZIP、macOS Apple Silicon/Intel DMG、Linux x64 DEB/AppImage。按系统和处理器选择实际发布附件，再核对 SHA256SUMS.txt。运行安装包无需 Node.js 或 pnpm。

安装与更新见[安装说明](docs/desktop-installation.md)，隔离 ZIP 见 [Windows 指南](docs/windows-trial.md)，常见条件见 [FAQ](docs/faq.md)。Windows 未签名，Mac 使用 ad-hoc 签名、尚无 Developer ID 和公证；系统实测范围与限制随各版本记录。

使用 dev.7 及更早 AppImage 时，请手动下载当前版本一次，此后使用修复后的内置更新。

1. 阅读示例，或创建项目，再在项目中建立自己的研究与根问题。
2. 连接模型或智能体。工具与检索取决于实际连接，账号登录不等于已经开启联网研究。
3. 在节点中讨论；方向明确后，请 AI 保存阶段报告并建立这些待研究分支。
4. 选一个方向继续，比较具体报告版本，正常关闭重开后再接着研究。

示例保留可回看；示例提问只填入可编辑草稿，子研究不会自动开始。完整流程见[第一次研究](docs/getting-started.md)。

## 功能

- 用“项目 → 研究”管理不同课题，拖动排序；项目文件夹保存研究和 QB 会话状态，支持归档阅读、导出和迁移。
- 用研究画布组织问题，展开或收起分支，搜索、比较和综合不同方向的报告。
- 在节点中持续对话，让 AI 通过工具保存阶段报告与已确定的子分支；保留原始消息和报告历史。
- 通过 Pi AI 使用账号、API 服务与 Ollama，或通过 ACP 使用智能体自身的工具与技能。
- 用本地 SQLite 保存研究，支持研究空间导出与恢复；独立桌面可选择研究资料保存位置并迁移数据。
- 桌面优先，同时提供使用相同研究服务的本地浏览器预览。
- 默认简体中文，可在“设置 → 通用”切换 English 并保存本机偏好；研究内容保持原文。
- 在“设置 → 关于”检查版本，按安装方式下载、重启更新或进入官方附件页面。

## 从源码运行

需要 Node.js **24 或以上**及 pnpm **11.1.3**，包管理器版本已固定。

```powershell
git clone https://github.com/Ethan-decoy/QuestBranch.git
cd QuestBranch
pnpm install --frozen-lockfile
pnpm dev:web
```

打开 [本地浏览器预览](http://127.0.0.1:5173)。桌面开发使用 `pnpm dev`。

```powershell
pnpm check          # 格式、双语、类型与关键行为测试
pnpm build          # Electron 与浏览器构建
pnpm preview        # 启动构建后的浏览器预览
pnpm start          # 启动构建后的 Electron 应用
pnpm package:dir    # 构建并覆盖 release/ 中当前平台的应用目录
pnpm package:win    # Windows：NSIS
pnpm package:mac    # macOS：当前架构 DMG
pnpm package:linux  # Linux：当前架构 DEB 与 AppImage
pnpm notices        # 按当前平台实际安装的生产依赖生成许可材料
pnpm notices:check  # 核对本机锁定依赖与第三方声明
```

安装包在对应系统构建，Mac 的两种架构分别使用 `--arm64` / `--x64`。打包命令会生成当前平台的许可清单，本地构建显式不发布版本。更新目录包前先退出 QB；Windows 固定入口为 `release/win-unpacked/QuestBranch.exe`。实际系统版本和验证范围见[安装说明](docs/desktop-installation.md)与发行附件。

## 配置模型与保存研究

首次启动后，在“模型与连接”选择模型或智能体。直接模型可使用账号、API 或 Ollama，能力目录由 Pi AI 提供；智能体通过 ACP 连接 Codex 或自定义后端。账号凭据在本机保存。

使用 API 服务时选择提供商并配置密钥；自定义服务另外填写协议与地址。未配置模型时，可以正常创建、整理、阅读和导出研究。初始空间中的报告标有“项目设计资料”，用于介绍工作方式。

节点输入区默认 Enter 发送、Shift+Enter 换行，可在“设置 → 快捷键”修改；输入栏直接选择当前连接提供的模型与思考强度。要求保存报告或构建已确定方向时，AI 调用研究工具完成，不会自动开展子研究。

桌面版按“项目 → 研究”组织：一个项目可包含多项研究，内容和 QB 会话状态随项目文件夹保存。侧栏加号创建项目，项目行加号新建研究；右键可重命名、固定、归档或移动研究。Windows 默认项目放在 `%APPDATA%\questbranch\research\projects`，可自选文件夹。浏览器预览继续使用工作目录下的 `.questbranch/`。迁移、备份与恢复见 [使用指南](docs/getting-started.md)。

## 源码结构

```text
src/research/  研究类型、上下文、模型与检索适配
src/desktop/   SQLite、研究服务、Electron main 与 preload
src/preview/   本地浏览器预览服务
src/ui/        React 画布、报告、对话与设置
tests/         关键行为测试
```

使用问题与缺陷请通过 [Issues](https://github.com/Ethan-decoy/QuestBranch/issues) 反馈。版本变化见 [CHANGELOG](CHANGELOG.md)。反馈时请移除密钥和私人研究内容。

本项目采用 [MIT](LICENSE)。SessionWeave 与历史版本的许可范围见 [LICENSING.md](LICENSING.md)，第三方声明见 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)。
