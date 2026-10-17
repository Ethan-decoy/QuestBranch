# QuestBranch 问枝

**AI-Native Branching Research Workspace**

提出问题，让研究沿着分支逐渐深入。用可视化的研究图看清每个方向已经了解到什么、还有哪些问题，再选中一个节点让 AI 继续研究。

一个节点对应一项研究；节点保存对话、完整报告、来源与报告历史。后续问题成为可以继续深入的子节点。

当前版本为 **0.2.1**。本仓库用于稳定版源码、使用文档与问题反馈，目标是未来公开，**目前保持私有，暂不公布**。

## 功能

- 用研究画布组织问题，展开或收起分支，搜索、比较和综合不同方向的报告。
- 在节点中持续对话，再把已有材料整理为报告；保留原始消息和报告历史。
- 支持本机已登录的 Codex 账号、兼容 OpenAI 的模型服务和 Ollama，可选接入 Tavily 检索。
- 用本地 SQLite 保存研究，支持完整导出与恢复；Windows 桌面可选择研究资料保存位置并迁移数据。
- 桌面优先，同时提供使用相同研究服务的本地浏览器预览。

## 从源码运行

需要 Node.js **24 或以上**及 pnpm **11**。

```powershell
git clone https://github.com/Ethan-decoy/QuestBranch.git
cd QuestBranch
pnpm install --frozen-lockfile
pnpm dev:web
```

打开 [本地浏览器预览](http://127.0.0.1:5173)。桌面开发使用 `pnpm dev`。

```powershell
pnpm check          # 格式、类型与关键行为测试
pnpm build          # Electron 与浏览器构建
pnpm preview        # 启动构建后的浏览器预览
pnpm start          # 启动构建后的 Electron 应用
pnpm package:dir    # 生成当前平台的应用目录
```

Windows 应用目录的入口为 `release/win-unpacked/QuestBranch.exe`。当前已验证 Windows 本地运行，macOS、Linux 的实际运行和安装包尚未验证；目前未提供签名安装包。

## 配置模型与保存研究

首次启动后，在“模型与设置”选择连接方式。使用 Codex 账号时，先安装 Codex 并完成 ChatGPT 登录，点击“测试连接”并保存。QB 通过本机 `app-server` 调用，不保存 Codex 登录凭据。

使用其他模型服务时，在本地设置页填写服务地址、模型名称和密钥。未配置模型时，可以正常创建、整理、阅读和导出研究。初始空间中的报告标有“项目设计资料”，用于介绍工作方式。

浏览器预览默认使用项目下的 `.questbranch/`；Windows 桌面默认使用 `%APPDATA%\questbranch\research`。迁移保存位置、导出恢复和环境配置见 [使用指南](docs/getting-started.md)。

## 源码结构

```text
src/research/  研究类型、上下文、模型与检索适配
src/desktop/   SQLite、研究服务、Electron main 与 preload
src/preview/   本地浏览器预览服务
src/ui/        React 画布、报告、对话与设置
tests/         关键行为测试
```

使用问题与缺陷请通过 [Issues](https://github.com/Ethan-decoy/QuestBranch/issues) 反馈。版本变化见 [CHANGELOG](CHANGELOG.md)。反馈时请移除密钥和私人研究内容。

项目尚未指定开源许可证。
