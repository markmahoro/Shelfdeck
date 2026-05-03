# Changelog

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
