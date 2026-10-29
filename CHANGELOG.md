# Changelog

ShelfDeck **唯一面向人的产品 Changelog**。按 **Product version**（= Git release tag）记录版本间变化。

口径权威：[`docs/v3/VERSIONING.md`](docs/v3/VERSIONING.md)。  
**当前 NAS 生产镜像 / commit / sha256** 以 [`docs/helix/CURRENT_STATUS.md`](docs/helix/CURRENT_STATUS.md) 为准，不在本文件逐次镜像流水。

写法约定：

- 日常合入：重要用户可见变更可记入 **Unreleased**（可选）。
- 用户确认正式 release：打 Git tag → 将 Unreleased 落入对应 `## vX.Y.Z…` 章节。
- Hotfix 仅部署、未打产品 tag：只更新 Helix Status；必要时在 Unreleased 记一行“已部署但未打产品版本”。

---

## Unreleased

### Docs / hygiene

- 文档入口收敛到 Helix；归档 v2.5、Helix 根历史 issue log / 审查 / 早期 acceptance。
- `docs/v3/CURRENT_STATUS.md` stub 化；生产身份只写 Helix Status。
- CI `pull_request` 目标分支 `master` → `main`；**退役 Windows desktop/service CI**（仅保留 Linux/Docker）。
- Docker smoke 在启动前执行 `helix-clean-init`（修复 `CLEAN_DATABASE_MISSING`）。
- 明确 Product version = Git release tag，并与本 Changelog / Docker tag 分层对齐。

---

## Helix Beta（已部署生产线；尚无覆盖本线的正式 Product version tag）

Release goal：`Helix Beta`（Movie 全链路等，见 Helix Plan / Status）。

- 生产身份与历次 deploy：见 Helix `CURRENT_STATUS` 与 `docs/helix/implementation/evidence/`。
- 最近历史 Git release tag `v2.0.0` **不**代表当前 Helix 镜像。
- 下一次用户确认的正式产品发布应打 `v3.0.0-beta.N`（或当时约定的 tag），并在本文件新增对应章节。

---

## v1.0.0 (2026-05-03)

### 核心体验
- **Emby 登录**：添加子库向导从 API Key 改为用户名+密码登录，3 步完成（登录 → 选文件夹 → 配置）
- **VBS 启动器**：双击 `shelfdeck_service启动器.vbs` 无窗口启动 service，自动打开管理页面
- **托盘**：系统托盘品牌图标 + 健康状态文字，无需 .NET 运行时
- **Desktop 图标**：exe/任务栏/窗口均使用 ShelfDeck 品牌图标

### 媒体库策略
- 策略模板引擎：用户可配置的条件规则（priority + groups + actionParams），替代硬编码 `mediaPolicy`
- 默认模板 13 条规则：覆盖 1-5★ 各场景（删除/转码/洗版/保留），支持现代编码精确判断
- 子库级路径映射（`pathMapFrom` → `pathMapTo`），前缀替换，配子库时顺带配置
- 媒体库刷新完成后立即计算 `equivalentBitrate`，策略即时可用

### 任务调度
- per-subLibrary 调度模式（`full_auto` / `custom` / `full_manual`）
- 中断任务自动恢复（3 次重试）
- 任务中心"执行"按钮支持 `created` / `pending_manual` / `paused` / `interrupted` / `pausing` 全状态

### 日志与诊断
- 持久日志文件（`data/shelfdeck.log`，5MB 轮转）
- 管理页面仪表盘底部"查看完整运行日志"链接
- 豆瓣评分同步日志：每 100 条进度 + `[豆瓣]` source 标签
- 豆瓣健康检查：实际连接性测试（`movie.douban.com` 5s 超时）

### 构建与部署
- 全自动一键出包：`node scripts/build-release.js`
- 发布产物：`ShelfDeck播放助手.exe` + `shelfdeck_service启动器.vbs` + `media-service/`
- Service 自带 Node.js 运行时，用户无需安装

### 文档
- 25 份设计文档从 v2 收敛到 v4，与代码一致
- 开源合规：GPL-3.0 LICENSE + FFmpeg 合规声明 + 第三方协议审计 + 合规风险提示

### 修复
- 路径映射不在默认配置中，全新安装无法使用转码/洗版
- 添加子库后已看状态错乱（wizard 不存 userId 导致取到其他用户的观看数据）
- 豆瓣评分同步无中间进度反馈
- Desktop exe 图标始终为 Electron 默认
- 托盘图标损坏（PNG 改后缀 ICO）
- 首次安装自算字段不计算（时序问题：自算跑在刷新完成前）
- `full_manual` 模式下 `created` 状态任务无执行按钮
