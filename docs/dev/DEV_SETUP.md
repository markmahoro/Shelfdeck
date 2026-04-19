# DEV_SETUP — 本地开发环境

> **SSOT 路径**：[`DEV_SETUP.md`](./DEV_SETUP.md) · 文档索引 [`DOC_GOVERNANCE.md`](../DOC_GOVERNANCE.md)

## 依赖

- Node.js / npm（版本以各子项目 `package.json` 为准）
- Windows 目标环境

## 控制面

```bash
cd control-plane
npm install
npm start
```

默认监听 **18080**（见 `control-plane` 源码与 `[API_README.md](../api/API_README.md)`）。

## 桌面（Electron + Vite）

```bash
cd mvp
npm install
npm run dev
```

开发脚本应设置 `CONTROL_PLANE_URL` / `VITE_CONTROL_PLANE_URL` 指向控制面（通常为 `http://127.0.0.1:18080`）。可选 API Key：`CONTROL_PLANE_API_KEY` / `VITE_CONTROL_PLANE_API_KEY`（与控制面一致）。

## OpenAPI lint

在仓库根目录：

```bash
npx --yes @redocly/cli lint docs/api/openapi.yaml --config docs/api/redocly.yaml
```

## 控制面测试

```bash
cd control-plane
npm test
```

## 追溯与关联文档

| 文档 | 关系 |
|------|------|
| [`API_README.md`](../api/API_README.md) | IPC→REST、联调约定 |
| [`ARCH_SYSTEM_OVERVIEW.md`](../architecture/ARCH_SYSTEM_OVERVIEW.md) | 控制面与客户端分工 |
| [`REQ_PRODUCT_BASELINE_v1.0.0.md`](../requirements/REQ_PRODUCT_BASELINE_v1.0.0.md) | 需求母版 |
