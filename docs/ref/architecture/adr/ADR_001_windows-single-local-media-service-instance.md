# ADR 001 — Windows 本机单一媒体管理服务监听实例

> **状态**：已采纳（文档）  
> **日期**：2026-04-20（UTC+8）  
> **关联需求**：`[REQ_FEATURE_desktop-backend-connection-and-windows-lifecycle.md](../../requirements/REQ_FEATURE_desktop-backend-connection-and-windows-lifecycle.md)`

## 上下文

ShelfDeck **媒体管理服务**（`media-service`）在默认产品场景中监听 **单一 TCP 端口**（默认 `18080`，可由 `MEDIA_SERVICE_PORT` / `CONTROL_PLANE_PORT` 覆盖）。在同一 **Windows** 主机上，若用户误启多个监听同一端口的进程，第二个实例通常因 `EADDRINUSE` 失败，但失败时机、日志与用户感知未在产品层统一；托盘与桌面亦需一致的「单实例」叙述。

远端部署（如 NAS、fnOS）不在本 ADR 的「同一 Windows 主机」范围内。

## 决策

1. **主策略**：在 **Windows** 上，对**同一配置端口**，产品保证 **至多一个** 成功处于 **listen** 状态的 `media-service` 进程作为本机对外服务。
2. **实现手段（可组合，以实现为准）**：
  - **必选**：依赖 Fastify/`listen` 的端口独占；第二实例在 `listen` 阶段失败并 **非零退出**，控制台或日志含可读原因（如端口占用）。
  - **可选增强**：在 `listen` **前** 使用 **命名互斥体**（`Global\ShelfDeckMediaService` 或版本化名称）或等价锁，以便在极端竞态下更早失败并输出明确文案「已有实例在运行」。
3. **非默认端口**：高级用户通过环境变量改用其它端口时，**允许**多进程各监听不同端口；产品不禁止，但**不**作为默认支持矩阵的一部分。

## 后果

- **正面**：与托盘防双开、桌面默认同端口假设一致；运维文档可统一描述「本机一实例」。
- **负面**：同一机器多租户/多实例需显式分配端口；自动化测试并行跑多个服务时需分配不同 `MEDIA_SERVICE_PORT`。
- **与远端关系**：桌面客户端可配置连接远端服务；**不**要求远端仅单实例（由部署方约束）。

## 备选方案（已否决或延后）

- **仅文档约定、不加强代码**：不足以统一验收口径。
- **强制全局 Mutex 不设端口监听**：与 Unix 习惯及容器场景不一致；作为可选增强而非唯一手段。

## 追溯


| 文档                                                                            | 关系            |
| ----------------------------------------------------------------------------- | ------------- |
| `[OPS_DEPLOY_CONTROL_PLANE.md](../../operations/OPS_DEPLOY_CONTROL_PLANE.md)` | Windows 部署与排错 |
| `[media-service/src/server.js](../../../media-service/src/server.js)`         | 监听与端口         |
