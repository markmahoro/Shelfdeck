# DEBUG_WORKFLOW — 排查工作流

> 状态：v1 定稿
> 目标读者：Claude Code（自动遵循）+ 开发者（配合）
>
> Debug 和新功能开发是两条独立的工作流。本文档定义排查的系统化流程。

---

## §1 Debug vs 开发 — 边界划分

| 维度 | Debug / 排查 | 新功能开发 |
|------|-------------|-----------|
| **触发** | 测试失败、异常日志、用户反馈 | 需求到来 |
| **目标** | 找到根因 → 修复或给出方案 | 交付完整功能 |
| **权限** | 读生产数据、SSH、Docker logs、Emby/MP API | 代码只读、本地验证、自动化测试 |
| **写操作** | 允许修复性写（改配置、重启服务） | 不允许写生产环境 |
| **产出** | 根因描述 + fix commit | 代码 + 测试 + 文档 |
| **参考文档** | 本文档 | `DEVELOPMENT_WORKFLOW.md` |
| **可重复** | 不需要（每次排查的问题不同） | 必须（通过自动化测试） |

> **核心原则**：排查允许突破只读限制（看日志、读配置、SSH 到 NAS），但修改文件前必须确认。排查结论必须落实到代码或文档，不能停留在口头。

---

## §2 排查工具箱

### 2.1 ShelfDeck API（第一层，永远可用）

| 端点 | 用途 | 示例 |
|------|------|------|
| `GET /v1/health` | 确认服务存活 + 健康状态 | `curl http://<ip>:18080/v1/health` |
| `GET /v1/admin/health` | 各子模块状态（scheduler/emby/transcode/upgrade/...） | 快速定位是哪个子系统异常 |
| `GET /v1/library/status` | 子库列表、刷新时间、Douban 同步状态 | `lastRefreshedAt: null` → 刷新未执行 |
| `GET /v1/library?subLibraryId=X` | 媒体库内容、action、评分 | 验证数据是否正确入库 |
| `GET /v1/admin/sublibraries` | 子库完整配置（pathMap、sectionId、embyServerId） | 排查路径映射问题 |
| `GET /v1/tasks` | 活跃任务列表 | 排查调度器状态 |
| `GET /v1/admin/tasks/:id` | 任务详情 + 日志 | 排查单个任务卡住原因 |
| `GET /v1/activity-log` | 最近操作日志 | 排查 refresh/sync 失败原因 |
| `GET /v1/config` | 完整配置（含 Emby 服务器、MoviePilot 等） | 注意：apiKey 被掩码为 `***` |
| `POST /v1/library/actions/refresh` | 手动触发子库刷新 | `{"subLibraryId":"..."}` |
| `POST /v1/library/actions/recompute-strategy` | 手动触发策略重算 | |

### 2.2 Emby API（第二层，排查媒体数据问题）

| 端点 | 用途 | 示例 |
|------|------|------|
| `GET /System/Info?api_key=X` | Emby 服务器信息（OS、版本） | 确认 Emby 在哪台机器上 |
| `GET /Library/VirtualFolders?api_key=X` | 所有媒体库 section + Locations | 确认 sectionId 是否正确 |
| `GET /Library/MediaFolders?api_key=X` | 媒体库详细配置 | 检查 TypeOptions（元数据抓取器） |
| `GET /Users/:uid/Items?ParentId=X&Recursive=true&IncludeItemTypes=Movie&api_key=X` | 查询某个 section 的媒体项 | 确认 Emby 是否扫描到文件 |
| `POST /Items/:id/Refresh?api_key=X` | 手动触发单个媒体库扫描 | `Recursive=true&MetadataRefreshMode=FullRefresh` |
| `GET /ScheduledTasks?api_key=X` | 查看 Emby 扫描任务状态 | 确认扫描是否 Idle/Running |

> Emby URL 和 API Key 从 ShelfDeck config 获取（config 接口掩码 apiKey，需通过 `docker exec cat /app/data/config.json` 获取明文，或由用户提供）。

