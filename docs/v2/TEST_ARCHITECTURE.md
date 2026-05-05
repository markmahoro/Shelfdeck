# TEST_ARCHITECTURE — 测试架构

> 状态：v1 定稿
> 目标读者：Claude Code（自动遵循）+ 开发者（手动执行）
> 
> 本文档定义了 ShelfDeck 的测试分层、环境矩阵和完整的用例目录。

---

## §1 测试环境矩阵

| 环境                  | 目标覆盖                                | 访问方式                                | 依赖服务                        |
| ------------------- | ----------------------------------- | ----------------------------------- | --------------------------- |
| 本地 Windows          | [1] service Win + [3] desktop Win   | `http://127.0.0.1:18080`            | 本地 Emby（可选）、本地 ffmpeg       |
| 飞牛 NAS (Docker)     | [2] service Docker                  | SSH → `httt://192.168.12.230:18080` | Emby（内网）、MoviePilot（内网）、GPU |
| CI (ubuntu-latest)  | [2] service Docker smoke            | `docker run` 临时容器                   | 无外部依赖                       |
| CI (windows-latest) | [1] service Win + [3] desktop build | 直接执行                                | 无外部依赖                       |

---

## §2 测试分层 (3 Tiers)

### Tier 1 — Unit Tests

**范围**：纯逻辑函数，无网络、无 I/O、无外部进程。

| 模块                   | 待测函数                                                     | 测试文件                                |
| -------------------- | -------------------------------------------------------- | ----------------------------------- |
| `mediaPolicyService` | `recommendedAction(item, policy)` → `{ action, reason }` | `test/unit/mediaPolicy.test.js`     |
| `doubanMatchService` | 中文名关键词匹配、NFKC 规范化                                        | `test/unit/doubanMatch.test.js`     |
| `configStore`        | 默认值、platform 相关默认值、验证逻辑                                  | `test/unit/configStore.test.js`     |
| Config migration     | V4→V5 等迁移逻辑                                              | `test/unit/configMigration.test.js` |

**运行命令**：

```bash
cd media-service && node --test test/unit/*.test.js    # [1][2]
cd media-desktop && vitest run --testPathPattern 'unit/'  # [3]
```

**CI**：每次 push 必跑，Windows + Linux 双平台。

### Tier 2 — API Contract / Integration Tests

**范围**：真实 service 进程，无外部依赖（不需要 Emby/MoviePilot/GPU）。

| 类别               | 覆盖内容                                  | 测试文件                                           |
| ---------------- | ------------------------------------- | ---------------------------------------------- |
| Task CRUD        | create → list → detail → delete       | media-desktop: `apiClient-integration.test.ts` |
| Task lifecycle   | pause → resume → cancel               | media-desktop: `e2e-flows.test.ts`             |
| Config roundtrip | PATCH → GET → verify 持久化              | media-desktop: `e2e-flows.test.ts`             |
| Health check     | `GET /v1/health` + `/v1/admin/health` | media-desktop: `e2e-flows.test.ts`             |
| Error codes      | 400/401/404/409 正确返回                  | 各测试文件中分散覆盖                                     |
| Library cache    | POST seed → GET verify                | media-desktop: `apiClient-integration.test.ts` |

**运行命令**：

```bash
cd media-service && npm test                           # [1] (Fastify inject)
cd media-desktop && npm test                           # [3] (vitest, spawns service on port 18090)
```

**CI**：每次 push 必跑。

### Tier 3 — E2E Business Flow Tests

**范围**：真实 service + 真实外部依赖（Emby/MoviePilot/GPU/文件系统）。

| Flow               | 用例数 | 外部依赖                   | 可在 CI 跑？      |
| ------------------ | --- | ---------------------- |:-------------:|
| Health Check       | 2   | 无                      | YES           |
| Task CRUD (basic)  | 3   | 无                      | YES           |
| Config Roundtrip   | 3   | 无                      | YES           |
| Delete Flow        | 4   | 媒体文件（磁盘）               | NO（需真实文件）     |
| Transcode Flow     | 4   | 媒体文件 + ffmpeg          | NO（需 GPU/时间）  |
| Upgrade Flow       | 5   | MoviePilot + Emby + 媒体 | NO（需全套环境）     |
| Media Library Flow | 3   | Emby + Douban          | NO（需 Emby 连接） |

**运行命令**：

