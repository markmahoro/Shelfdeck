# DEVELOPMENT_WORKFLOW — 3-Target 开发工作流

> 状态：v1 定稿
> 目标读者：Claude Code（自动遵循）
>
> 本文档定义了 ShelfDeck 3 个部署目标（service Windows、service Docker、desktop Windows）的开发流程。
> 每条新功能从设计到合入必须经过以下 4 个阶段。

---

## §1 3-Target Impact Checklist（设计阶段 — 编码前必做）

每项功能开始编码前，逐项回答以下 9 个问题。对每个"YES"，按表执行对应目标的验证。

| # | 变更涉及... | [1] service Win | [2] service Docker | [3] desktop Win |
|---|------------|-----------------|-------------------|-----------------|
| 1 | REST API（路径/模型/错误码） | inject test: `npm test` | SSH → `curl` 验证 | vitest integration |
| 2 | Config 字段（新增/改名/默认值） | 检查 Win 默认值 | 检查 Linux 默认值（`process.platform === 'linux'` 路径） | `GET /v1/config` 读取验证 |
| 3 | 文件路径逻辑 | 测试 `C:\...` / `E:\...` 路径 | 测试 `/app/data`, `/media`, `/transcode` | N/A |
| 4 | 系统托盘（tray） | 手动点击托盘图标验证菜单 | SSH → 确认启动不报错，无 tray 不崩溃 | N/A |
| 5 | GPU / FFmpeg 编码 | 本地 GPU 编码测试（NVENC/QSV/AMF） | Docker GPU 编码测试（QSV/NVENC 透传） | N/A |
| 6 | Admin Web UI | `npm run build:web` + 加载页面 | rebuild Docker image + 加载页面 | N/A |
| 7 | Desktop UI | N/A | N/A | `npm run dev` + 手动验证所有连接状态 |
| 8 | 新增 npm 依赖 | 确认 Windows 可用 | Docker build 成功（linux, node:20） | 确认 Electron 内可用 |
| 9 | 新增环境变量 | 确认 service 读取正确 | 确认 Dockerfile 已声明 | 确认 `VITE_` 前缀变体（如需） |

> **如何使用本表**：选定变更涉及的行号后，遍历 [1][2][3] 三列中非 N/A 的格子。每个格子有对应的验证命令或操作，在实现完成后逐一执行。

---

## §2 Platform Guards Reference（实现阶段 — 编码规范）

### 现有平台守卫模式

```js
// ── Docker 默认路径（Linux）────────────────────────────────
// configStore.js
transcodeTempRoot: process.platform === 'linux' ? '/transcode' : '',
upgradeStagingLocalPath: process.platform === 'linux' ? '/upgrade' : '',

// ── Tray 浏览器打开（Windows only）────────────────────────
// tray.js
const cmd = process.platform === 'win32'
  ? `start "" "${url}"`
  : process.platform === 'darwin'
    ? `open "${url}"`
    : `xdg-open "${url}"`;

// ── Tray 模块优雅缺失（Docker）────────────────────────────
// server.js
let startTray = null;
try {
  startTray = require('./tray').startTray;
} catch (_) {
  console.log('[media-service] tray module not available (this is normal on Linux/Docker)');
}

// ── FFmpeg 路径覆盖（Docker 使用系统 ffmpeg）──────────────
// transcodeService.js
const ffmpegPath = String(process.env.FFMPEG_PATH || '').trim();
const ffprobePath = String(process.env.FFPROBE_PATH || '').trim();

// Dockerfile
ENV FFMPEG_PATH=/usr/local/bin/ffmpeg
ENV FFPROBE_PATH=/usr/local/bin/ffprobe

// ── Docker 排除可选依赖 ───────────────────────────────────
// Dockerfile
RUN npm ci --omit=dev --omit=optional  # systray2 is optionalDependency

// ── 平台信息暴露 ──────────────────────────────────────────
// app.js
return { platform: process.platform };
```

### 添加新守卫的规则

