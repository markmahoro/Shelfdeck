# JAV 短标题 CIFS Staging 句柄冲突与前置不确定性收敛验证记录

日期：2026-11-19。状态：**Layer 1 与 Layer 2 隔离验证通过（待合入后按授权流程上生产复验真实 CIFS 写入）**。

## 1. 基线与修改范围

- 代码基线：`main` 提交 `cf852a4f7`。
- 问题来源：现网 `heavy`（`192.168.12.215:18080`）上两部长标题 JAV（`HALT-094`、`EMLB-094`）写入 `/adult/JAV/JAV_output`（CIFS SMB 3.0 挂载）时，在 `arca.inventory.product.stage@1` 触发 `CLEAN_ARCA_SHORT_STAGE_UNCERTAIN` 并进入每 30 秒重复 `reconcile_required` → `continue_forward` 死循环。
- 本次改动范围（仅后端执行层与测试，未改动 `media-service/web/**` 或任何展示文案）：
  - `media-service/src/clean-arca-inventory-port.js`
  - `media-service/src/helix/domains/arca/capabilities/on-deck-capability-ports.js`
  - `media-service/src/helix/domains/arca/application/formation-status-projection.js`
  - `media-service/test/helix-architecture/jav-short-first-ondeck.test.js`
  - `media-service/test/helix-formation-status-projection.test.js`
  - `media-service/test/helix-architecture/jav-host-journey.test.js`

## 2. 根因分析

1. **CIFS SMB 3.0 下 `shortenedJavTitle` 的文件描述符与时间戳竞争**：
   - 原 `copyPinnedExclusive` 打开 `.tmp-*`（`wx`）写句柄并 `fsyncSync` 后，**保持写句柄未关闭**即调用 `computeFingerprint(temporary)` 再开只读句柄读取，随后立即比对 `fstatSync(writeFd)` 与 `observed.stat`。在 CIFS/SMB 3.0（`cache=strict,nounix,serverino,mapposix,actimeo=1,closetimeo=1`）上，写句柄的最终写入时间戳在 `close(writeFd)` 时才落盘，导致 `held.mtimeNs !== observed.stat.mtimeNs` 抛出 `CLEAN_ARCA_SHORT_STAGE_UNCERTAIN`。
   - `requireShortStage` 与 Stage manifest 校验在硬链接 publish 后继续比对 `ctimeNs`（`linkSync` 增加链接数与缓存属性会触发 `ctimeNs` 偏移）。
   - `switchShortenedJav` 第二轮清理在 `fs.unlinkSync(item.location)` 与 `fs.rmdirSync(handle.slotDirectory)` 之前未关闭对应只读 pin 句柄，在 CIFS 上存在 silly-rename / `EBUSY` 风险。
2. **前置 `CLEAN_ARCA_SHORT_*_UNCERTAIN` 未在 Capability Port 收口，以及写入前/中边界保护**：
   - `on-deck-capability-ports.js` 此前只为 `C.stagedVerify` 映射 `shortenedStageObservationFailureOutcome`，未在 `C.slot`、`C.stage`、`C.placement` 处理严格写入前（`preWrite: true`）的 `CLEAN_ARCA_SHORT_STAGE_UNCERTAIN` / `CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN`；同时 `formation-status-projection.js` 的 `NON_RETRYABLE` 缺少 `CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN`。
   - 根据 Foundation `EventRuntime`（`abandonUncommitted`）与 `TerminalStageHistoryObserver`（`observeEmptyStageSlot`）契约：**只有严格尚未执行任何物理写入且非 `continue_forward` 恢复的前置拒入**（如进场前发现 `.shelfdeck-stage-*` 已有未分类成员/符号链接、`targetDirectory` 提前出现等）才允许返回 `{ kind: 'failed', retryDirective: 'never' }` 并由 `EventRuntime` 将 Effect 置为 `failed`；写入中途发生的描述符不确定性及 `continue_forward` 恢复必须继续抛出以保留 `fx_effect_journal.state = 'reconcile_required'`，防止伪造无写入或后续重启触发 `PLAN_CATALOG_DRIFT`。

## 3. RED-first 复现（修改产品代码前，基于 `cf852a4f7`）

在隔离 Linux（`192.168.12.216` Node `v22.23.5`）工作树 `/tmp/sd-jav-cifs-verify` 上仅应用测试改动、未改产品代码时的失败结果：

