# ShelfDeck 迭代总结 — 桌面后端连接与小助手（文档包）

> **类型**：迭代交付摘要（非 SSOT；条文以 REQ/DESIGN/ADR 为准）  
> **索引入口**：`[PRJ_MANAGEMENT.md](./PRJ_MANAGEMENT.md)`  
> **日期**：2026-04-20（UTC+8）起持续修订；**2026-04-21** 修订 **连接独写** 模型

## 1. 迭代目标与背景

文档化并统一以下产品叙事：

1. **连接死锁规避**：**媒体管理服务 URL / API Key** 的 **用户配置与持久化** **唯一** 在 **ShelfDeck 小助手**；**Desktop** **只读** 同一连接文件（+ 环境变量优先级），**不得** 在配置中心提供「媒体管理服务连接」表单，避免「桌面须连上后端才能保存地址、小助手又须先有地址才能启停」的循环。  
2. **Desktop**：**先** 能 `GET /v1/health` **online**（依赖小助手已配通或 env），**再** 在配置中心配 **Emby 等**；壳层 **强门禁** + **顶栏小型** 黄/绿/红；遮罩文案 **引导到小助手**。  
3. **Windows**：本机默认端口 **单实例**（`ADR_001`）。  
4. **ShelfDeck 小助手**（`media-tray-supervisor`）：  
   - **独占写入** `effectiveBaseUrl` 约定存储（`DESIGN_DESKTOP_BACKEND_ENDPOINT`）；Desktop **同源只读**；  
   - **黄 / 绿 / 红** = 未配置或未就绪 / 健康 / 不健康（**非**写死仅本机 127.0.0.1）；  
   - **左键主面板** **必须** 醒目展示 **当前完整服务器地址**；  
   - **未配置** 则 **禁用** 启停；**已配置** 后 **统一** 启停入口（UI **不分** 本地/远端；实现矩阵见 DESIGN §3.3 与 OPS）；  
   - **打开 Desktop** 时旅程上 **连带** 启动小助手；**关 Desktop** **不**关小助手；**退出小助手** **默认不** 停止后端。

**工程实现**满足上述条文后，须重跑 `[TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../testing/TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` **T5–T14**（含 Desktop **无连接表单**）并更新签发。

## 2. 交付物清单（文档）

| 类别 | 内容 |
| --- | --- |
| 核心新建/修订 | `REQ_FEATURE_desktop-backend-connection-and-windows-lifecycle.md` · `DESIGN_DESKTOP_BACKEND_ENDPOINT.md` · `ADR_001_*.md` · `DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md` · `REQ_FEATURE_windows-tray-media-service-supervisor.md` · `ARCH_TRAY_MEDIA_SERVICE_SUPERVISOR.md` · `USER_GUIDE_TRAY_MEDIA_SERVICE.md` · `OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md` · `TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md` |
| 关联修订 | `DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY.md` · `DESIGN_CONFIG_AND_PATHS.md` · `DESIGN_DESKTOP_UI_COPY.md` · `DESIGN_FRONT_PLAYBACK.md` · `DESIGN_CONFIG_CENTER_SAVE_FEEDBACK.md` · `REQ_FEATURE_desktop-requires-media-service.md` · `USER_GUIDE_OVERVIEW.md` · `DEV_SETUP.md` · `ARCH_SYSTEM_OVERVIEW.md` · `DOC_GOVERNANCE.md` · `PRJ_MANAGEMENT.md` |

## 3. 验收结论（文档阶段）

- **文档包**：已按 **小助手独写、桌面只读** 对齐。  
- **OpenAPI**：无契约变更声明。  
- **工程**：待实现；准出以更新后 `TEST_TRAY` 为准。

## 4. 明确未纳入或待实现裁决

- Desktop **只读** 连接文件的 **刷新机制**（`fs.watch` / 轮询 / 小助手 IPC）。  
- **远端** 启停的具体通道（API / 打开 NAS 说明 / SSH）按部署迭代。  
- **退出小助手是否可选「同时停止本机服务」** 的高级设置（DESIGN 已要求交付，默认关）。

## 5. 追溯


| 文档 | 关系 |
| --- | --- |
| `[PRJ_MANAGEMENT.md](./PRJ_MANAGEMENT.md)` | 项目管理 |
| `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)` | 索引 |