1. **使用 `process.platform === 'linux'`**（不要用 `!== 'win32'`），语义明确，表示"在 Docker/Linux 下的行为"
2. **Windows 专用托盘代码** 必须在 `try/catch require` 块内，或显式守卫 `process.platform === 'win32'`
3. **路径** 必须使用 `path.join()` + 可配置根目录，永不硬编码
4. **可选依赖** 在 Docker 中会被 `--omit=optional` 排除，如果新依赖是 Windows-only 的，放入 `optionalDependencies`
5. **新增 env var 影响 Docker 路径时**，在 Dockerfile 中声明默认值，在 `configStore.js` 中提供 `process.platform === 'linux'` 回退

---

## §3 Testing Matrix（测试阶段 — 实现后必做）

对每个变更类型，按表执行对应目标的测试：

| 变更类型 | [1] service Win | [2] service Docker | [3] desktop Win |
|---------|-----------------|-------------------|-----------------|
| REST API | `cd media-service && npm test` | `tests/runner.sh <flow> docker-fn.env` | `cd media-desktop && npm test` |
| Config | 启 service → curl verify Win defaults | SSH → docker compose up → curl verify | vitest config roundtrip |
| Path logic | 创建测试文件 → 跑对应 flow | SSH → 创建测试文件 → 跑对应 flow | N/A |
| Tray | 手动右键菜单 + 健康状态变色 | SSH → `docker logs` 验证无报错 | N/A |
| GPU/FFmpeg | 创建 transcode 任务 → probe output codec | SSH → Docker transcode → probe output codec | N/A |
| Admin web | `npm run build:web` → 刷新浏览器 | `docker build` → docker compose up → 刷新浏览器 | N/A |
| Desktop UI | N/A | N/A | `npm run dev` → 手动 golden path |
| Business flow | `tests/runner.sh <flow> local-win.env` | `tests/runner.sh <flow> docker-fn.env` | vitest e2e-flows |

### 测试运行命令速查

```bash
# Tier 1 — Unit (纯逻辑，无网络，极快)
cd media-service && node --test test/unit/*.test.js    # [1][2]

# Tier 2 — API Contract (真实 service 进程，无外部依赖)
cd media-service && npm test                           # [1] (inject)
cd media-desktop && npm test                           # [3] (vitest)

# Tier 3 — E2E Business Flows (真实 service + 外部依赖)
tests/runner.sh health-check local-win.env             # 所有目标都可用
tests/runner.sh all local-win.env                      # [1] (需 Emby/MoviePilot)
tests/runner.sh all docker-fn.env                      # [2] (需 Emby/MoviePilot)
```

---

## §4 Pre-Merge Checklist（合入前必做）

合入 master 前，逐项确认：

```
□ CI 全部通过（4 jobs: win-svc, docker-svc, e2e-smoke, desktop）
□ tests/runner.sh health-check,config-roundtrip,task-crud local-win.env 通过
□ Docker 构建成功 + docker compose up 冒烟测试通过
□ Desktop 手动验证 golden path（如涉及 UI 变更）
□ 如有 REST API 变更 → docs/v2/design/SERVICE/API.md 已同步
□ 如有 Config 变更 → docs/v2/design/SERVICE/CONFIG.md 已同步
□ 如有新 env var → Dockerfile 已声明默认值
□ 如有 Admin Web 变更 → Docker image 已 rebuild 并验证
```

---

## 关联文档

- `docs/v2/RELEASE_WORKFLOW.md` — 发版工作流（一键触发 + CI 自动构建分发）
- `docs/v2/TEST_ARCHITECTURE.md` — 测试架构（3 tiers, 21 用例, 环境矩阵）
- `docs/v2/ARCH_OVERVIEW.md` — 系统结构总览
- `docs/v2/design/SERVICE/API.md` — REST API 契约 (SSOT)
- `docs/v2/design/SERVICE/CONFIG.md` — 配置字段定义 (SSOT)
