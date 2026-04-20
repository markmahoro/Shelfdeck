# TEST — 媒体管理服务托盘监督

> **SSOT 路径**：`[TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md](./TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` · 文档索引 `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`

## 范围

本文件覆盖 **Windows 托盘监督程序**（`media-tray-supervisor`）与 **媒体管理服务** 联调的 **手工准出**；自动化测试非第一版强制。

## 策略

- 以 **需求** `[REQ_FEATURE_windows-tray-media-service-supervisor.md](../requirements/REQ_FEATURE_windows-tray-media-service-supervisor.md)` 与 **设计** `[DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` 为预期行为来源。

## 环境

- Windows；Node 与仓库依赖已 `npm install`（`media-service` 与 `media-tray-supervisor`）。
- `TRAY_MEDIA_SERVICE_ROOT` 指向正确目录（或使用默认相对路径）。

## 准出准则

以下用例 **全部通过** 方可视为本迭代准出。


| ID  | 步骤                                              | 期望                                                            |
| --- | ----------------------------------------------- | ------------------------------------------------------------- |
| T1  | 启动监督程序；菜单 **启动媒体管理服务**                          | 数秒内托盘变为 **绿**；`curl http://127.0.0.1:18080/v1/health` 返回 `ok` |
| T2  | 菜单 **停止媒体管理服务** 并确认                             | 子进程退出；托盘 **灰**；健康 URL 不可达                                     |
| T3  | 启动服务后，任务管理器结束子进程 `node`（模拟崩溃）                   | 托盘 **灰** 或按 DESIGN **Crashed** 语义；无死锁                         |
| T4  | 启动服务后，将子进程挂起或阻塞健康（若可模拟）使连续健康失败                  | 托盘变为 **红**（连续 N 次失败后）                                         |
| T5  | **退出监督程序**（服务运行中）                               | 确认后服务停止；监督进程退出；无残留受管 `node`（端口释放）                             |
| T6  | 预先 `npm start` 启动 `media-service`，再尝试从托盘 **启动** | **不**产生双实例：提示端口占用或拒绝 spawn（与实现一致）                             |


## 责任

- 功能开发：实现 `media-tray-supervisor` 的工程师执行回归。
- 发版前：按本清单抽检。

## 用例索引


| 用例       | 关联设计章节 |
| -------- | ------ |
| 启动/停止/重启 | 主流程    |
| 红/绿/灰    | 状态机    |
| 端口冲突     | 异常与边界  |


## 追溯与关联文档


| 文档                                                                                                                             | 关系   |
| ------------------------------------------------------------------------------------------------------------------------------ | ---- |
| `[REQ_FEATURE_windows-tray-media-service-supervisor.md](../requirements/REQ_FEATURE_windows-tray-media-service-supervisor.md)` | 需求验收 |
| `[DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`                                 | 行为   |
| `[OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../operations/OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`                                   | 运维   |
