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

追加 fail-closed 基线检查：新 Admission 要求在捕获 opaque fence 后读取 `readCurrentCustomTargetBaseline` 的当前标准语义 digest、Shelf revision/digest、Subject/Scope、身份和 Handoff 状态，并在同一 Admission Unit of Work 内比较已确认 Intent。调用方缺少读取器、投影不可用、评分导致标准语义变化、Shelf/身份/范围变化或 Arca 已接纳时不能新建 Run；已提交的精确重放仍先于当前新鲜度检查。新增内部组合读取器复用 `acceptanceSpecContextReader` 和正式 `resolveCurrentRequirements` 计算当前标准语义，按 Subject 当前身份及精确范围绑定，并要求独立 Arca 责任公开投影；相同评分不同来源不改变语义，4→5 星产生不同标准。现有测试的 Perception/Arca 是受控 typed 夹具；真实 Arca 责任投影及组合读取器尚未接线，因此该内部入口默认拒绝，不能称真实评分变化旅程通过。

新增未对外接线的 Libra Preview/确认命令编排：调用方只能提交 Subject/Run 与幂等键，或精确 Preview digest、所选变更、一次确认与幂等键；Basis、标准、差距和建议来自注入的服务端 Owner View。命令在读取 View 前捕获 opaque fence，并分别重新读取当前标准语义、Shelf、身份、范围和 Arca 责任；证据明确待补时不写入，格式错误、旧基线或已 Accepted 不会伪装成待补证。Preview/Intent、Head、Foundation Command Receipt、Marker 和 Audit 按既有事务原子写入；相同命令重放验证 Owner 记录与 Foundation 回执，变更 Preview、选择或确认值使用同一幂等键会冲突。测试还覆盖双用户并发、读取时事实变化和提交中断全量回滚。确认只产生 Intent，并未宣称 Spec、Run 或上架已完成。该编排使用受控 View/Arca 夹具，真实完整 View 尚不存在，因而不能开启用户入口。

同样补齐 Custom Spec Publication 的基线检查：在事务外重新读取当前标准与 Arca 责任，在已捕获 fence 的 Publication Unit of Work 中对照持久 Intent 和当前 Handoff；缺少读取器、语义/身份/Shelf 改变或已 Accepted 均阻止新发布，读取时事实变化也被 fence 阻止。已提交的精确回执重放仍先于当前投影验证，包括投影暂不可用的情况。真实标准解析器与受控 Arca 投影已接入 SQLite 测试，真实 Arca 公开投影仍是主线程整合依赖。

本轮进一步修复一个真实可复现的中断缺陷：新 Run 已原子提交但取消旧 Work 前进程中断时，原入口因旧 Run 不再 current 而不能重放。现在显式重放先校验持久 Intent、从原标准/Preview/Intent 完整重建的 Spec、双向 Run 替代关系、初始 Admission Decision 与精确 Run Basis、Foundation marker/Result/evidence，再返回同一 Run 并重新调用原 Owner 作用域的幂等 Work 取消。篡改 Intent、Spec、Basis 或结果证据均拒绝。测试覆盖重复调用、提交后取消抛错、当前 Subject revision 后续变化、源绑定/身份变动、新鲜度冲突；Arca Accepted 场景使用受控公开投影夹具，未声称完整跨 Owner 竞态旅程通过。

此路径尚未接入实际用户入口或 Runtime 自动接续。新 Run 的 Admission 先于旧 Work 取消；`cancelProcessWorks` 返回的 draining 状态目前未形成新 Run 调度屏障，调用后中断也尚无 Runtime 持久恢复入口。不能发布或开启该内部入口。已 Accepted 的 Arca 责任仍必须通过 Arca 的公开责任投影与 read fence 保护；不得用取消 Libra 旧 Run 代替该边界。

## Linux 电影测试库路径防护（独立提交）