### 2.3 MoviePilot API（第三层，排查升级流程问题）

| 端点 | 用途 |
|------|------|
| `GET /api/v1/download/?token=X` | 连通性检查（download list） |
| `GET /api/v1/search/title?keyword=X&token=X` | 搜索种子 |
| `GET /api/v1/download/?token=X` | 查看下载列表 |
| `GET /api/v1/history/transfer?token=X` | 查看刮削历史 |

### 2.4 Docker / SSH（第四层，排查容器和基础设施问题）

| 命令 | 用途 |
|------|------|
| `docker logs shelfdeck 2>&1 \| grep -i "error\|refresh\|test"` | 查看服务日志中的异常 |
| `docker exec shelfdeck ls -R /media/test/` | 验证容器内路径挂载是否正确 |
| `docker exec shelfdeck cat /app/data/config.json` | 读取完整配置（含未掩码的 API Key） |
| `docker ps` | 确认容器运行状态 |

> SSH 访问信息由用户提供，通过 `tools/ssh-exec.js` 执行远程命令。

### 2.5 本地文件系统

| 路径 | 用途 |
|------|------|
| `Z:\` (SMB 映射) | Windows 端访问 NAS 文件 |

---

## §3 排查决策树

### 3.1 子库刷新无数据（lastRefreshedAt = null / total = 0）

```
子库刷新无数据
  │
  ├─ 1. ShelfDeck API: GET /v1/admin/sublibraries
  │     ├─ subLibrary 存在？ → NO → 子库未创建
  │     ├─ sectionId 正确？ → NO → 更新 sectionId
  │     ├─ pathMapFrom/To 正确？ → NO → 更新路径映射
  │     └─ embyServerId 正确？ → NO → 修正 Emby 服务器关联
  │
  ├─ 2. Emby API: GET /Library/VirtualFolders?api_key=X
  │     ├─ 对应 section 存在？ → NO → 在 Emby 中创建媒体库
  │     ├─ Locations 路径正确？ → NO → 修正 Emby 媒体库路径
  │     └─ CollectionType = movies？ → NO → 修正类型
  │
  ├─ 3. Emby API: GET /Users/:uid/Items?ParentId=X&IncludeItemTypes=Movie
  │     ├─ TotalRecordCount > 0？ → YES → Emby 有数据，问题在 ShelfDeck 侧
  │     └─ TotalRecordCount = 0 → Emby 也没数据
  │           │
  │           ├─ GET /Library/MediaFolders → TypeOptions 是否空？
  │           │     └─ YES → 常见根因：Movie TypeOptions 无元数据抓取器
  │           │           修复：POST /Library/VirtualFolders/LibraryOptions 更新
  │           │
  │           └─ 触发扫描：POST /Items/:id/Refresh → 等 15s → 复查
  │
  ├─ 4. Docker: docker exec shelfdeck ls /media/test/
  │     └─ 文件存在？ → NO → Docker 挂载问题
  │           ├─ docker-compose.yml 是否有对应 volume？
  │           └─ 宿主机路径是否存在？
  │
  └─ 5. ShelfDeck API: POST /v1/library/actions/refresh
        └─ 等几秒 → GET /v1/library?subLibraryId=X → 复查 total
