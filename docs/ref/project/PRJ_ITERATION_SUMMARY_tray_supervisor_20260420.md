# ShelfDeck 迭代总结 — Windows 媒体管理服务托盘监督

> **类型**：迭代交付与验收摘要（非 SSOT 条文；产品/行为仍以 REQ/DESIGN/TEST 为准）  
> **索引入口**：`[PRJ_MANAGEMENT.md](./PRJ_MANAGEMENT.md)`

## 1. 迭代目标与背景

前后端分离后，`media-service` 常在终端外独立运行，用户缺少**常驻、可视化**的启停与健康反馈。本迭代交付 **Windows 专用**的**托盘监督进程**（父进程）：与 `media-service`（子进程）**两进程模型**，通过 `**GET /v1/health`** 轮询驱动**绿 / 红 / 灰**状态，并提供菜单完成**启动、重启、停止、退出监督程序**；默认与现有约定一致监听 **18080**（环境变量可覆盖）。

## 2. 交付物清单


| 类别     | 内容                                                                                                                                |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| 实现     | `[media-tray-supervisor/](../../media-tray-supervisor)`（`shelfdeck-media-tray-supervisor`，Electron 主进程 + Tray）                    |
| 可脚本化回归 | `media-tray-supervisor` 内 `npm run smoke`（随机端口 spawn + 健康探测 + 杀进程验证）                                                              |
| 需求     | `[REQ_FEATURE_windows-tray-media-service-supervisor.md](../requirements/REQ_FEATURE_windows-tray-media-service-supervisor.md)`    |
| 架构     | `[ARCH_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../architecture/ARCH_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`                                  |
| 设计     | `[DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`                                    |
| 用户     | `[USER_GUIDE_TRAY_MEDIA_SERVICE.md](../user/USER_GUIDE_TRAY_MEDIA_SERVICE.md)`                                                    |
| 运维     | `[OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../operations/OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`                                      |
| 测试     | `[TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../testing/TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`                                       |
| 治理与入口  | `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)` 文档地图与模块表；`[DEV_SETUP.md](../dev/DEV_SETUP.md)` 托盘联调节；根 `[README.md](../../README.md)` |


## 3. 验收结论

- **本迭代整体验收通过**（UTC+8：**2026-04-20**）。
- **功能与文档**：实现与 `[TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../testing/TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` 所载 **功能测试结论** 一致（含手工准出 T1–T6 与 `npm run smoke`）。
- **应用包版本**：本迭代 **未** 要求提升 `media-desktop/package.json` 的 `version`（托盘监督为独立包）。

## 4. 明确未纳入本迭代的能力

以下仍按 `[PRJ_MANAGEMENT.md](./PRJ_MANAGEMENT.md)` **§3** 视为**未完成**或**非本迭代范围**，避免与「托盘监督」混淆：

- `**media-desktop` 关窗驻留托盘、观影时降低后台负载**（桌面壳层行为，非本迭代交付）。
- **macOS / Linux** 托盘监督等价物。
- **安装器一体化打包 / 签名分发**（OPS 中已描述后续路径）。

## 5. 后续建议（非承诺）

- 将 `media-tray-supervisor` 与 `media-service` 纳入统一安装与升级路径，安装时写入 `TRAY_MEDIA_SERVICE_ROOT`（或等价配置）。
- 按需补充监督进程与服务的**落盘日志**与环境开关。
- 若产品要求 **登录后自动启动服务**，在 DESIGN/OPS 中固化默认策略并实现。

## 6. 追溯


| 文档                                                                                          | 关系         |
| ------------------------------------------------------------------------------------------- | ---------- |
| `[PRJ_MANAGEMENT.md](./PRJ_MANAGEMENT.md)`                                                  | 项目管理锚点与时间线 |
| `[TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../testing/TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` | 测试签发与准出    |
| `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`                                                 | 全库文档索引     |


