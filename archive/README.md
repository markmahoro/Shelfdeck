# 归档与辅助稿

仓库**根目录**仅保留三份**现行**说明（其余工程/历史类 Markdown 放在本目录）：


| 根目录文件                                     | 作用                         |
| ----------------------------------------- | -------------------------- |
| `EmbyDesktopPlayer_PRD_v1.0.0_modules.md` | 产品 PRD：要做什么、怎么做（按模块 A–G）   |
| `TASK_CENTER_FULL_LOGIC.md`               | 任务中心详细规格（主 PRD 子文档 / SSOT） |
| `PROJECT_MANAGEMENT.md`                   | 版本锚点、用户叙事、功能点、开发过程与维护制度    |


本目录其余文件为**历史进度、版本说明、旧开发计划**等，文件名保持原样；相对路径以「仓库根」为 `..`。可选本地-only 的 PRD 再生源稿见 `**.gitignore`** 规则。

**API 契约（非根目录三文件体系）**：媒体控制面目标态 REST 以 `[docs/api/openapi.yaml](../docs/api/openapi.yaml)` 为 SSOT，人读索引见 `[docs/api/README.md](../docs/api/README.md)`。与根目录三份「产品/任务/项目管理」文档并存，职责不重复：HTTP 路径与方法不在 PRD 正文展开。