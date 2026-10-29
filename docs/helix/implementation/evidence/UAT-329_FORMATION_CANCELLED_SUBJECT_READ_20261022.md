# UAT-329 取消整理任务后媒体整理工作区整体 500 — 2026-10-22

状态：根因已定位并修复，`3.1.0-hostfix4` 已部署；待用户浏览器现场复验。
生产 `192.168.12.230:18080`，修复前镜像 `markmahoro/shelfdeck:3.1.0-hostfix3`（commit `2664b4014`）。

## 用户可见问题

用户在同一时间取消两个整理任务后：

- 整个“媒体整理工作区”看起来被清空；
- 页面显示 `Clean Service请求处理失败。`（服务端 500 的统一文案）；
- 取消动作本身成功，收藏、历史、人物数据均未丢失。

## 现场与只读定位

| 检查 | 修复前 |
| --- | --- |
| `GET /v1/health` | 200，`normalSupplyAllowed=true` |
| `GET /v1/admin/formation?section=active` | **500** |
| `GET /v1/admin/formation?section=completed` | **500** |
| `GET /v1/admin/formation?section=ended` | **500** |
| `GET /v1/admin/care`、`jav-corrections` | 200 |
| 两个已取消 Subject 的 `GET /v1/admin/formation/:id` | **500** |
| 另一个正常 Subject 的详情 | 200 |

数据库只读核对：两个 Subject 均为 `status=abandoned`，对应 Run 为 `discarded`，取消记录 `state=completed`，没有 Package；`arca_shelf_entries` 与 `people_persons` 计数保持。

排查期间只使用只读连接；容器内 `/tmp` 的临时诊断副本已按精确路径删除，没有下载生产库、没有回写生产、没有修改生产数据。

## 根因

1. Formation 读取模型在 `buildBatch` 中为这一批**所有** Subject 读取 Perception 评分：
   `media-service/src/helix/domains/libra/application/formation-query.js`（修复前直接 `subjects.map(...)`）。
2. 评分目标由 `routingContextReader.ratingTarget` 提供；其 `subjectSnapshot` 对非 `active` Subject 抛
   `Routing requires an active accepted Subject.`
   （`media-service/src/helix/domains/libra/application/routing-context-reader.js:98`）。
3. 因此任何一个已取消 Subject 进入批次，列表、详情和后台投影 sweep 都会抛错：
   - 列表/详情 → 500；
   - 投影 host 每 30 秒 sweep 同一批次 → 日志持续刷同一句，投影长期停在旧行。

这是 Formation 读取组合的缺陷，不是取消流程写错，也不是 Perception/Routing 的 active 守卫应被放宽。

## 修复

提交 `b70a9f6f6` `fix(libra): stop rating cancelled subjects from failing Formation`：

- `buildBatch` 只为 `status='active'` 的 Subject 请求评分；已取消 Subject 不再成为评分目标，`myRating` 为 `null`；
- 保留 Routing/Perception 对非 active Subject 的既有守卫，不增加 silent fallback；
- 新增回归用例 `Formation never asks Perception to rate a cancelled Subject`：
  用与生产一致的 `Routing requires an active accepted Subject.` 抛错 reader，验证
  - 投影 host 的 `buildBatch` 不再因取消任务失败；
  - 已取消 Subject 详情可读且无评分；
  - 正常 active Subject 仍读取评分。

## 本地验证

| 套件 | 结果 |
| --- | --- |
| 完整 Service 测试 | 680 tests / 651 pass / 29 既有 skip / 0 fail |
| `helix-formation-projection.test.js` | 35 pass（含新增回归） |
| `formation-cancel-reprocurement.test.js` | 6 pass（普通/无 Run/排除/退休 Field 取消链） |
| `helix-formation-status-projection.test.js` | 1 pass |
| `uat318-formation-overview.test.js`、`p14-formation-truth.test.js`、`formation-task-retry.test.js` | 通过 |

## 生产部署事实

| 项 | 值 |
| --- | --- |
| Image | `markmahoro/shelfdeck:3.1.0-hostfix4` |
| Image ID | `sha256:d94bcda0875bc51059dfa601f5fec3b0f220d9b0925029fadd75886c649a886e` |
| Git commit | `b70a9f6f6` |
| Tarball SHA-256 | `853847a8bd8a7461c9728b99a9ab6907987b83492baff9aa7853517b2a37ab68` |
| Container StartedAt | `2026-10-22T13:36:23.592497675Z`（21:36:23 Asia/Shanghai） |
| RestartCount | 0 |
| 冷备 | `/vol1/1000/docker/shelfdeck/backups/pre-3.1.0-hostfix4-20261022-212343`（194 文件、4.3G，含 compose/secret/receipt；`shelfdeck.db` SHA-256 `58052d1577e41cdf501df875637534bb8d81582ba8050f6e6ce99ac5773b4944`） |

部署使用 `scripts/build-image.js`、`scripts/upload-nas-image.js`、`scripts/deploy-nas.js`（校验 tar SHA-256、readiness、挂载和镜像来源），停服期间完成冷备后 apply。

## 部署后复核

- `formation active/completed/ended`、两个已取消 Subject 详情、`care`、`jav-corrections`、`overview`、`health` 均为 **200**；
- 两个已取消 Subject 不出现在 active 列表（`CANCELLED_PRESENT 0`），详情仍可打开；
- Formation projection `ready`（启动 sweep 完成后 overview 由临时 503 恢复 200）；
- 日志自启动起只有 listening 行，`Routing requires an active accepted Subject.` 及其他 runtime error 为 0；
- `arca_shelf_entries` 681、`people_persons` 31,241，取消记录仍为 2 条 `completed`。

## 未完成与风险

- 需要用户在实际浏览器复验“取消整理任务 → 工作区不空、无 500”的用户路径；
- 本次未改 schema、未迁移数据、未 Reset、未删除媒体；回滚只需回到 hostfix3 镜像（冷备保留）。