```bash
# CI-safe flows (无外部依赖)
tests/runner.sh health-check,config-roundtrip,task-crud local-win.env

# All flows (本地 Windows service)
tests/runner.sh all local-win.env

# All flows (飞牛 Docker)
tests/runner.sh all docker-fn.env

# Single flow
tests/runner.sh upgrade-flow docker-fn.env
```

---

## §3 测试用例目录（21 用例）

### Health Check Flow（2 用例）

1. **所有服务正常 → green**
   
   - Given: service 运行中，config 完整，Emby 可达，scheduler 运行
   - When: `GET /v1/health`
   - Then: `status: "green"`, `timestamp` 存在

2. **Emby 不可达 → yellow**
   
   - Given: service 运行中，但 Emby 连接失败
   - When: `GET /v1/health`
   - Then: `status: "yellow"` 或 `"red"`（取决于 Emby 权重）
   - 不会因 Emby 失败导致服务崩溃

### Task CRUD Flow（3 用例）

3. **任务完整生命周期**
   
   - Given: 创建一个 transcode 任务
   - When: create → getTask → deleteTask
   - Then: 创建返回 201 + 有效 id，获取返回完整字段，删除后 get 返回 404

4. **重复 itemId 创建返回 409**
   
   - Given: itemId "movie-123" 已有活跃任务
   - When: POST /v1/tasks with same itemId
   - Then: 409 Conflict

5. **无效 actionType 返回 400**
   
   - Given: actionType="invalid_action"
   - When: POST /v1/tasks
   - Then: 400 Bad Request

### Config Roundtrip Flow（3 用例）

6. **Config PATCH → GET 持久化**
   
   - Given: 任意 config key
   - When: PATCH 修改值 → GET 重新读取 → 重启服务 → GET 再次读取
   - Then: 修改的值在重启后仍然保持

7. **Docker 环境下 Linux 路径默认值**
   
   - Given: `process.platform === 'linux'`
   - When: 启动服务，GET /v1/config
   - Then: `transcodeTempRoot: "/transcode"`, `upgradeStagingLocalPath: "/upgrade"`, `savePath: ""`

8. **Windows 环境下路径默认值**
   
   - Given: `process.platform === 'win32'`
   - When: 启动服务，GET /v1/config
   - Then: `transcodeTempRoot: ""`, `upgradeStagingLocalPath: ""`

### Delete Flow（4 用例）

9. **创建删除任务 → 调度器执行 → 文件删除 → done**
   
   - Given: 磁盘上存在媒体文件
   - When: POST /v1/tasks { actionType: "delete" }
   - Then: 任务 status 流转 `created → queued → executing → done`，文件被删除

10. **删除任务 → pause → 验证暂停 → execute → 继续执行**
    
    - Given: 执行中的删除任务
    - When: PATCH pause → 验证 paused → PATCH execute
    - Then: 暂停后恢复，最终 done

11. **删除任务 → cancel → 验证取消**
    
    - Given: 执行中的删除任务
    - When: DELETE /v1/tasks/:id
    - Then: 任务被取消，文件未被完全删除

12. **删除不存在的文件 → 优雅失败**
    
    - Given: itemId 指向不存在的文件路径
    - When: 创建 delete 任务
    - Then: 任务不崩溃，status 转到 failed_hard，log 记录具体错误

### Transcode Flow（4 用例）

13. **创建转码任务 → ffmpeg 编码 → 替换原文件 → done**
    
    - Given: 磁盘上存在可转码的媒体文件，ffmpeg 可用
    - When: POST /v1/tasks { actionType: "transcode" }
    - Then: 任务完成，输出文件码率低于输入，status=done

14. **指定编码设备转码 → probe output codec**
    
    - Given: transcodeEncodingDevices 配置了 QSV/NVENC 设备
    - When: 创建转码任务
    - Then: ffprobe 输出显示使用了期望的编码器（h264_qsv/hevc_nvenc 等）

15. **转码中途 pause → resume → 完整完成**
    
    - Given: 正在编码中的转码任务
    - When: PATCH pause → 验证 ffmpeg 进程终止 → PATCH execute
    - Then: 恢复后从断点继续，最终完成

16. **转码 cancel → 清理临时文件**
    
    - Given: 正在编码中的转码任务
    - When: DELETE /v1/tasks/:id
    - Then: ffmpeg 进程被 kill，临时文件被清理，transcodeTempRoot 下无残留

### Upgrade Flow（5 用例）

