# OPS_DEPLOY_CONTROL_PLANE — 媒体管理服务部署备忘

> **SSOT 路径**：[`OPS_DEPLOY_CONTROL_PLANE.md`](./OPS_DEPLOY_CONTROL_PLANE.md) · 文档索引 [`DOC_GOVERNANCE.md`](../DOC_GOVERNANCE.md)  
> **说明**：文件名保留 `CONTROL_PLANE` 仅为历史链接稳定；工程目录为 **`media-service/`**（见 [`DOC_GOVERNANCE.md`](../DOC_GOVERNANCE.md) 命名表）。

部署拓扑与 Windows / fnOS 差异见 [`ARCH_DEPLOYMENT.md`](../architecture/ARCH_DEPLOYMENT.md) 与 [`ARCH_SYSTEM_OVERVIEW.md`](../architecture/ARCH_SYSTEM_OVERVIEW.md)。

## 最小步骤（开发/单机）

1. 安装依赖：`cd media-service && npm install`
2. 配置环境变量与数据目录（路径映射、临时目录等须与 Emby 一致或可映射；`MEDIA_SERVICE_DATA_DIR` 与 `CONTROL_PLANE_DATA_DIR` 同义）
3. `npm start` 或通过进程管理器以常驻服务运行

## 健康检查

以 OpenAPI 中健康相关路径为准（如有）；具体命令随实现补充。

## 追溯与关联文档

| 文档 | 关系 |
|------|------|
| [`ARCH_DEPLOYMENT.md`](../architecture/ARCH_DEPLOYMENT.md) | 部署拓扑 |
| [`ARCH_SYSTEM_OVERVIEW.md`](../architecture/ARCH_SYSTEM_OVERVIEW.md) | 战略与分阶段 |
| [`API_README.md`](../api/API_README.md) | 契约与 lint |
| [`DEV_SETUP.md`](../dev/DEV_SETUP.md) | 本地对照 |
