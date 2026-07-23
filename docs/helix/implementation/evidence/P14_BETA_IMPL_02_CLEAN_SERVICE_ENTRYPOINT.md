# P14 BETA-IMPL-02 Clean Service Entrypoint施工证据

Status: `IMPLEMENTED / AWAITING INDEPENDENT P14 RETEST`

## 1. Baseline

| 项目 | 值 |
| --- | --- |
| P13冻结基线 | `3684118d9f727b63a8973d7ba80fbe9187267889` |
| Beta范围基线 | `fcfc38f0f9b246750b7f205f329fadd1a8fe9331` |
| 实施提交 | `6f747926` |
| Architecture SSOT | 未修改 |
| 实施范围 | `shelfdeck service` only |

## 2. 关闭内容

正式`npm start`、Windows启动脚本和Docker `CMD`现在都只进入：

~~~text
src/server.js
  → src/clean-service-host.js
  → Clean Helix Composition Root
  → frozen Admin Route Registry（114）
  → explicit Facades + Session Token Service
  → Platform Admin Credential Repository
  → SQLite Unit of Work / Kernel
~~~

正式启动依赖图不再到达`app.js`、legacy Stores/routes、Kairox/Mirex/Nexora Runtime、
transcode service、tray、Worker protocol或Worker probing。`media-worker`、`media-desktop`、
Ollama、Python/FastAPI、19110和旧Face Service均未进入实现、打包或测试路径。

## 3. Readiness与认证连续性

- Service监听前必须同时证明clean database、schema generation/digest、114 routes、18 UI surfaces、
  Admin Web build和唯一active Admin Credential；任一缺失即拒绝启动，不存在fallback。
- Clean Init在既有177表内写入`platform_admin_credentials`与`platform_secret_refs`。
- Admin API Key只以SHA-256 digest持久化；Session signing secret使用AES-256-GCM envelope，
  `SHELFDECK_SECRET_ROOT`只由部署Secret设施注入，不写入数据库、备份manifest、响应或日志。
- API client使用`X-Api-Key`；浏览器交换得到`HttpOnly; SameSite=Strict`短期Session Cookie。
  Credential revision变化后旧Session失效。
- shutdown先停止Clean Application，再关闭HTTP Host和SQLite Kernel；同一数据和Secret Root重启后
  既有Session仍可验证。

## 4. Product surface与fail-closed结果

- 114个冻结route全部注册在clean HTTP Host。
- `GET /v1/health`、Session exchange/logout和Security credential metadata已有真实clean实现。
- 未完成业务接线的Facade route明确返回`503 CLEAN_FACADE_NOT_IMPLEMENTED`，不伪造Overview或Domain结果。
- Beta不包含Remote Worker；对应冻结route返回
  `404 REMOTE_WORKER_NOT_AVAILABLE_IN_BETA`，且不执行探测。
- `/v1/admin/tasks`等legacy route由正式Host返回404。

这份Evidence只关闭Clean Service Entrypoint。其余Product Facade和Admin Web业务旅程是否完整，
由独立P14测试继续发现和登记；本修复没有用占位成功结果掩盖缺失实现。

## 5. Windows与Docker施工证据

- Windows package只复制`src/server.js`、两个clean environment adapter、`src/helix/`、
  两个clean operational scripts、Admin build和Node依赖；不再复制历史`src/`全树。
- Dockerfile只复制上述service-only文件，`CMD ["node", "src/server.js"]`；
  已删除`media-worker`、Face Service、Python venv、19110、supervisor和Face环境变量。
- 本实施任务未构建Docker image、未启动Container；真实Windows/Docker qualification仍由独立P14执行。

## 6. Test Evidence

| Gate | 结果 |
| --- | --- |
| BETA-IMPL-02 focused + P12/P13 + Persistence/Boundary | `33/33 PASS` |
| 正式Node process HTTP smoke | health、Admin shell、API-Key exchange、Session auth、shutdown `PASS` |
| Restart / wrong Secret Root / missing DB | positive restart与fail-closed反例 `PASS` |
| Legacy route / Worker route / dependency graph | 不可达反例 `PASS` |
| Admin Web production build | `PASS`，81 modules |
| Full Helix Architecture | `121 fixture files PASS`；dependency/semantic/manifests/contracts全部`ok=true` |

冻结机器计数保持`112 Capability / 97 Result family / 177 table / 43 Canonical Transaction /
114 route / 18 UI surface`。Contract aggregate保持
`c7e08ddbccb71e864846c5cb0ef923d3e48f37af30d1111acb0e0316544a0288`；
`findings=[]`，`prohibitedActionsRun=[]`。

## 7. Scope Audit

- 新增Domain：`0`
- 新增Owner/Store/Handoff：`0`
- 新增table/Canonical Transaction：`0`
- cross-Owner write：`0`
- compatibility/dual runtime/legacy fallback：`0`
- `media-worker`/`media-desktop`修改：`0`
- E2E、Docker build、Canary、生产、真实媒体副作用：`0`
