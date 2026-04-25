# REQ_FEATURE — Windows ShelfDeck 小助手（托盘媒体管理服务监督）

> **extends**: `[REQ_PRODUCT_BASELINE_v1.0.0.md](./REQ_PRODUCT_BASELINE_v1.0.0.md)`  
> **change-type**: iterative  
> **relates-to**: `[REQ_FEATURE_desktop-backend-connection-and-windows-lifecycle.md](./REQ_FEATURE_desktop-backend-connection-and-windows-lifecycle.md)` · `[DESIGN_DESKTOP_BACKEND_ENDPOINT.md](../design/DESIGN_DESKTOP_BACKEND_ENDPOINT.md)`

## 文档信息


| 项    | 内容                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------- |
| 状态   | **文档已按「小助手」模型迭代**；历史工程验收见文内「追溯」；新验收以 DESIGN 与更新后的 TEST 为准                                      |
| 平台范围 | **Windows**                                                                                    |
| SSOT | `[DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` |


## 背景与目标

- **ShelfDeck 小助手**在托盘提供 **连接状态（黄/绿/红）**、**当前服务器基址展示与编辑**（**唯一** 写入 `DESIGN_DESKTOP_BACKEND_ENDPOINT` 约定连接文件）、以及 **在已配置前提下** 对 **当前已配置后端** 的 **启停**（UI **不分** 本地/远端两套按钮；实现能力见 DESIGN §3.3）。  
- **打开 Desktop** 时用户旅程上 **须** 连带启动小助手；**关闭 Desktop** **不**关闭小助手；用户可 **单独** 启动小助手；**开机自启小助手** **须**提供 **用户可切换开关**（默认关），见 DESIGN §0。  
- **退出小助手** **默认不** 停止媒体管理服务（与后端生命周期解耦）。

## 范围

### 在内

- 左键 **主面板**：醒目展示 **完整当前 `effectiveBaseUrl`**；**仅** 小助手 **可** 更改连接并保存至 `DESIGN_DESKTOP_BACKEND_ENDPOINT` 约定存储。  
- **黄**：未配置或未就绪；**绿/红**：对已配置 URL 的健康结果（与 Desktop 同源探测）。  
- **启停**：仅当 **已配置** 后端后可用；产品句见 DESIGN §3。  
- **左键面板同屏**：**打开 ShelfDeck 主界面**（启动/聚焦 Desktop）、**任务队列只读摘要**（与 Desktop 同源数据）；见 DESIGN §1。  
- **红绿灯**：含用户点「启动」后宽限内的 **启动中** 态（黄/灰 + tooltip）；见 DESIGN §2。  
- **设置**：**开机自启** 开关；**退出时停止本机媒体管理服务** 勾选（默认关）；见 DESIGN §0 / §5。  
- 本机场景下仍可通过 `spawn` 启动 `media-service`（与 ARCH 一致）。

### 非目标

- macOS/Linux 托盘等价物（第一版）。  
- 保证任意 NAS 的远程进程 kill（可降级为打开帮助/运维说明）。

## 功能需求

1. 配置与健康：同 DESIGN。
2. 启停门槛与实现矩阵：同 DESIGN §3。
3. 退出语义：默认不杀后端；**须提供**「退出时停止本机服务」设置项（默认关）；见 DESIGN §5。
4. Desktop 联动：关闭 Desktop 不退出小助手；打开 Desktop 须启动或聚焦小助手（与 Desktop 实现协同）；小助手 **须**提供「打开主界面」入口（DESIGN §1）。
5. 开机自启、左键同屏、启动中态：同 DESIGN §0–§2。

## 验收标准

- 未配置时：**黄** 且 **启停** 不可用。  
- 已配置且健康：**绿**；失败防抖后：**红**。  
- 小助手保存连接后，Desktop **只读** 展示 **同一** `effectiveBaseUrl` 健康结论；左键面板所示基址与 Desktop 使用基址 **一致**（刷新延迟在合理时间内）。  
- 左键面板 **须** 含「打开主界面」、**队列摘要**；**须** 可切换 **开机自启**；**须** 可见 **启动中** 态（宽限内）；**须** 可配置 **退出时停本机服务**（默认关）。  
- 本机 `spawn` 路径与双实例防护仍可通过历史用例回归（`TEST_TRAY`）。  
- 与 `[TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../testing/TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md)` 更新后的准出一致。

## 实现与代码入口

- `media-tray-supervisor/`；媒体管理服务 `media-service/`。

## 追溯与关联文档


| 文档                                                                                                                  | 关系     |
| ------------------------------------------------------------------------------------------------------------------- | ------ |
| `[REQ_PRODUCT_BASELINE_v1.0.0.md](./REQ_PRODUCT_BASELINE_v1.0.0.md)`                                                | 母版     |
| `[ARCH_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../architecture/ARCH_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`                    | 架构     |
| `[DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`                      | 行为     |
| `[USER_GUIDE_TRAY_MEDIA_SERVICE.md](../user/USER_GUIDE_TRAY_MEDIA_SERVICE.md)`                                      | 用户说明   |
| `[OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../operations/OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`                        | 运维     |
| `[TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md](../testing/TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md)`                         | 测试     |
| `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`                                                                         | 索引     |
| `[PRJ_ITERATION_SUMMARY_tray_supervisor_20260420.md](../project/PRJ_ITERATION_SUMMARY_tray_supervisor_20260420.md)` | 历史迭代摘要 |


