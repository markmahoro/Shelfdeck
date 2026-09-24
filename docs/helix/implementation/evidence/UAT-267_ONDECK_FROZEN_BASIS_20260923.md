# UAT-267 Accepted On-deck 冻结依据与三片恢复

状态：独立代码提交 `8ec0f3990` 已完成本地相关验证；未合入统一发布区，未部署或修改生产，三条 Run 未恢复。基线 `591a3d10d`（含生产源码 `3fff5f7dc3`）。

## 现场、合同与范围

2026-09-23 生产只读事实：Shelf Standard 于 13:01:56Z 从 revision 1 升至 2，三条已 Accepted 的 Arca Decision、Receipt、Custody 和 Final Inventory Decision 均冻结 `standard_revision=1`、`placement_revision=2`；13:02:40Z 三个 Event 以 `P4_EVENT_INPUT_PREPARATION_FAILED` 失败，日志为 `Arca Acceptance has not established On-deck responsibility.`。精确 Run：

| 影片 | On-deck Run | 失败阶段 |
| --- | --- | --- |
| 《生死豪情》(1996) | `12641ecd7cf9348d4d2705ca174675a67676e23a0badf82d1c9d89b5a752fbf4` | `staged_verify` |
| 《东北警察故事2》(2023) | `1f9f5ea0e02f414049dc6e56719c99c73ddcaa271617d3c73fda345f73c29963` | `final_product_verify` |
| 《驾驶我的车》(2021) | `b61d48314b245e25973fecf719f2e66d5c1078678a24466820dfb60abe852ab8` | `on_deck_commit` |

SSOT §5.6.6 要求 Arca Accepted 后当前 On-deck Run 按冻结 Basis 完成；Commit 建立 Shelf Entry 后由 Aftercare 按新 Standard 重评。首个缺陷在 `on-deck-context-reader.readAccepted` 用当前 Shelf revision 重算 Attempt ID；`readSettlement` 又比较当前 revision。协调器重放、Acceptance 完成后的恢复接线、Stage 历史观察、最终验证投影和 Deck Fact 写入也需保持同一冻结依据。新 Handoff B Acceptance 仍以当前活跃 Shelf/Standard 及当前 Control 做首次 Fence。

另一个可见问题是失败 Work 仍可能处于 `offloading` Run，Arca 状态只识别 `blocked`，列表及汇总误报 `in_progress`。UI 负责人已确认：只有当前明确失败的 On-deck Work 投影为 `attention_required`；恢复运行或完成后按事实回落，沿用现有短状态，不改变列表布局或创造人工调度语义。

UI 负责人复查代码提交 `8ec0f3990` 和定向测试后确认状态投影/UI 语义通过：先认定有效 Commit/Entry/Deck，随后仅对无开放 Work 且最新 Work `failed` 的 On-deck Run 标为需要处理；活动 Work 及已完成 Commit 保持各自事实。该复查不替代架构、完整 E2E 或生产验收。

## 实现与边界

- Arca Shelf Query 从不可变 Standard/Placement revision 行读取已接受 Basis；Owner 持久化 Run→Custody→Decision→Attempt 与 Handoff B Receipt 仍需强校验。丢失、伪造、超前 revision 均明确失败。
- On-deck 执行、Settlement、历史重放和 Acceptance 完成后的 Run 接线使用上述冻结 Basis，投影、Fulfillment 和 Deck Fact 的 revision 保持 1。当前 Shelf 可用状态、目标 endpoint/root containment、Final Inventory Decision、Material Control 与物理 Effect Fence 继续核验；目标改到冻结路径之外即拒绝。
- Formation 状态按 Foundation 正式 Work status 识别当前失败；已有 Commit/Entry/Deck Fact 优先于历史失败 Work，活动新 Work 优先于旧失败 Work。页面状态与汇总共用当前 Arca 状态读数。
- 无 Schema 变更、旧 Decision/Receipt 改写、跨 Owner Store、自动 Reset 或成功假象。三片仍须由现有 On-deck 正式恢复路径推进，不直接改 Event/Work/数据库。

## 生产副本门禁与发布负责人执行顺序