```

**今天实际遇到的案例**：test 子库 `lastRefreshedAt: null`，Emby 返回 `TotalRecordCount: 0`。
- 第 1 层通过（subLibrary 配置正确）
- 第 2 层通过（VirtualFolders 显示 test section 存在，Locations 正确）
- 第 3 层命中根因：`LibraryOptions.TypeOptions[].Type: "Movie"` 的 `MetadataFetcherOrder: []` 和 `ImageFetcherOrder: []` 均为空 → Emby 不识别电影文件
- 修复：通过 Emby API 更新 LibraryOptions → 触发完整扫描 → 5 部电影出现

### 3.2 任务卡在 created 不执行

```
任务卡在 created
  │
  ├─ 1. GET /v1/admin/health → scheduler 状态？
  │     └─ 不是 green → 调度器异常
  │
  ├─ 2. GET /v1/tasks → 有多少活跃任务？
  │     └─ 超过 concurrency 限制 → 排队中，正常等待
  │
  ├─ 3. GET /v1/config → executionMode？
  │     └─ "manual" → 需要手动 execute
  │
  ├─ 4. 该 itemId 是否已有其他活跃任务？
  │     └─ YES → itemId 锁阻止，等待前一个完成
  │
  └─ 5. smartTask engine 是否启用？
        └─ smartTask 可能管理入队策略
```

### 3.3 升级流程走不通

```
升级任务走不通
  │
  ├─ 1. MoviePilot 连通？ → GET /api/v1/download/?token=X
  │     └─ 404/超时 → 检查 MP URL + 网络
  │
  ├─ 2. 搜索返回结果？ → GET /api/v1/search/title?keyword=X
  │     ├─ 空 → 换英文名再搜
  │     └─ 有 → 种子可用
  │
  ├─ 3. 种子下载状态？ → GET /api/v1/download/?token=X
  │
  └─ 4. 刮削完成？ → GET /api/v1/history/transfer?token=X
```

### 3.4 转码/FFmpeg 问题

```
转码问题
  │
  ├─ 1. GET /v1/admin/health → transcodes.ffmpegOk？
  │     └─ false → FFmpeg 路径不对或未安装
  │
  ├─ 2. 检查 FFmpeg 路径：
  │     ├─ Docker: FFMPEG_PATH 环境变量 → /usr/local/bin/ffmpeg
  │     └─ Windows: ffmpeg-static npm 包
  │
  ├─ 3. transcodeEncodingDevices 配置？
  │     ├─ GPU 设备 status=busy → 等空闲
  │     └─ 无 GPU → 用 CPU 回退
  │
  └─ 4. 任务日志中查看 encoder 信息
```

---

## §4 排查命令速查

```bash
# 快速诊断三板斧
curl -s http://<ip>:18080/v1/admin/health | node -e "..."   # 各模块状态
curl -s http://<ip>:18080/v1/activity-log                     # 最近活动
curl -s http://<ip>:18080/v1/tasks                            # 活跃任务

# Emby 快速诊断
curl -s "http://<emby>:8096/Users/<uid>/Items?ParentId=<section>&Recursive=true&IncludeItemTypes=Movie&Limit=5&api_key=<key>"

# Docker 快速诊断（需 SSH）
docker logs shelfdeck 2>&1 | tail -50
docker exec shelfdeck ls /media/test/

# 手动触发
curl -X POST http://<ip>:18080/v1/library/actions/refresh -H 'Content-Type: application/json' -d '{"subLibraryId":"..."}'
curl -X POST http://<ip>:18080/v1/library/actions/recompute-strategy -H 'Content-Type: application/json' -d '{}'
```

---

## §5 排查后必须做

1. **根因明确**：用一句话描述根本原因（不是现象）
2. **修复落地**：如果是代码 bug → commit fix；如果是配置问题 → 记录修复步骤；如果是环境问题 → 更新部署文档
3. **用例补充**：如果排查过程中发现测试覆盖缺口 → 在 `TEST_ARCHITECTURE.md` 中补用例
4. **关联文档更新**：如果排查发现文档描述与实际行为不符 → 更新对应 SSOT 文档

---

## 关联文档

- `docs/v2/DEVELOPMENT_WORKFLOW.md` — 开发工作流（新功能实现）
- `docs/v2/TEST_ARCHITECTURE.md` — 测试架构（测试用例目录）
- `docs/v2/RELEASE_WORKFLOW.md` — 发版工作流
- `tests/TEST_ENV_CHECKLIST.md` — 测试环境清单（含 SSH/Emby API 等排查关键信息）
