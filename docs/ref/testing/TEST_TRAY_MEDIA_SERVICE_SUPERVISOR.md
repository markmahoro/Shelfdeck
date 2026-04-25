# TEST — ShelfDeck 小助手（媒体管理服务托盘监督）

> **SSOT 路径**：`[TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md](./TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` · 文档索引 `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`

## 范围

本文件覆盖 **Windows** `media-tray-supervisor`（**ShelfDeck 小助手**）与 **媒体管理服务** 联调的 **手工准出**。

**行为来源**：`[DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` · `[DESIGN_DESKTOP_BACKEND_ENDPOINT.md](../design/DESIGN_DESKTOP_BACKEND_ENDPOINT.md)`（**连接仅小助手写入**、Desktop **只读**；**黄/绿/红**、**左键面板**（含 **打开主界面**、**队列摘要**）、**退出默认不杀后端**、**开机自启**、**启动中态**、**退出时停本机服务** 设置）。

**待签发**：小助手模型实现合并后，须重跑下列用例并更新文首表。

## 功能测试结论（已签发 / 待更新）


| 项                                                                     | 结论                                                         |
| --------------------------------------------------------------------- | ---------------------------------------------------------- |
| **签发时间**                                                              | 2026-04-20（UTC+8）起；**新模型**准出待签发                            |
| `**npm run smoke`**                                                   | **通过**（随机端口子集）                                             |
| **T1–T6（历史本机 spawn）**                                                 | **通过**（见 `PRJ_ITERATION_SUMMARY_tray_supervisor_20260420`） |
| **T7–T14（配置同源只读 / 黄灯 / 退出语义 / 面板同屏 / 自启 / 启动中 / 防抖 / Desktop 无连接表单）** | **工程已实现；手工签发待 Windows 实机跑通后勾选**                            |


**含义**：**历史** T1–T6 验证 **本机 spawn** 路径；**新** DESIGN 要求 **连接仅小助手写入**、Desktop **只读** **effectiveBaseUrl**、**健康 URL = effectiveBaseUrl**、**左键面板**（地址 + **打开主界面** + **队列摘要**）、**未配置黄灯**、**开机自启开关**、**启动中态**、**连续失败防抖变红**、**退出时停本机服务** 设置项、**Desktop 无媒体管理服务连接表单** 等，须跑通 **T7–T14** 并重新签发。

**保存管线（保存 = 可用）**：小助手 **「保存连接」** 为统一流程——先健康检查，不通过则 **按地址尝试启动**（本机 spawn；远端占位见 `DESIGN_DESKTOP_BACKEND_ENDPOINT` §4），再在宽限内重试健康，成功后才落盘；手工回归时建议增加：**无既有连接、本机地址、服务未监听 → 仅保存** 能拉起本机服务并最终写入。

## 策略

- 需求：`[REQ_FEATURE_windows-tray-media-service-supervisor.md](../requirements/REQ_FEATURE_windows-tray-media-service-supervisor.md)`  
- 设计：`[DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`

### 可脚本化子集

`media-tray-supervisor` 目录 `npm run smoke`：随机端口 spawn + health，**不**覆盖托盘 UI 与共享配置。

## 环境

- Windows；`npm install`（`media-service` 与 `media-tray-supervisor`）。  
- `TRAY_MEDIA_SERVICE_ROOT` 或使用默认相对路径。  
- **新用例**：准备 **小助手写入**、Desktop **只读** 的 `connection.json`（路径见 `DESIGN_DESKTOP_BACKEND_ENDPOINT`）。

## 手工准出步骤

### 前置（本机 18080 类用例）

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:18080/v1/health"
```

### T1 — 启动与绿灯（本机 spawn，历史）

1. `cd media-tray-supervisor`，`npm start`。
2. **须已配置** `effectiveBaseUrl` 指向本机（或环境变量），菜单 **启动媒体管理服务**。
3. 数秒内 **绿**；`Invoke-RestMethod` 与配置 URL 的 `/v1/health` 一致。

### T2 — 停止与灰/黄（历史）

1. **停止** 并确认。
2. 图标非 **绿**；健康不可达（或回到 **黄** 若清空配置——以实现为准）。

### T3 — 子进程被外部杀死

1. 启动至绿；任务管理器结束对应 `node`。
2. 小助手不卡死；图标 **红** 或 **非绿**（与防抖一致）。

### T4 — 连续健康失败变红

模拟 health 连续失败 **N** 次（与 DESIGN 防抖一致）→ **红**。**必测**。

### T5 — 退出小助手（**新默认语义**）

1. 服务 **绿**（本机由小助手 spawn 场景）。
2. 菜单 **退出**（小助手）。
3. **期望（DESIGN §5）**：**默认** **不**停止 `media-service`；或实现提供「退出时停止」勾选且默认 **关**。
4. **与 2026-04-20 历史实现差异**：若当前实现仍为「退出先停服务」，记录为 **待对齐**，本用例以 DESIGN 为准。

### T6 — 双实例防护

预先 `media-service` 已监听，托盘再 **启动** → 提示且不第二 spawn。

### T7 — 外部启动 + 配置指向本机

1. 连接文件 `effectiveBaseUrl` = `http://127.0.0.1:18080`（或测试端口）。
2. **不**经小助手 spawn，终端 `npm start` `media-service`。
3. 启动小助手；**勿**点启动。
4. **期望**：数轮内 **绿**（探测的是 **配置的 URL**，非写死逻辑错误）。