| 套件 / 场景 | RED 结果 | 失败点说明 |
| --- | --- | --- |
| `jav-short-first-ondeck.test.js` | 11 通过，2 失败 | CIFS 模拟断言 `.tmp-*` 在指纹读取期存在未关闭写句柄（`1 !== 0`），且 `ports[C.slot]` 直接抛出未收敛的 `CLEAN_ARCA_SHORT_STAGE_UNCERTAIN` |
| `helix-formation-status-projection.test.js` | 0 通过，1 失败 | `CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN` 误报 `retryAvailable: true` |
| `jav-host-journey.test.js`（`unclassified stage temporary`） | 0 通过，1 失败 | 复现现网 `CleanArcaInventoryPortError: The shortened target has an unclassified staged member; its files were retained.`，工作处于循环卡住 |

## 4. GREEN 验证结果（最终改动后，Linux x86_64 Node `v22.23.5` 隔离环境）

所有临时运行完后均已清理 `/tmp/sd-jav-cifs-verify` 与 `/tmp/vs-*`，未触碰原工作目录及生产 NAS。

| 验证层级与命令 | 结果 | 覆盖与说明 |
| --- | --- | --- |
| **Layer 2 · 定向单测与 P4 恢复套件**<br>`node --test jav-short-first-ondeck.test.js jav-title-prefix.test.js p14-formation-truth.test.js p14-terminal-stage-history.test.js empty-stage-slot-observer.test.js p4-event-runtime.test.js p4-startup-recovery.test.js p4-uat165-process-recovery.test.js helix-formation-status-projection.test.js` | **171 通过，0 失败，0 跳过** | 覆盖写关闭后关闭 fd（Linux `/proc/self/fd` 验证 0 打开句柄）、`ctimeNs` 缓存偏移容忍、unlink 前逐个释放 pin、`preWrite: true` 不可重试收敛、写入中途 / `continue_forward` 保持抛出不伪造 `abandonUncommitted`，以及 Projection `NON_RETRYABLE` |
| **Layer 2 · 真实 Service Host + FFmpeg JAV 长标题 E2E**<br>`node --test --test-name-pattern='new JAV long' test/helix-architecture/jav-host-journey.test.js` | **3 通过，0 失败** | 完整 `HALT-094` / 短标题首次 On-deck Commit、目标冲突触发 `canRecheck: true` 后人工处理重新检查 Commit、以及槽位遗留未分类 `.tmp` 时前置收敛为不可重试 `attention_required` 且重启后 `GET /v1/health` `normalSupplyAllowed: true`、无 executing 残留 |
| **Layer 2 · 架构守卫与跨进程崩溃恢复**<br>`package-boundary-guard`、`forbidden-semantic-guard`、`manifest-validator`、`verifyP4RuntimeCrossProcess` | **`arcaBoundaryFindings: 0`、`arcaManifestFindings: 0`、`semanticFindings: 0`、`p4CrossProcessOk: true`** | 另完整跑过一轮 `npm run test:helix-runtime`（全部 470 个 `test/helix-architecture/*.test.js` 执行完成），总门禁仅因 `main` 基线遗留的 `us-adult-catalogue-*` / `operator-*`（`totalMainBoundaryFindings: 24`、`manifestFindings: 62` 及 `US Adult Catalogue Basis Freeze` 合同未闭合）退出 1，Arca 相关 findings 为 0 |
| **Layer 1 · Agent 驱动隔离实机自检**<br>`verify-shelfdeck prove health-admin-session` | **通过（退出码 0）** | `cd web && tsc && vite build` 产出干净 admin-web，并在 `127.0.0.1:44071` 启动真实 `helix-clean-v3` 实例通过全部 7 项健康/Session Cookie 登录登出与 `/admin` 壳校验（`secretsCommitted: false`） |

## 5. 明确未测风险

- **真实 CIFS/SMB 3.0 共享卷物理写入**：本轮所有验证均在隔离 Linux 本地临时目录运行（含基于现网现象构造的 write-close 时间戳延迟、cached `ctimeNs` 与 `/proc/self/fd` 打开句柄断言），尚未对生产 `heavy`（`192.168.12.215`）`/adult/JAV/JAV_output` 挂载点做真实写操作或部署；真实 NAS CIFS 入架验证待本 PR 合入并获授权部署后在 **Layer 3（生产复验）** 执行。
- **既有生产卡住条目（`HALT-094`、`EMLB-094`）**：两者在修复前已在 `/adult/JAV/JAV_output/.shelfdeck-stage-*` 产生物理 `.tmp` 并停留在 `fx_effect_journal.state = 'reconcile_required'`。按既有未完成条目无兼容授权原则，不提供自动接管残缺 `.tmp` 的修复逻辑，待用户授权后走停机备份 + 定向 `--subject-ids` Formation Reset + 清理该 2 个孤儿暂存目录处理。
