# DOC_GOVERNANCE — 文档治理与全库索引

本文档是 **现行文档体系的唯一入口（SSOT）**：路径、命名前缀、各类文档职责、SSOT 冲突裁决与归档政策。根目录 `[README.md](../README.md)` 仅作门面并指向本文。

## 文档地图


| 类型                  | 路径                                                                                                                                                                                                                                                                                                                                                          | 职责                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 文档治理                | `docs/DOC_GOVERNANCE.md`                                                                                                                                                                                                                                                                                                                                    | 本文件：索引、规则、归档政策                                      |
| 需求基线                | `docs/requirements/REQ_PRODUCT_BASELINE_v1.0.0.md`                                                                                                                                                                                                                                                                                                          | 产品需求母版（范围、目标、验收、术语索引）；域内细则见下述 `DESIGN_*` / `ARCH_*` |
| 专题需求                | `docs/requirements/REQ_FEATURE_*.md`                                                                                                                                                                                                                                                                                                                        | 增量需求；文首须 `extends` 基线                               |
| 配置与路径               | `docs/design/DESIGN_CONFIG_AND_PATHS.md`                                                                                                                                                                                                                                                                                                                    | 配置中心字段、路径映射、与调度相关配置入口（字段级 SSOT）                     |
| 媒体库与队列入口            | `docs/design/DESIGN_LIBRARY_AND_QUEUE.md`                                                                                                                                                                                                                                                                                                                   | 媒体库列表/策略/星级与码率、豆瓣与有效星级、治理动作与入队规则（非 Flow 细则）         |
| 前台观影闭环              | `docs/design/DESIGN_FRONT_PLAYBACK.md`                                                                                                                                                                                                                                                                                                                      | 信息架构（五页）、海报墙/播放记录、配置与回写闭环、前台 API 清单                 |
| 外部集成                | `docs/architecture/ARCH_INTEGRATIONS.md`                                                                                                                                                                                                                                                                                                                    | MoviePilot/补源、外部服务边界与依赖（不含任务中心 Flow）                |
| 系统架构                | `docs/architecture/ARCH_SYSTEM_OVERVIEW.md`                                                                                                                                                                                                                                                                                                                 | 上下文、组件、路径/配置 SSOT 原则                                |
| 媒体管理服务托盘监督（Windows） | `docs/requirements/REQ_FEATURE_windows-tray-media-service-supervisor.md` · `docs/architecture/ARCH_TRAY_MEDIA_SERVICE_SUPERVISOR.md` · `docs/design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md` · `docs/user/USER_GUIDE_TRAY_MEDIA_SERVICE.md` · `docs/operations/OPS_TRAY_MEDIA_SERVICE_SUPERVISOR.md` · `docs/testing/TEST_TRAY_MEDIA_SERVICE_SUPERVISOR.md` | 托盘父进程 spawn、健康探测、生命周期；实现目录 `media-tray-supervisor/` |
| 部署架构                | `docs/architecture/ARCH_DEPLOYMENT.md`                                                                                                                                                                                                                                                                                                                      | 部署拓扑、Windows/fnOS 等                                 |
| 架构决策                | `docs/architecture/adr/ADR_NNN_*.md`                                                                                                                                                                                                                                                                                                                        | 单条 ADR                                              |
| 任务中心规格              | `docs/design/DESIGN_TASK_CENTER.md`                                                                                                                                                                                                                                                                                                                         | 任务状态机、Flow、验收（行为 SSOT）                              |
| HTTP 契约             | `docs/api/openapi.yaml`                                                                                                                                                                                                                                                                                                                                     | REST 形状 SSOT                                        |
| API 人读              | `docs/api/API_README.md`                                                                                                                                                                                                                                                                                                                                    | 认证、约定、与领域文档对照                                       |
| 项目管理                | `docs/project/PRJ_MANAGEMENT.md`                                                                                                                                                                                                                                                                                                                            | 版本、里程碑、时间线、维护制度                                     |
| 迭代总结（托盘监督）          | `docs/project/PRJ_ITERATION_SUMMARY_tray_supervisor_20260420.md`                                                                                                                                                                                                                                                                                            | 2026-04-20 迭代交付与整体验收摘要（指向 REQ/ARCH/DESIGN/TEST）     |
| 开发说明                | `docs/dev/DEV_*.md`                                                                                                                                                                                                                                                                                                                                         | How-to / 排错                                         |
| 测试                  | `docs/testing/TEST_*.md`                                                                                                                                                                                                                                                                                                                                    | 策略与用例（按需）                                           |
| 运维                  | `docs/operations/OPS_*.md`                                                                                                                                                                                                                                                                                                                                  | 部署与 Runbook（按需）                                     |
| 用户文档                | `docs/user/USER_*.md`                                                                                                                                                                                                                                                                                                                                       | 用户侧说明（按需）                                           |
| 模板                  | `docs/templates/TPL_*.md`                                                                                                                                                                                                                                                                                                                                   | 新建文档时复制的 H2 骨架                                      |


## ShelfDeck 产品与模块命名（定稿）