### T8 — 未配置 → 黄 + 启停禁用

1. 清空或删除连接存储中的 `baseUrl`（按实现）。
2. 启动小助手。
3. **期望**：**黄**；左键面板显示「未配置」类人话；**启动/停止** 禁用。

### T9 — 左键面板展示当前地址

1. 写入已知 `baseUrl`。
2. 左键打开面板。
3. **期望**：首屏 **完整显示** 与该值一致（可复制）。

### T10 — 启动中态（宽限内）

1. 已配置本机地址且服务未监听；小助手点 **启动**（本机 spawn 路径）。
2. **期望**：宽限 `START_GRACE_MS` 内图标为 **黄** 或 **灰**，tooltip 含「启动中」类人话；首次 health 成功后 **绿**。

### T11 — 开机自启开关

1. 设置中 **开启** 开机自启 → 注销或重启 Windows。
2. **期望**：用户登录后小助手 **自动启动**（托盘出现）。
3. **关闭** 开关后重复验证 → **不应**再自启。

### T12 — 左键面板：打开主界面 + 队列摘要

1. 左键打开面板。
2. **期望**：可见 **打开 ShelfDeck 主界面**（或等价文案）入口；点击可启动或 **聚焦** Desktop。
3. **期望**：可见 **任务队列摘要**（件数或状态句，与 Desktop 同源数据；服务不可达时诚实降级文案）。

### T13 — 「退出时停止本机服务」设置

1. 本机由小助手 spawn 且 **绿**。
2. **未勾选**「退出时停止…」→ 退出小助手 → `media-service` **仍运行**。
3. **勾选** 后退出 → 受管本机进程 **停止**（与 DESIGN §5 一致）。

### T14 — Desktop 无媒体管理服务连接表单

1. 启动 Desktop 与小助手。
2. **期望**：配置中心（及路由）**无** 「媒体管理服务地址 / API Key」可编辑分区；**offline** 遮罩与 **顶栏小灯** 引导用户到 **小助手**（与 `DESIGN_DESKTOP_UI_COPY` §4.10、§4.12 一致）。

### 结果记录

勾选 T1–T14；保留输出/截图。

## 准出准则（目标态）


| ID  | 步骤             | 期望                      |
| --- | -------------- | ----------------------- |
| T1  | 已配置 + 菜单启动（本机） | **绿**；health 与配置 URL 一致 |
| T2  | 停止             | 非绿或符合 DESIGN            |
| T3  | 外部 kill node   | 不卡死；图标符合防抖              |
| T4  | 阻塞 health      | **红**（防抖 N 次）           |
| T5  | 退出小助手          | **默认** 不杀后端（DESIGN §5）  |
| T6  | 双实例            | 提示，不第二 spawn            |
| T7  | 外部启动 + 配置本机    | **绿**                   |
| T8  | 未配置            | **黄** + 启停禁用            |
| T9  | 左键面板           | 显示完整当前基址                |
| T10 | 点启动、宽限内        | **启动中** 态后 **绿**        |
| T11 | 开机自启开关         | 开→自启；关→不自启              |
| T12 | 同屏             | 打开主界面 + 队列摘要            |
| T13 | 退出时停服务         | 勾选生效；默认不关               |
| T14 | Desktop        | 无连接表单；遮罩/顶栏引导小助手        |


## 责任

- 实现者执行回归；发版前抽检。

## 追溯与关联文档


| 文档                                                                                                                                                   | 关系     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `[REQ_FEATURE_windows-tray-media-service-supervisor.md](../requirements/REQ_FEATURE_windows-tray-media-service-supervisor.md)`                       | 需求     |
| `[DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`                                                       | 行为     |
| `[OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../operations/OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`                                                         | 运维     |
| `[REQ_FEATURE_desktop-backend-connection-and-windows-lifecycle.md](../requirements/REQ_FEATURE_desktop-backend-connection-and-windows-lifecycle.md)` | 连接与小助手 |