主线程隔离 Linux Service gate 发现测试库构建脚本先执行 `path.resolve`，导致 Linux 上 `Z:\Film` 变成普通绝对路径、绕过原有盘符拒绝。独立提交 `db539e9df` 在解析前校验原始盘符和 UNC 字符串，解析后仍保留同一检查及已有文件系统根、目标边界保护；只修改脚本与其测试，可单独 cherry-pick。Linux 原测试为 4 PASS / 1 FAIL，添加盘符及 UNC 用例后、修复前为 5 PASS / 9 FAIL；修复后 Linux 与 Windows 均为 14 PASS / 0 skip。这是路径字符串防护，不识别 Linux 已挂载 SMB 或证明挂载类型安全；没有修改生产或主线程工作树。

## Movie 外部寻源记录的有界读取（2026-10-29）

新增未接线的 Libra 内部读取器，只处理当前原标准的单电影 Run。从 Owner Run Snapshot 与身份 Fact、Foundation 的精确 Work/最新成功 Attempt、Query→Search→Selection 输入绑定和 Libra Candidate Evidence 重建一次已记录搜索；重新计算 Query 与 Selection，并核验结果、候选、身份、Spec 和引用摘要。无 Work、未成功或搜索失败只返回待补证；错误状态、跨 Run/Subject、旧 Basis、错误连接、缺失或损坏 Evidence 均拒绝。返回的是原始候选声明与选择结果，既不创建目标建议，也不授权下载、生产、Conformance 或接纳。调用方须在同一 opaque fence 下与其他当前 Owner 证据组合。

MoviePilot Adapter 只查询去重后的前三个标题关键词，合并去重后再截取最多 100 条；当前记录不保存逐关键词覆盖、上游分页或截断结论，无法证明本次搜索完整。无论输出条数是多少，读取器始终标记覆盖范围未知，并仅注明是否达到合同上限。后续须由相关 Owner 明确有界搜索范围及其完成/截断 Evidence，并把它绑定精确 Query、Provider 配置和结果，不能以少于 100 条推断完整，更不能声称覆盖所有 Provider。`unavailable`、零结果、缺身份 Anchor 或 `not_selected` 都不证明无片源，也不能单独支持放宽要求；不得据此开启 Preview 或认为用户已接受。重复调整后的 custom Spec、完整路径/媒体验证和其他 Provider 的证据仍未实现。

新增测试以真实 Planner 生成 Event 绑定，在临时 SQLite 中保存 100 条、超过 64 KiB 的候选记录；重启后使用真实 Foundation Work Result Reader 与 Libra Evidence Store 重建，篡改记录后拒绝。Run Snapshot、身份 Fact 和 Provider 数据为受控夹具，非真实下载或生产证据。先添加未知 Work 状态负例时为 3 PASS / 1 FAIL，补充状态校验后通过。最终本机 Windows Node 及本机隔离 Linux Docker 各运行新读取器、现有寻源管线、局部媒体差异和 Preview/确认共 4 个文件：各 26 PASS / 0 skip。Windows 开发反馈只读复用另一份本机 checkout 的依赖；Linux 使用下述已有镜像与依赖差异，不是精确依赖镜像或整套验收。包边界与禁止语义扫描对新读取器均无新增 finding，项目基线的 2 + 1 finding 仍在。

## 需要主线程整合的精确缺口

