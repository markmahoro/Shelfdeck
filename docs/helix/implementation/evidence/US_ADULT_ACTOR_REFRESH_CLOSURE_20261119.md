# US Adult 演员刷新 CIFS 暂存、前置失败/漂移收口与 Care 投影修复验证记录

- **日期**：2026-11-19
- **分支**：`sd/us-adult-actor-refresh-closure-20261119`（基于 `main` `cf852a4f72626fdaf9bc1a50feb8d16379d2fb7a`）
- **部署状态**：**未部署**（按用户指令仅完成代码修复、Linux 验证、证据沉淀与 PR 创建，不触碰 `heavy` `192.168.12.215:18080` 生产运行与数据）

## 1. 生产卡死故障背景（只读排查，未修改生产数据）

- 目标条目：`Bruce&Morgan TLII-068 Tia Ling`（Shelf `US_Adult`，`shelf_entry_id = e72d0565d7d853b38de8f8ee10be0ff6f6f8aa9e4cce3e7d44fb121079a24c24`，`/adult/US_Scrapped/Bruce&Morgan TLII-068 Tia Ling`）。
- 卡死 Case：`arca-care-ffea4afc7b6d77aee3e97d5acb445c7118b11ecf`（`user_actor_refresh`，`mode = "specified"`，目标演员 `Tia Ling`，`state = 'active'`），占用全局唯一 Care 席位（`caseCapacity = 1`），阻塞队列中 3 个后续维护 Case（`arca-care-5385be7a...`、`arca-care-5181018c...`、`arca-care-9fc33143...`）。
- 卡死 Supporting Work：`arca-us-stage-work-8720c9f8cc04e969812a418b09f1ffcf6766cdfcc783cb23ff5c3a987736d743`（`us_adult_actor_stage`，`arca.us_adult.files.stage@1`），以 `failure_code = P4_EVENT_RECOVERY_REALITY_CONFLICT` 终止，底层 Effect recovery 读取失败错误为 `EINVAL`（发生在 CIFS SMB 3.0 挂载参数 `vers=3.0,cache=strict,nounix,serverino,mapposix,actimeo=1,closetimeo=1` 下）。

## 2. 根因分析与代码修改

1. **CIFS SMB 3.0 下 `ctimeNs` 抖动与 `.part` 写句柄未 sync/关闭导致 `EINVAL` / 误判漂移**：
   - 修改 [`us-adult-inventory-files.js`](../../../media-service/src/helix/integrations/us-adult-inventory-files.js)：
     - 重写 `fullDigest(location, check)`：改为显式 `fs.promises.open(location, 'r')` + `handle.stat({ bigint: true })` + 256 KiB 分块 `handle.read` + `finally { await handle.close(); }`，并在关闭后执行 `lstatSync` 前后对比，统一对比 `['dev', 'ino', 'size', 'mtimeNs']`（忽略 CIFS 硬链接或元数据缓存刷新的 `ctimeNs`）。
     - 新增 `copyStageTemporaryExclusive(source, part, check)`：通过 `'wx'` + 分块写入 + `await outHandle.sync()` + `finally` 关闭全部读写描述符，避免 `closetimeo=1` 写后立即校验触发 CIFS `EINVAL` 或句柄残留。
     - 更新 `stage()`：在首次运行且 `.shelfdeck-us-...-stage` 目录尚不存在时，若只读 `preflight()` 在未建目录、未写字节前抛出 `ARCA_US_ADULT_STAGE_CONFLICT` / `ARCA_US_ADULT_FILE_CHANGED` / `ARCA_US_ADULT_FILE_ESCAPE` 且失败后目录仍不存在，标记 `details = { effectWriteStarted: false, boundary: 'before_stage' }`。
