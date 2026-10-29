# 电影寻源与用户自定义标准并行实施 Evidence

更新：2026-10-29。分支 `codex/movie-spec-parallel-20261029`，共同基线 `f24164ae0`。用户本轮允许 Phase 2/3 与演员 Phase 4/5 并行。本文件是该并行切片的证据和整合需求，不是新的活动计划、Phase Exit 或生产处置授权。

## 交接与范围

主线程交接的 18 个 Phase 3 源码/测试文件，在改动前逐项与 `phase3-seed-manifest.json` 的 SHA-256 比较，18/18 一致；两份指定 AGENTS 内容 SHA-256 一致。继承内容包括 Run Execution Basis 的目标引用和 schema/registry、Libra Run Admission、Custom Target Fence/Store、Promotion/Delivery Fence 和三个测试夹具。继承文件属于本线程增量，并未清理或覆盖主线程原件。公共 SSOT、全局 DDL、table/capability manifest、当前计划和活动 Phase 均未修改。

## 电影外部候选

只读重算本机既有冻结的 typed Candidate 证据：

| 影片 | 候选 | 可用 | 声明规格达标 | 达标但被挡的事实 |
| --- | ---: | ---: | ---: | --- |
| 黑水（2019） | 34 | 18 | 1 | 无身份 Anchor，做种 7；50,895,362,458 bytes，4K/HEVC/EAC3 Atmos 声明 |
| 三峡好人（2007） | 7 | 6 | 0 | 没有已证明规格达标的 4K 来源 |
| 登堂入室（2012） | 12 | 6 | 4 | 四项均无身份 Anchor，做种分别为 1、1、7、9 |

现存黑水 last-only 安全白名单缓存 SHA-256 `0c3a0eb6d7872b20a247f5c719babad1f9be55b1f4b22bd02a0dcb87373cdef8`，用本分支当前标题/年份函数与冻结 Query `03627c9180a916a0948d9cf9644fd13f128c4339880fde62ae78a9ea85240c60` 隔离重放：19 条中 18 条匹配，1993 年同名片 1 条拒绝。缓存是历史 34 条搜索结果的子集，不证明上表被挡候选的真实身份；另外两片没有相应原始候选，不能因同一错误码推断共同根因。没有请求生产 MoviePilot 搜索、下载或修改缓存。

提交 `64116fad8` 修复独立可复现的电影身份字段问题：空主字段不遮蔽有效备用 TMDB ID/年份；无 ID 标题年份路径要求所有非空年份一致；相互矛盾的 TMDB ID 保留为不同 Anchor 但不可选；明确为剧集或类型冲突不生成电影 Anchor，也不可用。下载 POST 前使用相同检查复验，冲突拒绝发生在提交前。精确 TMDB 身份不因本地化标题或年份别名被额外否决；剧集原覆盖规则未改。该修复不降低规格，也不证明五条历史候选属于目标电影。

## Custom Target 的局部接续

新增内部 `observeLocalMovieMediaGaps`：从完整可重建的标准 Spec、绑定精确 Libra Run/来源 Handle 的 Probe Result 观察源画面与指定音轨的差异；校验 Result/输入绑定摘要，不改原要求、不修改评分、不生成取消大小上限的建议。缺 Probe、主视频尺寸或音轨事实时返回待补证；只返回 source-only 差异，不生成可直接确认的变更：仍须结合已绑定的 edition Evidence、完整路径和安全事实，不能把 1080p 直接当作最终不符合 4K。该观察不代表设备可用、实际加工或 Conformance 已通过，也不直接开放为用户 Preview。

对三片冻结 Probe 和原标准 Spec 做只读隔离重放：黑水与三峡好人各观察到 4K 和音轨两项，登堂入室仅 4K，三者 50 GiB 保留；本次冻结文件没有完整 Result Input Binding，因此重放使用明确标记的受控绑定夹具，**不是**当前生产 Owner/来源资格验证。

继承增量将已发布的精确 custom Intent/Spec 绑定至新 Run 的 `collectionTargetRef`；Admission 在 Libra Owner 内校验当前目标、原始标准、目标完整重建、原 Run、物理材料/绑定/Claims、身份和新鲜 opaque read fence，然后通过既有 Run Admission 事务替代旧 Run。测试夹具确认旧 Run 保留、原始标准与 Material Control 不改、旧 Run 被标记 superseded；这不是生产完整旅程。

本轮进一步修复一个真实可复现的中断缺陷：新 Run 已原子提交但取消旧 Work 前进程中断时，原入口因旧 Run 不再 current 而不能重放。现在显式重放先校验持久 Intent、从原标准/Preview/Intent 完整重建的 Spec、双向 Run 替代关系、初始 Admission Decision 与精确 Run Basis、Foundation marker/Result/evidence，再返回同一 Run 并重新调用原 Owner 作用域的幂等 Work 取消。篡改 Intent、Spec、Basis 或结果证据均拒绝。测试覆盖重复调用、提交后取消抛错、当前 Subject revision 后续变化、源绑定/身份变动、新鲜度冲突；Arca Accepted 场景使用受控公开投影夹具，未声称完整跨 Owner 竞态旅程通过。