1. **标准目标与评分变化**：当前 `libra_custom_target_heads` 只能引用非空修改集合的 custom Intent，普通 Spec Admission 在存在该 Head 时拒绝，Promotion Fence 也只允许匹配 custom variant；`collectionTargetRef` 虽声明 `standard`，没有可验证的标准 Intent/Head 发布与替代路径。必须由统一合同/存储明确版本化的当前标准目标、显式恢复标准及语义基线变化后的 CAS/重放/保留语义；不能删除 Head、静默沿用旧放宽项，或把旧 custom 目标自动应用到新评分。普通 Acceptance Spec Coordinator/Run Coordinator 还需要区分实际 custom Spec 与其 `originalTarget` 所对应的当前标准，核验新的 Perception/Shelf/身份公开投影；不能只比较两个不同 variant 的 `specDigest`。主线程统一处理公共 SSOT、生成物与存储。
2. **旧 Work/Offer 与自动接续**：在现有 Owner 边界内接入已确认 Intent 的启动与重启扫描；对精确未 Accepted Offer 等待 Arca Withdrawal Receipt，对 Libra 旧 Work 取消、在途 Event/Effect 排空并核验 Control/材料后，允许新 Run 工作。新 Run 当前写为 active，现有 `active-libra-runs` 扫描会调度它；必须由负责共享 Runtime 的线程形成可复验的排空/调度屏障并覆盖提交后各中断点、迟到结果和再次重启，不能靠本地方法返回值充当全局屏障。
3. **真实用户与 Arca 路径**：仍缺从 Owner 当前完整材料、Probe/验证、真实外部搜索与路径结果构造最小差距建议和完整服务端 View，并接入上述内部 Preview/确认；未取得足够证据时显示待补证，不能把候选的 unavailable 当成无资源。尚缺 API/UI、当前版本 UI 负责人验收、实际新 Run 生产/Conformance/NFO、Handoff B 原标准与 custom 精确引用、Arca 独立验收、唯一 Commit、Inventory/Aftercare 和精确保留闭包。登堂入室建议只取消 4K，不能附带降低已具备的 DTS-HD MA 或 50 GiB 上限；黑水/三峡好人的本地建议与实际生产通过仍是两件事。
4. **验证整合**：需要实际 Linux Docker 下的完整隔离 Host、真实可处理媒体、Arca Accepted 前后并发、用户评分改变/恢复标准、迟到旧结果和 Aftercare 旅程；再由主线程安排整体镜像与生产验收。本次不依赖或复制主线程未提交的 Catalogue Basis/244 表/66 事务生成物。

## US-SIZE-DEFECT-PREVIEW 独立修复（2026-10-29）

主线程只读分诊提供 TTIA-026、Roxy Raye 两条现象；本线程没有读取、重试或修改生产。隔离复现证实，既有瑕疵候选从 `product_metadata_observation` 推导字段，US 的正式产品事实经 `us_adult_product` 形成，故同 Run 已有 identity/title 时仍可能误报不可豁免。此项修复第二层既有瑕疵路径，不创建第三层自定义目标，也不修改旧 Run、Spec、Product Fact 或已授权 Manifest。

US 候选现在读取同一 Run 的 `resolved_identity`、`product_metadata` 和 `media_cast` 正式事实，并复用 Product Conformance Fact 验证及现有 US 单演员资格检查；校验 Subject、Spec、internal Anchor、Metadata→Identity 与 Metadata→Cast 的精确引用。缺事实返回待补证，跨 Subject、错误引用、缺标题或缺合格演员不可接纳。体积候选仍要求现有精确 Workspace 验证、已验证附件和仅 `max_size_exceeded`；额外核验三点播放结果与冻结规格下的实际体积，缺证据不能成为通过，失败样本或不一致体积不能成为可接纳差距。用户确认仍复算候选，必须使用精确摘要及显式确认；该确认不代表 Arca 接纳或入藏。

实施时发现既有持续自动瑕疵授权的 SSOT 范围仅为 Movie，而原协调代码没有内容类型门槛。为避免修复 US 预览后扩大既有授权，在 Libra 协调和生命周期事务内均强制 Movie 范围；US 有合格候选时仍等待用户手动决定。Movie 已授权路径继续生效，已提交命令在授权撤销后仍按原回执重放。该范围是执行已有合同，不新增授权；不影响历史已提交事实。

最终本机 Node 和本机 Linux Docker 各运行相同 5 个测试文件：**78 PASS / 0 skip**。覆盖同 Run 事实、手动确认与重放、Movie 自动授权、US 自动授权拒绝及绕过协调层的事务拒绝、Movie 演员缺失、身份/引用/标题/演员/附件/播放/体积负例；SQLite 是临时数据库，Artifact/媒体 Result 为受控夹具，不证明真实文件生产或 Arca 接纳。Linux 容器使用下节所述只读源码和已有运行时镜像，依赖锁文件与本分支存在已披露差异。首次新增定向测试为 11 项中 4 项失败，分别为 US 有事实仍不可接纳、自动协调未到待用户决定、缺身份及缺资料错误判为不可接纳；修复后上述最终范围通过。

