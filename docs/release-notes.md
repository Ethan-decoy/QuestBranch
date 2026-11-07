# QuestBranch v0.3.0-dev.4

Windows x64 开发者预发布，非 Latest。项目采用 MIT；第三方组件保留各自许可。

## 下载

- `QuestBranch-Setup-0.3.0-dev.4-x64.exe`：当前用户安装程序，可选择程序目录，安装后从开始菜单启动。
- `QuestBranch-0.3.0-dev.4-windows-x64.zip`：完整免安装包，解压后用 `Start-QuestBranch.cmd` 隔离试用。
- `SHA256SUMS.txt`：全部附件的 SHA-256；`VERIFICATION.json`：公开构建提交、实际成品与验收结果。
- `README-TRIAL.md`：资料位置、安装、升级和恢复说明。

安装或升级前请正常退出 QB 并备份研究。安装版保留普通桌面资料与自选研究位置；旧 ZIP 的独立 `data/` 不自动合并，迁移到安装版时先导出研究 JSON，再在新版导入。卸载保留资料，不能替代备份。

## 修复与变化

- 修复移除分支时研究画布变空，保留移除结果和撤销能力。
- 补全多版本、别名依赖的许可清单，词库排序不再依赖系统区域设置。
- 新增成品构建、安装、升级与附件回下载校验。依赖版本、固定 SessionWeave 快照及研究数据格式 3 不变。

## 验证范围

Windows runner 验证实际安装器新装、含空格与中文的路径、旧版安装基线升级、研究及自选保存位置保留、旧 ZIP 研究导入与重开、卸载保留资料。另验证 14 项对话、15 项 ACP/MCP 研究闭环、亮/深各 12 项画布操作、实际 OM SDK 的本地固定响应，以及编译和许可文件与构建输入的一致性。

v0.3.0-dev.3 只发布过 ZIP；用于安装器升级的旧版 NSIS 是测试基线，未发布或替换旧版附件。版本与实际验收来源以附件中的 `VERIFICATION.json` 为准。

## 限制与反馈

安装程序未签名，未提供自动更新、热更新或 macOS/Linux 成品。模型与智能体使用固定响应验收，没有调用真实账号，不代表所有厂商、套餐或长时间研究均已验证。

反馈入口：[Issues](https://github.com/Ethan-decoy/QuestBranch/issues)。请提供版本、系统、连接方式和步骤，并移除凭据及私人研究内容。

## English

This Windows x64 developer prerelease adds a per-user installer with a selectable program directory, alongside the isolated portable ZIP. Verify `SHA256SUMS.txt` before use. The installer preserves research on upgrade and uninstall. To move from an old isolated ZIP trial, export research JSON and import it into the installed app; the old `data/` directory is not merged automatically.

This release fixes a blank canvas when removing branches and completes third-party notices. Disposable Windows CI checks fresh installation, an upgrade from a QA-only predecessor installer, retained storage preferences, research import/reopen, and uninstall retention. The predecessor installer was never a published v0.3.0-dev.3 asset. Accepted binaries are uploaded, downloaded and hash-checked before publication.

Packages are unsigned. Automatic updates, macOS/Linux binaries, real-provider coverage and long-running research quality are not validated. See `VERIFICATION.json` for the public source commit and actual acceptance results.