此路径尚未接入实际用户入口或 Runtime 自动接续。新 Run 的 Admission 先于旧 Work 取消；`cancelProcessWorks` 返回的 draining 状态目前未形成新 Run 调度屏障，调用后中断也尚无 Runtime 持久恢复入口。不能发布或开启该内部入口。已 Accepted 的 Arca 责任仍必须通过 Arca 的公开责任投影与 read fence 保护；不得用取消 Libra 旧 Run 代替该边界。

## 需要主线程整合的精确缺口

1. **标准目标与评分变化**：当前 `libra_custom_target_heads` 只能引用非空修改集合的 custom Intent，普通 Spec Admission 在存在该 Head 时拒绝，Promotion Fence 也只允许匹配 custom variant；`collectionTargetRef` 虽声明 `standard`，没有可验证的标准 Intent/Head 发布与替代路径。必须由统一合同/存储明确版本化的当前标准目标、显式恢复标准及语义基线变化后的 CAS/重放/保留语义；不能删除 Head、静默沿用旧放宽项，或把旧 custom 目标自动应用到新评分。普通 Acceptance Spec Coordinator/Run Coordinator 还需要区分实际 custom Spec 与其 `originalTarget` 所对应的当前标准，核验新的 Perception/Shelf/身份公开投影；不能只比较两个不同 variant 的 `specDigest`。主线程统一处理公共 SSOT、生成物与存储。
2. **旧 Work/Offer 与自动接续**：在现有 Owner 边界内接入已确认 Intent 的启动与重启扫描；对精确未 Accepted Offer 等待 Arca Withdrawal Receipt，对 Libra 旧 Work 取消、在途 Event/Effect 排空并核验 Control/材料后，允许新 Run 工作。新 Run 当前写为 active，现有 `active-libra-runs` 扫描会调度它；必须由负责共享 Runtime 的线程形成可复验的排空/调度屏障并覆盖提交后各中断点、迟到结果和再次重启，不能靠本地方法返回值充当全局屏障。
3. **真实用户与 Arca 路径**：仍缺从 Owner 当前完整材料、Probe/验证、真实外部搜索与路径结果构造最小差距建议和服务端 Preview/确认；未取得足够证据时显示待补证，不能把候选的 unavailable 当成无资源。尚缺 API/UI、当前版本 UI 负责人验收、实际新 Run 生产/Conformance/NFO、Handoff B 原标准与 custom 精确引用、Arca 独立验收、唯一 Commit、Inventory/Aftercare 和精确保留闭包。登堂入室建议只取消 4K，不能附带降低已具备的 DTS-HD MA 或 50 GiB 上限；黑水/三峡好人的本地建议与实际生产通过仍是两件事。
4. **验证整合**：需要实际 Linux Docker 下的完整隔离 Host、真实可处理媒体、Arca Accepted 前后并发、用户评分改变/恢复标准、迟到旧结果和 Aftercare 旅程；再由主线程安排整体镜像与生产验收。本次不依赖或复制主线程未提交的 Catalogue Basis/244 表/66 事务生成物。

## 验证与保留的失败

- 本机 Node 逻辑/真实 SQLite 定向：10 个文件 73 PASS / 0 skip；本地媒体差距观察 3 PASS / 0 skip；另 custom Spec 与 Libra application schema 2 文件 17 PASS / 0 skip。覆盖的 Accepted 是受控投影，不是实际 Arca 提交。
- 受控 HTTP、Host/Handle/Secret/Adapter：电影身份与做种、既有完整 Provider 边界、100 候选、Series 覆盖共 5 PASS / 0 skip；新负例在下载 POST 前拒绝，未访问真实 Provider。
- Manifest 和 P2 contract 检查 PASS。包边界首跑 2 finding：基线 `buffalo-face-catalogue.js` 的 `usearch`、`better-sqlite3` 尚未在全局策略登记；禁止语义首跑 1 finding：基线 `us-adult-catalogue-assessment.js` 的 `membership`。这三个源码/策略路径相对 `f24164ae0` 未修改；没有改变其他线程或全局策略来遮盖 finding。完整 Architecture 未通过。
- 保留首跑失败：Provider 三项最初因沙箱临时目录 `rename` 的 `EPERM` 全部失败，解除权限限制后同范围通过；新增电影字段测试最初发现空年份误拒、冲突年份/ID 误放行，新增类型测试最初发现剧集类型误放行；重放测试最初发现已替代 Run 拒绝重放，进一步的完整 Basis 篡改测试先红后绿。这些均未通过删断言或降低安全门槛修正。
- 当前本机 Docker daemon 不可用；上述结果是开发反馈，非 Linux Docker、真实下载、真实媒体生产、最终 UI 或生产验收。未部署、改库、重试/取消生产任务、Reset、启停或修改生产媒体。