此改动改变用户可见的预览资格，属于后端联动 UI；按 Playbook §12.3 仍需用户指定 UI 负责人核验整合后的确切版本和受影响页面。没有执行 NAS 重测、生产确认、自动或手动接纳，不能据此关闭生产问题。

## 验证与保留的失败

- 本机 Node 逻辑/真实 SQLite 定向：最终 16 个相关文件 133 PASS / 0 skip，包含 Preview/确认、Publication、Run Admission、Promotion、Delivery 与 Provider；此前 14 个文件 99 PASS / 0 skip。覆盖的评分/Accepted 是受控投影，不是实际 Perception 修改或 Arca 提交。
- 受控 HTTP、Host/Handle/Secret/Adapter：电影身份与做种、既有完整 Provider 边界、100 候选、Series 覆盖共 5 PASS / 0 skip；新负例在下载 POST 前拒绝，未访问真实 Provider。
- 后续确认 Docker Desktop 本机 Linux daemon 已可用：以只读工作树挂载、容器 `/tmp` 和 `/app/data` 的临时文件系统、`--network none` 运行当前源码。15 个核心测试文件 107 PASS / 0 skip；MoviePilot 同文件按名称过滤的五个相关场景 5 PASS / 21 skip（其余场景未执行）。容器 Node `v20.20.2`、`better-sqlite3 12.11.1`，复用现有 Linux 镜像 `markmahoro/shelfdeck:1d8a45843f`，镜像 ID `sha256:bd59d681900e1788905fba487d801abc3697393702f8bf39852569bad34900a0`，不是本分支构建的镜像。镜像锁文件 SHA-256 `72124c8cbd9f4ef0bbef605965839d0da3f5a1217778222e5bd1beca60e4a852`，与本分支 `c4c799a7c5e164d05fcbc06e4f7cbd1d2bd3795367099545448629760759ff21` 不同：比较锁文件包的版本及 integrity，差异是本分支新增 `usearch`、`node-addon-api` 和 `node-gyp-build`；本轮所选测试没有使用这些包。这是隔离 Linux 定向反馈，不是精确依赖镜像、完整 Linux 容器验收或生产验收。首次包含全部 Provider 场景的容器测试为节约共享本机资源而主动停止，保留日志；之后分别完成上述核心及五个定向场景。
- Manifest 和 P2 contract 检查 PASS。包边界首跑 2 finding：基线 `buffalo-face-catalogue.js` 的 `usearch`、`better-sqlite3` 尚未在全局策略登记；禁止语义首跑 1 finding：基线 `us-adult-catalogue-assessment.js` 的 `membership`。这三个源码/策略路径相对 `f24164ae0` 未修改；没有改变其他线程或全局策略来遮盖 finding。完整 Architecture 未通过。
- 保留首跑失败：Provider 三项最初因沙箱临时目录 `rename` 的 `EPERM` 全部失败，解除权限限制后同范围通过；新增电影字段测试最初发现空年份误拒、冲突年份/ID 误放行，新增类型测试最初发现剧集类型误放行；重放测试最初发现已替代 Run 拒绝重放，进一步的完整 Basis 篡改测试先红后绿；新 Run 初次测试证明缺失当前标准投影或评分要求改变仍可准入，追加基线门槛后定向复验通过。新增 Preview/确认测试先发现损坏 Foundation 回执仍能重放、复用幂等键改变 Preview 未返回冲突；Publication 新鲜度负例先证明未读取当前基线，均修正后复验通过。夹具加入基线读取器后，原“缺失读取器”测试一度因夹具默认值而未真正模拟缺失，显式传入 `undefined` 恢复原负例并通过。新增媒体观察局部变量 `sourceBindings` 被禁止语义扫描识别为旧 Domain 概念：实际变量是 Event 输入端口绑定，按真实含义改为 `mediaPortBindings` 后该文件 0 finding，基线 `membership` finding 仍保留。这些均未通过删断言或降低安全门槛修正。
- 最初 Docker daemon 不可用，后续已完成上面受限的 Linux 容器定向验证；仍未构建本分支精确依赖镜像，也未验证真实下载、真实媒体生产、最终 UI 或生产验收。未部署、改库、重试/取消生产任务、Reset、启停或修改生产媒体。