2. **Effect recovery 将瞬时 CIFS / 文件系统 I/O 错误直接判为不可恢复 `conflict`**：
   - 修改 [`us-adult-actor-pipeline-ports.js`](../../../media-service/src/helix/domains/arca/capabilities/us-adult-actor-pipeline-ports.js)：
     - 新增 `OBSERVATION_IO_CODES`（包含 `EINVAL`、`EIO`、`EAGAIN`、`EBUSY`、`ESTALE`、`ENOENT`、`ETIMEDOUT`、`PHYSICAL_MATERIAL_FINGERPRINT_IO_FAILED`、`PHYSICAL_MATERIAL_STAT_FENCE_CHANGED`、`PHYSICAL_MATERIAL_FINGERPRINT_SHORT_READ` 等）；当 `observeEffectReality()` 遇到上述瞬时/I/O 错误时返回 `status: 'unobservable'`（由调解器走 `observe_again`），而真正的未知文件、源篡改、权限/不变量冲突仍保留 `conflict`。
     - 统一 `PRECONDITION_FAILURES` 映射，支持 `before_stage`（`arca.actor-stage-precondition@1`）与 `before_publication`（`arca.actor-publication-precondition@1`）返回确定无写入 `failed` Outcome（`placement_precondition` / `retryDirective: 'never'`）。
3. **缺 Stage 前置无写入收口与 Basis/Fencing 漂移分级收口（遵循 SSOT §6.6.8，绝不静默丢弃已写入临时材料）**：
   - 修改 [`actor-publication-failure.js`](../../../media-service/src/helix/domains/arca/persistence/actor-publication-failure.js) 与 [`aftercare-store.js`](../../../media-service/src/helix/domains/arca/persistence/aftercare-store.js)：
     - 支持 `before_stage` 无写入证明（`arca.actor-stage-precondition@1` / `arca.actor-prestage-terminal@1`），在 `fx_supporting_works` 中核验仅存在该唯一 failed `us_adult_actor_stage` Work 且不存在任何 `publish` / `verify` / `commit` / `retire` / `close` / `discard` Work，并禁止在 `before_stage` 中伪造 `discard`；同时保持 `before_publication` 必须附带已提交 `discard` Work/Result 的原有强约束不变，并修正缺省 `discardRecord` 先触发 `P3_JCS_NON_JSON_VALUE` 而非 `ARCA_US_ADULT_FAILURE_CLOSURE_UNPROVEN` 的边界问题。
   - 修改 [`us-adult-actor-pipeline-query.js`](../../../media-service/src/helix/domains/arca/application/us-adult-actor-pipeline-query.js) 与 [`us-adult-actor-refresh-coordinator.js`](../../../media-service/src/helix/domains/arca/application/us-adult-actor-refresh-coordinator.js)：
     - `inspect()` 识别 `snapshot.stageFailure`，`coordinator.reconcile()` 在确认无写入证明后以 `unresolved` 终态关闭 Case、释放全局 Care 席位并允许重新发起刷新。
     - 当 `queued` 或 `stage` 及后续正式阶段尚未建立（无 `stage`/`publish`/`verify`/`commit`/`retire`/`close`/`discard` Work 与 Commit）时发生 `modificationBlocked` 或 `ARCA_US_ADULT_REFRESH_EXECUTION_STALE` / `ARCA_US_ADULT_PHASE_PROOF_INVALID` 漂移，先排空前置只读/Workspace 准备 Work，随后将 Case 置为 `invalidated` 并调度 Workspace 回收；一旦正式 `stage`+ 已存在，严禁提前结案，统一返回 `actor_refresh_attention_required` 并保持 Case `active`。
   - 同步补充 [`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`](../../TOP_DOWN_ARCHITECTURE_CONFIRMATION.md) §6.6.8（第 6138 行原地补充，不改变 §8 行号与契约基准）。