| 项          | 定稿               |
| ---------- | ---------------- |
| 品牌名（显示/营销） | **ShelfDeck**    |
| 中文品牌名      | **无**（不单独起中文商品名） |



| 模块                 | 中文称呼（文档/口头）    | 目录 slug                 | `package.json` name                   |
| ------------------ | -------------- | ----------------------- | ------------------------------------- |
| 桌面端（Electron + UI） | **桌面客户端**      | `media-desktop`         | `**shelfdeck-media-desktop**`         |
| 后端（Node 服务）        | **媒体管理服务**     | `media-service`         | `**shelfdeck-media-service**`         |
| 托盘监督（Windows）      | **媒体管理服务托盘监督** | `media-tray-supervisor` | `**shelfdeck-media-tray-supervisor**` |


**叙述用语**：原「媒体控制面」在现行文档中统一为 **媒体管理服务**；环境变量名仍可使用历史名称（如 `CONTROL_PLANE_URL`），与 `MEDIA_SERVICE_URL` / `VITE_MEDIA_SERVICE_URL` **同义**（若同时设置，以实现代码中的优先级为准）。OpenAPI、REST、URL 等技术词保留。

## SSOT 与冲突处理

1. **产品范围与用户叙事**：以 `REQ_*` 为准。
2. **任务中心可执行行为**（状态、Flow、与 Emby 交互）：以 `DESIGN_TASK_CENTER.md` 为准。
3. **HTTP 路径、模型、错误码**：以 `openapi.yaml` 为准。
4. 若 OpenAPI 与 REQ/DESIGN 冲突：**先改文档至一致，再改代码**。

## 命名规范（强制英文前缀）


| 前缀                                           | 用途                           |
| -------------------------------------------- | ---------------------------- |
| `DOC`_                                       | 治理/索引（仅 `DOC_GOVERNANCE.md`） |
| `TPL_`                                       | 模板                           |
| `REQ_`                                       | 需求                           |
| `ARCH_`                                      | 架构说明                         |
| `ADR_`                                       | 架构决策（`architecture/adr/`）    |
| `DESIGN_`                                    | 详细设计/行为规格                    |
| `API_README.md`                              | API 人读（与 `openapi.yaml` 同目录） |
| `DEV_` / `TEST_` / `OPS_` / `USER_` / `PRJ_` | 见上表                          |


**例外**：`openapi.yaml`、`redocly.yaml` 保持固定文件名。主题段推荐 **kebab-case**，例如 `REQ_FEATURE_transcode-backup-and-temp-cleanup.md`。

## 多份 REQ 的关系

- **母版**：`REQ_PRODUCT_BASELINE_v1.0.0.md`。  
- **增量**：`REQ_FEATURE_<topic>.md` 文首须含 `extends` / `relates-to`、 `change-type`（additive | iterative）、波及模块、关联 DESIGN/OpenAPI。  
- **冲突**：在本文或 `PRJ_MANAGEMENT.md` 显式裁决。

**母版与域文档**：母版承担跨域验收与索引；`DESIGN_CONFIG_AND_PATHS`、`DESIGN_LIBRARY_AND_QUEUE`、`DESIGN_FRONT_PLAYBACK`、`ARCH_INTEGRATIONS` 等 **不** 替代母版中的产品范围与正式版验收条款，细则与母版冲突时 **先改至一致** 再改实现。

## 归档政策（现行文档不引用 archive）

- 历史成稿仅位于 `archive/legacy/`**。  
- `**docs/**`、根 `README.md`、OpenAPI 描述、代码注释** 不得包含指向 `archive/` 的链接。  
- 可选对照表：`archive/MANIFEST_LEGACY.md`（仅供人工审计，**不**列入本索引导航）。

## 链接约定

- 仓库内相对链接统一使用 **正斜杠**。

## 运行时数据与 Git（media-service）

- `**media-service/data/`**（如 `control-plane-state.json`、豆瓣会话文件等）为 **本地/部署环境运行时状态**，默认 **不视为文档 SSOT**。状态文件名 `control-plane-state.json` 为历史兼容保留。  
- **建议**：将 `media-service/data/*.json`（除可选 `.gitkeep` 或示例）**加入 `.gitignore`**，避免个人队列与密钥类数据进入版本库；若团队需共享「空态示例」，使用 `*.example.json` 并单独跟踪。  
- 具体忽略条目以实现阶段在 `.gitignore` 与本文同步更新为准。

## 可选文档（启用时仍须前缀）

见 `docs/requirements/`、`docs/architecture/`、`docs/design/`、`docs/dev/`、`docs/testing/`、`docs/operations/`、`docs/user/` 下已占位或后续新增的 `REQ_FEATURE_*`、`DEV_ARCHITECTURE_NOTES`、`TEST_*`、`OPS_*`、`USER_*` 等。`ARCH_INTEGRATIONS`、`DESIGN_CONFIG_AND_PATHS`、`DESIGN_LIBRARY_AND_QUEUE`、`DESIGN_FRONT_PLAYBACK` 已列入上文文档地图。