1. 生产只读重核三条 Run、Offer、Acceptance Attempt/Decision/Receipt/Custody、Final Inventory Decision、Work/Attempt/Event/Effect、当前 Shelf/Standard/Placement、目标文件及 Material Control。锁定备份时点；若已经由正常流程恢复或事实变化，重新制订该片范围。生产副本使用停服或 quiesced 的一致备份及候选镜像，保留原备份与源码身份。
2. 在隔离副本启动完整 Host，验证 Catalog/Schema readiness、健康、三条冻结 revision 1 可读、Standard head 2 不回写旧 Decision、失败状态及 `attentionRequiredCount` 一致。副本不能挂载生产可写媒体。对真实 Effect 的演练必须使用与生产隔离且保留 inode/挂载身份的文件系统快照或等价完整克隆；仅复制 SQLite 和文件内容会触发物理身份 Fence，不能拿这种失败证明修复无效，也不能改副本身份行来绕过 Fence。对本地完整测试未绿项在 `591a3d10d` 对照环境复测，厘清既有失败与本次回归；不可把未诊断失败计作过闸。
3. 在可写隔离物理副本逐阶段跑正常继续、正式自动恢复及必要的用户 Retry：`staged_verify` 重放 Stage 与验证，`final_product_verify` 复核 Placement Receipt/最终文件后验证，`on_deck_commit` 先收敛未决 Effect 再 Commit。负向注入错误 Package digest、缺失历史 revision/Receipt、目标 root 漂移、文件身份漂移和 Control 变更，必须拒绝且没有额外上架/删除。每片检查唯一 Commit/Entry/Deck Fact、冻结 Deck `standard_revision=1`、后续 Aftercare revision 2 Finding/Case；其他收藏及原媒体不变。任一门禁不通过则停止生产发布/恢复，保留副本证据。
4. 统一部署负责人按标准镜像 build/upload/SHA256/dry-run/apply 发布，并核对完整 Host、健康、挂载、Secret、旧收藏及三条原事实。发布身份与 E2E 结果写入 `docs/v3/CURRENT_STATUS.md`；UAT-267 仍待三片实际恢复与用户可见验收，不以代码或部署关闭。

## 三条正式恢复操作

发布后先由 Owner 只读定位每个 Run 的精确 Offer ID、最新 Work 与 generation、未决 Effect、Final Inventory Decision 和 Material Control。允许启动恢复协调器自动扫描旧失败 Work：若 Run 仍 `offloading`，正式流程先将其 CAS 为 `blocked`，再在三代上限内以新 Work 恢复；服务重启不重复计数或跳过 Fence。若已稳定 `blocked` 且自动预算用尽，才对该片当前 Offer 使用 `POST /v1/admin/formation/acceptance/:offerId/actions/retry`；调用前核对页面资格与当前授权，禁止直接编辑状态、旧 Event 重放或 Reset。逐片串行并在上一片事实收敛后再处理下一片：

1. 《生死豪情》：先核 Stage slot/未决 stage Effect 和临时文件，按原 Target Commit Slot/Final Decision 执行 `staged_verify` 后续链；不能把尚存临时输出当作空 slot 清理。
2. 《东北警察故事2》：先核 Placement Receipt、目标成品身份和原输入引用；`final_product_verify` 从既有 Placement 事实继续，避免重复切换或误删原输入。
3. 《驾驶我的车》：先核 `on_deck_commit` 是否已有 Commit Receipt、Entry/Deck、Foundation Effect/Marker；已有合法 Commit 只做正式 reconcile/finalize，未提交且无未决不可判定 Effect 才允许新 generation Commit。

每片收口均需唯一 On-deck Commit、Shelf Entry、active Deck Fact、精确 Inventory 文件及 Control/Settlement 终态；页面分类、summary、currentPlan 同步，Aftercare 在 Standard revision 2 下新评估。任何未知 Effect、物理身份漂移或授权缺口停止该片，保留原事实交 Owner 调查。

## 本地验证与剩余风险

交付提交 `8ec0f3990`。`node --test` 运行 On-deck/Formation/恢复/Stage 8 个文件，**80/80 通过**，覆盖冻结 Shelf revision 读取、三种失败阶段投影、不可变 Receipt/Decision 与跨包负向、当前 Target containment、失败 Work→attention→活动恢复、列表汇总一致及原有自动恢复/用户 Retry 和 Stage 历史安全。相关子集 `p14-arca-shelf-configuration-e2e` 2/2 亦通过。

完整 `npm test` 已执行，退出码 1；失败涉及 Admin 页面断言、旧 Schema 迁移 fixture、`UAT-131` actor-only 场景的 Libra `product_output.select` 结果数预期 1/实际 2 等。后者在创建唯一 On-deck Commit 后才触发断言，不能当成本次三片真实恢复验收；尚未在基线对照环境逐项证明其性质。`npm run test:helix-architecture`：1836项中1826通过、9跳过、1失败；唯一失败为 P5 DV CPU 自检 `pipeline_input_generation_failed`，dependency、semantic、manifests、contracts 均 `ok=true`。未在本任务运行生产副本真实 Effect、Linux/NAS 文件系统、QSV/FFmpeg 或生产浏览器验收；这些是统一部署负责人门禁，不能由本地测试替代。