4. **`us_adult_actor_*` 在 `/formation` 工作区进度与详情投影缺失**：
   - 修改 [`aftercare-process-projection.js`](../../../media-service/src/helix/domains/arca/application/aftercare-process-projection.js) 与 [`aftercare-process-coordinator.js`](../../../media-service/src/helix/domains/arca/application/aftercare-process-coordinator.js)：
     - 为 10 类 `us_adult_actor_*` Supporting Work 及 9 类 `arca.us_adult.*@1` Capability 增加 `aftercare_process_actual_plans@1` 阶段与步骤中文投影文案。
     - 更新 `caseDetail`、`caseProgress`（含失败态 `waiting_for_recovery`、进行态 `preparing_media` / `committing_inventory` / `waiting_for_resource` 等）与 `stopForModificationFence`（存在正式阶段后不强制 `invalidated`）。
5. **测试**：
   - 扩展 [`us-adult-inventory-files.test.js`](../../../media-service/test/helix-architecture/us-adult-inventory-files.test.js)（+2 个测试：CIFS `ctimeNs` 抖动 + `.part` 写句柄关闭校验；仅全新无 `stage` 目录首次失败附带 `before_stage` 证明）。
   - 新增 [`us-adult-actor-refresh-closure.test.js`](../../../media-service/test/helix-architecture/us-adult-actor-refresh-closure.test.js)（5 个测试：瞬时 I/O → `unobservable` vs 真冲突 → `conflict`；`before_stage` 无写入 `unresolved` 收口与防伪造；`before_publication` 仍强校验 completed `discard` 回归；Basis 漂移进入 `stage` 前 `drain -> invalidated` 与进入 `stage` 后 `actor_refresh_attention_required` 保活；`caseDetail` / `caseProgress` 对 `us_adult_actor_*` 活性执行与失败投影）。

## 3. 验证记录（Linux `worker` `192.168.12.216`，Node.js v22.23.5）

所有验证均在 `worker` 隔离临时 git worktree `/tmp/sd-verify-actor-refresh-closure` 内完成（验证结束后已执行 `git worktree remove --force` 与 `git worktree prune` 清理）。

1. **RED 基线（仅写入测试、产品代码尚未修改，`cf852a4f7` 基线）**：
   - 命令：`node --test --test-concurrency=2 test/helix-architecture/us-adult-inventory-files.test.js test/helix-architecture/us-adult-actor-refresh-closure.test.js`
   - 结果：`17 tests: 11 passed, 6 failed`（全部 6 个新增测试均按预期 RED 失败，原有 11 个测试通过）。
2. **GREEN 目标专项测试（最终代码修改后复跑）**：
   - 命令：`node --test --test-concurrency=2 test/helix-architecture/us-adult-inventory-files.test.js test/helix-architecture/us-adult-actor-refresh-closure.test.js`
   - 结果：**`18 tests: 18 passed, 0 failed`**（含新增与既有 11 个文件效果测试，以及新增的 `before_publication` + `discard` 回归测试）。
3. **回归与架构门禁批量测试（最终代码修改后复跑，17 个测试文件，`--test-concurrency=2`）**：
   - 范围：`us-adult-inventory-files.test.js`、`us-adult-actor-refresh-closure.test.js`、`us-adult-actor-refresh-intent.test.js`、`us-adult-inventory-source.test.js`、`p15-current-action-summary.test.js`、`p15-aftercare-process-detail.test.js`、`p15-aftercare-state-machine-safety.test.js`、`p15-aftercare-effects-safety.test.js`、`p15-aftercare-contract.test.js`、`p15-aftercare-case-generation.test.js`、`p15-aftercare-workspace-lifecycle.test.js`、`p15-aftercare-workspace-safety.test.js`、`p15-aftercare-projection-source.test.js`、`p15-care-work-query.test.js`、`p4-bounded-catalog-transition.test.js`、`package-boundary-guard.test.js`、`forbidden-semantic-guard.test.js`。
   - 结果：**`247 subtests: 247 passed, 0 failed`**。
