# TEST — 媒体管理服务托盘监督

> **SSOT 路径**：`[TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md](./TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` · 文档索引 `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`

## 范围

本文件覆盖 **Windows 托盘监督程序**（`media-tray-supervisor`）与 **媒体管理服务** 联调的 **手工准出**；自动化测试非第一版强制。

## 功能测试结论（已签发）

| 项 | 结论 |
|----|------|
| **签发时间** | 2026-04-20（UTC+8） |
| **脚本冒烟** `media-tray-supervisor` 目录 `npm run smoke` | **通过** |
| **手工准出** 下文 T1–T6（Windows 托盘、本机 18080 联调） | **通过** |
| **本迭代整体验收**（产品/项目管理口径） | **通过**（与 [`PRJ_ITERATION_SUMMARY_tray_supervisor_20260420.md`](../project/PRJ_ITERATION_SUMMARY_tray_supervisor_20260420.md)、[`PRJ_MANAGEMENT.md`](../project/PRJ_MANAGEMENT.md) 一致） |

**含义**：截至上述日期，当前实现已满足本文 **准出准则** 及关联 [`REQ_FEATURE_windows-tray-media-service-supervisor.md`](../requirements/REQ_FEATURE_windows-tray-media-service-supervisor.md)、[`DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md`](../design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md) 中的验收意图。**后续代码或行为变更须重新执行** 冒烟与相关手工用例并更新本表。

## 策略

- 以 **需求** `[REQ_FEATURE_windows-tray-media-service-supervisor.md](../requirements/REQ_FEATURE_windows-tray-media-service-supervisor.md)` 与 **设计** `[DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` 为预期行为来源。

### 可脚本化子集（不覆盖托盘 UI）

在 `media-tray-supervisor` 目录执行 `npm run smoke`：于**随机空闲端口** `spawn` 与托盘相同的 `node src/server.js`（`cwd` 为 `media-service`），轮询 `/v1/health` 通过后终止子进程并确认接口不可达。**不替代**下文 T1–T6 中与托盘、对话框相关的条目。

## 环境

- Windows；Node 与仓库依赖已 `npm install`（`media-service` 与 `media-tray-supervisor`）。
- `TRAY_MEDIA_SERVICE_ROOT` 指向正确目录（或使用默认相对路径）。

**说明**：若曾在 Cursor 中生成过「跑托盘测试」的 Plan，副本可能在用户目录 `.cursor/plans/run_tray_supervisor_tests_*.plan.md`；**以本文件为 SSOT**，下列步骤与当时 Plan 一致。

## 手工准出执行步骤（T1–T6 逐步操作）

### 前置

- 测试前尽量释放 **18080**（或与当前 `MEDIA_SERVICE_PORT` 一致；下文按 **18080** 叙述）。
- PowerShell 健康探测（与 `curl` 等价）：

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:18080/v1/health"
```

预期返回对象中含 `status: ok`。

### T1 — 启动与绿灯

1. 终端：`cd media-tray-supervisor`，`npm start`（托盘出现）。
2. 托盘菜单：**启动媒体管理服务**。
3. 数秒内图标 **绿**；执行上述 `Invoke-RestMethod`，确认 `status` 为 `ok`。

### T2 — 停止与灰态

1. 菜单：**停止媒体管理服务**，对话框选 **确定**。
2. 图标 **灰**；再次 `Invoke-RestMethod` 应失败（连接被拒绝或超时）。

### T3 — 子进程被外部杀死

1. 再次 **启动** 服务至绿灯。
2. **任务管理器** 结束本次 **Node.js** 子进程（命令行/工作目录对应 `media-service`）。
3. 托盘应变 **灰**；监督进程不卡死，菜单仍可用。

### T4 — 连续健康失败变红（可选 / 较难）

设计要求：子进程仍在，但 `/v1/health` **连续失败 N 次** 后变 **红**（参数见 [DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md)）。

**模拟思路（择一）**：Process Explorer 对子进程「挂起」线程；或（谨慎）防火墙短时阻断本机访问 `127.0.0.1:18080`。无法稳定模拟时，在记录中注明 **T4 跳过** 并保证 T1/T2/T3/T5/T6。

### T5 — 退出监督程序

1. 服务 **绿**。
2. 菜单：**退出监督程序**，在「将先停止服务」类确认中选 **确定**。
3. 监督进程退出；`Invoke-RestMethod` 失败；无残留受管 `node`；18080 释放。

### T6 — 双实例防护

1. **勿**先开托盘；终端 `cd media-service`，`npm start`，确认健康可用。
2. 另开终端 `cd media-tray-supervisor`，`npm start`，菜单 **启动媒体管理服务**。
3. 期望：**对话框提示**已有服务响应健康、**未**再 spawn 第二实例（与 [media-tray-supervisor/electron/main.js](../../media-tray-supervisor/electron/main.js) 中 `assertCanSpawn` 一致）。
4. 清理：`media-service` 终端 Ctrl+C 或结束对应 `node`。

### 结果记录

用表格勾选 T1–T6 通过 / 失败 / 跳过，并保留命令输出或截图便于回归。

**本轮签发**：T1–T6 与 `npm run smoke` 均已 **通过**，见文首 **功能测试结论（已签发）**。

## 准出准则

以下用例 **全部通过** 方可视为本迭代准出（**已满足**：见文首签发记录）。


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

| 文档 | 关系 |
|------|------|
| [`REQ_FEATURE_windows-tray-media-service-supervisor.md`](../requirements/REQ_FEATURE_windows-tray-media-service-supervisor.md) | 需求验收 |
| [`DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md`](../design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md) | 行为 |
| [`OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md`](../operations/OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md) | 运维 |
| [`PRJ_ITERATION_SUMMARY_tray_supervisor_20260420.md`](../project/PRJ_ITERATION_SUMMARY_tray_supervisor_20260420.md) | 迭代验收摘要 |
| [`PRJ_MANAGEMENT.md`](../project/PRJ_MANAGEMENT.md) | 项目管理 |

