# DEV_SETUP — 本地开发环境

> **SSOT 路径**：[`DEV_SETUP.md`](./DEV_SETUP.md) · 文档索引 [`DOC_GOVERNANCE.md`](../DOC_GOVERNANCE.md)

## 依赖

- Node.js / npm（版本以各子项目 `package.json` 为准）
- Windows 目标环境

命名与目录对照（品牌 **ShelfDeck**、`media-desktop` / `media-service`）见 [`DOC_GOVERNANCE.md`](../DOC_GOVERNANCE.md) **ShelfDeck 产品与模块命名**。

## 媒体管理服务

```bash
cd media-service
npm install
npm start
```

默认监听 **18080**（见 `media-service` 源码与 `[API_README.md](../api/API_README.md)`）。

## 桌面（Electron + Vite）

```bash
cd media-desktop
npm install
npm run dev
```

开发脚本应设置 `MEDIA_SERVICE_URL` / `CONTROL_PLANE_URL` 与 `VITE_MEDIA_SERVICE_URL` / `VITE_CONTROL_PLANE_URL` 指向媒体管理服务（通常为 `http://127.0.0.1:18080`）；**同名变量两两同义**，同时设置时 **`MEDIA_SERVICE_*` 优先**。可选 API Key：`MEDIA_SERVICE_API_KEY` / `CONTROL_PLANE_API_KEY` 与 `VITE_*` 对应项（与服务端一致）。

## OpenAPI lint

在仓库根目录：

```bash
npx --yes @redocly/cli lint docs/api/openapi.yaml --config docs/api/redocly.yaml
```

## 媒体管理服务测试

```bash
cd media-service
npm test
```

## 追溯与关联文档

| 文档 | 关系 |
|------|------|
| [`API_README.md`](../api/API_README.md) | IPC→REST、联调约定 |
| [`ARCH_SYSTEM_OVERVIEW.md`](../architecture/ARCH_SYSTEM_OVERVIEW.md) | 媒体管理服务与客户端分工 |
| [`REQ_PRODUCT_BASELINE_v1.0.0.md`](../requirements/REQ_PRODUCT_BASELINE_v1.0.0.md) | 需求母版 |