4. **全仓静态门禁与 SSOT / P2 基准核对（最终修改后复跑）**：
   - `checkForbiddenSemantics`：`ok: true`，`2804 filesChecked`，`0 findings`。
   - `checkPackageBoundaries`：`24` 项均为 `main` 基线中既有非 Arca 文件发现（`composition/create-procurement-execution-runtime.js`、`libra/*`、`people/*`、`buffalo-face-catalogue.js`、`us-adult-catalogue-*`、`operator-*`），**本次修改文件与 `domains/arca/` 目录 `0 findings`**。
   - `checkPersistenceBoundaries`：`5` 项均为 `main` 基线既有非 Arca 发现（`buffalo-face-catalogue.js`、`us-adult-catalogue-install.js`、`formation-retirement-history-integrity.js`），**本次修改文件与 `domains/arca/` 目录 `0 findings`**。
   - `extractSsotContracts`：与 `main`（`cf852a4f7`）相比，`counts`（`139/118/242/65`）、`categoryDigests` 与 `aggregateDigest` **完全一致**。
   - `main` 既有基线差异说明（非本次改动引入，于未修改 `cf852a4f7` 上已复现）：`p2-contract-baseline-validator.test.js`（0/3 fail：`Missing transaction contract definition: US Adult Catalogue Basis Freeze`）、`manifest-validator.test.js`（subtests 1 & 4 `REUSE_SOURCE_EVIDENCE_MISMATCH`），以及 6 个依赖共享 `fixtures/us-adult-actor-refresh-store-context.js` 的旧测试文件在加载阶段即抛出 `P3_DDL_UNSUPPORTED_JSON_CONTRACT:libra_us_adult_catalogue_actor_decisions.decision_json`（其中原 `us-adult-publication-failure.test.js` 覆盖的 `before_publication` 契约已由 `us-adult-actor-refresh-closure.test.js` 独立补测验证通过）。
5. **Layer 1 Clean Service Host 启动与 HTTP 实测（`worker` 隔离 `/tmp/sd-layer1-*` 与临时端口）**：
   - `createCleanServiceHost` 启动成功（`routeCount: 167`，测试结束后 `host.close()` 干净退出）。
   - `GET /v1/health` → `200`（`{ status: 'ok', generation: 'helix-clean-v3', normalSupplyAllowed: true }`）。
   - `POST /v1/admin/session`（`X-Api-Key`）→ `204` 并签发同源会话 Cookie。
   - `GET /v1/admin/care`（携带 Cookie）→ `200`（`keys: ['items', 'counts', 'incidents']`）；`GET /admin` → `200`。

## 4. Playbook §12.3 与未覆盖风险说明

- **Playbook §12.3 精确版本 UI Review 说明**：本次未改动 `media-service/web/**` 前端产物，但在 [`aftercare-process-projection.js`](../../../media-service/src/helix/domains/arca/application/aftercare-process-projection.js) 中为 `aftercare_process_actual_plans@1` 新增了 `us_adult_actor_*` 后端投影中文展示文案；依据 `ENGINEERING_PLAYBOOK.md` §12.3，发版前需由 UI owner 按精确构建版本对工作区任务详情展示进行复核。
- **未覆盖风险**：
  1. 本次按要求暂未构建/部署至真实 NAS，因此真实 CIFS SMB 3.0 共享卷下的 Layer 3 端到端实测尚未执行。
  2. 生产库 `heavy`（`192.168.12.215`）上已卡死的历史 Case `arca-care-ffea4afc7b6d77aee3e97d5acb445c7118b11ecf`（`TLII-068`）保持未动；从代码语义推断，若未来上线该修复，仍取决于当前磁盘上 `.shelfdeck-us-...-stage` 目录状态：若瞬时 `EINVAL` 不再被固化为 `conflict` 且目录中为有效前缀/已 staged 文件则可继续/恢复，若已存在冲突 stage 文件则会保持 `active` 并上报清晰错误，不会静默删改 `/adult` 现场。