17. **完整升级 golden path**
    
    - Given: MoviePilot 可达，Emby 可达，库中有 1080p 媒体
    - When: POST upgrade → planning（搜索种子）→ select index → confirm → download → scrape → pre-replace verify → confirm → replace → done
    - Then: 全部阶段通过，status=done，新文件存在

18. **搜索无结果 → 优雅失败**
    
    - Given: MoviePilot 可达但搜索词无结果
    - When: POST upgrade task 对冷门电影
    - Then: planning 阶段记录"no candidates"，status=failed_hard

19. **手动模式：等待 execute**
    
    - Given: executionMode="manual"
    - When: POST upgrade task
    - Then: status=pending_manual，不自动调度。手动 execute 后才进入 queued

20. **种子下载失败 → 重试或失败**
    
    - Given: 选中的种子下载失败（MP 侧）
    - When: 任务在 upgrade_executing 阶段
    - Then: 检测到下载失败，记录日志，可选重试或 failed_hard

21. **下载文件被 MP 自动删除 → seenBefore 检测**
    
    - Given: 下载完成后文件被 MoviePilot 自动清理
    - When: exec loop 轮询文件状态
    - Then: seenBefore flag 正确检测文件消失，任务继续流转而非卡死

### Media Library Flow（3 用例）

22. **Emby 同步拉取新媒体 → items 出现在 library**
    
    - Given: Emby 服务器有新电影
    - When: subLibrary refresh timer 触发
    - Then: `GET /v1/library?subLibraryId=X` 返回新增 items

23. **Douban 同步附加评分 → action 重新计算**
    
    - Given: 库中有未评分的电影，Douban 同步启用
    - When: Douban timer 触发
    - Then: doubanRating 字段被填充，action 从 keep 变为 upgrade/transcode/delete

24. **用户评分 → action 实时更新**
    
    - Given: 库中某电影为 keep（无评分）
    - When: PATCH /v1/library/items/:id/ratings { userRating: 5 }
    - Then: userRating=5，action 重新计算（4K 高码率 → upgrade）

---

## §4 测试基础设施

### 目录结构

```
tests/
  common.sh                          # 共享工具函数
  runner.sh                          # 主调度器: ./runner.sh [flows] [env]
  env/
    local-win.env                    # SERVICE_URL=http://127.0.0.1:18080
    docker-fn.env                    # SERVICE_URL=http://<飞牛IP>:18080
    ci.env                           # CI 用，无外部依赖
  flows/
    test-health-check.sh             # Tier 3 — Health Check flow
    test-task-crud.sh               # Tier 3 — Task CRUD flow
    test-config-roundtrip.sh        # Tier 3 — Config Roundtrip flow
    test-delete-flow.sh             # Tier 3 — Delete flow E2E
    test-transcode-flow.sh          # Tier 3 — Transcode flow E2E
    test-upgrade-flow.sh            # Tier 3 — Upgrade flow E2E
    test-media-library-flow.sh      # Tier 3 — Media Library flow E2E
```

### 约定

- 每个脚本独立可运行（可直接 `bash tests/flows/test-health-check.sh`）
- 使用 `curl` + `jq`（无 node 依赖，任何 shell 可跑）
- 输出格式：`ok N - description` / `not ok N - description`（TAP-like）
- 退出码 = 失败数（exit 0 = 全部通过）
- `SERVICE_URL` 环境变量控制目标
- `SERVICE_URL` 未设置时默认 `http://127.0.0.1:18080`

### common.sh API

```bash
# 引入
source "$(dirname "$0")/../common.sh"

# 断言
assert_eq "description" "$actual" "$expected"
assert_contains "description" "$haystack" "$needle"
assert_status "description" "$response" "200"

# 辅助
wait_for_health          # 轮询直到 /v1/health 返回 200，最多 30s
wait_for_task_status "$task_id" "$expected_status"  # 轮询任务状态，最多 60s
create_task "$item_id" "$action_type"   # 创建任务，返回 task JSON
get_task "$task_id"      # 获取任务详情
poll_task_until "$task_id" "$predicate" "$timeout"  # 通用轮询
```

---

## 关联文档

- `docs/v2/DEVELOPMENT_WORKFLOW.md` — 开发工作流（§3 Testing Matrix）
- `docs/v2/RELEASE_WORKFLOW.md` — 发版工作流
- `tests/` — 测试脚本和 fixtures
