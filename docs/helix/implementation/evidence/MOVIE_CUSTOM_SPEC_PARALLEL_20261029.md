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

## Custom Replacement 的排空与旧 Offer 证明（2026-10-29）

新增未接线的 Libra 内部准备度读取器：重新从持久 Intent/Preview/原标准、Custom Spec、Run Admission Decision、Foundation marker/Result 及双向替代关系重建当前目标；对同 Subject 的完整已替代祖先链重复调用 Foundation 精确流程取消入口，重启或取消中断后可重试。按 Foundation 正式事务读取口逐一检查旧 Libra Run 的 open Work、open Event 与未结算 Effect；后两者不能被取消返回值或 Work 终态代替。Run 关系、Target Head、Spec/引用损坏和环状关系拒绝，不释放 Control、不移动或清理任何文件。

每个祖先的实际 Package 列表必须与 Run 的 Package Head 一致。存在旧 Offer 时通过 Arca 公开 Formation Status 投影读取真实 Withdrawal Receipt，复核 Offer/Package/Subject/Spec、关闭原因与摘要，再检查该 Offer 的 Arca Acceptance Work/Event/Effect 是否排空；未取得精确回执不视作已关闭。已 Accepted 或 Rejected 的 Libra Delivery Receipt 暂统一返回待核验，不能冒充 Withdrawal，也不能强行撤回已接纳责任。未存在旧 Offer 时也校验没有被零 Head 隐藏的 Package。输出的 ready 带 Foundation opaque read fence；调用方必须在随后的实际写入事务验证该 fence。这个证明尚未接入全部 Work/Workspace Admission 和 Scheduler，不是全局调度屏障，也不授权开放自定义目标入口。

真实临时 SQLite 中使用实际 Run Admission、取消入口、Foundation execution-state 读取、Arca Withdrawal Store 与公开 Status Projection；覆盖执行中 Event、Work 已取消但 Effect 未结算、取消中断后重试、完整祖先链及环、零 Head 隐藏 Package、Target 引用缺失、旧 Offer 未关闭、精确 Withdrawal、Arca Work 未排空、回执篡改和跨 Owner 读取时并发变化。Provider 和已发布 Package 内容仍为受控夹具。新增 Arca 关闭测试在实现前为 0 PASS / 2 FAIL；引用缺失负例先发现错误的 `not_custom` 分支，修复后通过。最终 Windows 与隔离 Linux Docker 各运行 Run Admission、Offer Withdrawal、Work Lifecycle 三文件，均为 **57 PASS / 0 skip**。新读取器包边界与禁止语义无新增 finding，原有全局 2 + 1 finding 保留。Linux 依旧使用下述已有非本分支依赖镜像，并非整套 Service gate 或 NAS 验收。

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

## US 瑕疵确认界面的走查修复（2026-10-29）

UI 负责人对开发版本 `d37bc4272` 的提前走查为 FAIL，指出确认失败显示在弹窗背后、实测成品体积误写为预计及列表序号重复；这不是整合版本验收。独立前端提交 `80ea48f5e` 在弹窗内显示具体可操作错误，明确的 4xx 拒绝使旧候选失效；重新读取当前 Run 并获得新的 eligible Preview 后才允许再次确认。网络或服务端结果不明确时保持待核对状态，不把它判作失败，也不凭 Run 变为 active 推定本命令成功；原 Candidate、Run revision/digest 和幂等键保留在当前浏览器内存，用户核对提交时重放同一请求。确认响应已成功但页面刷新失败时只提供刷新状态，不再次发命令。

大小文案在 `measured=true` 时仅使用 `actualSizeBytes` 与实际限额计算超出量；只有预测数据使用“预计”，缺失实际值不冒充预测。删除有序列表的手写编号和没有证据支持的编码/音轨承诺，保留精确瑕疵及确认后果。当前实现版本的 `tsc`/Web build 通过，3 个相关 Vitest 文件 **31 PASS**；Chromium 四个视口（1920×1080、1280×800、1024×768、390×844）以键盘/实际页面执行实测与预测、单编号、旧 Preview 失效和重检、网络未知结果及原请求核对，共 **16 PASS**。本轮浏览器使用受控前端 API 夹具，不是实际媒体、Arca 或生产操作。窄屏实测/错误/未知结果截图保存在本任务 ignored Evidence，SHA-256 分别为 `469e51e8049f22964936d76da756af6a71953de2b26ef938fe0d3b5c2c33d6e2`、`edcefe7242b32f85079b9589bc625139959fc1019c02f26a96461229e4801c32`、`10bf8a381d8c0e247cc8a60adc8feebbf00339cecb90a824f703563fcc22a9c6`。合并后的精确版本仍须 UI 负责人复验，不能据此声明最终 UI/UAT 或生产验收通过。

## 验证与保留的失败

- 本机 Node 逻辑/真实 SQLite 定向：最终 16 个相关文件 133 PASS / 0 skip，包含 Preview/确认、Publication、Run Admission、Promotion、Delivery 与 Provider；此前 14 个文件 99 PASS / 0 skip。覆盖的评分/Accepted 是受控投影，不是实际 Perception 修改或 Arca 提交。
- 受控 HTTP、Host/Handle/Secret/Adapter：电影身份与做种、既有完整 Provider 边界、100 候选、Series 覆盖共 5 PASS / 0 skip；新负例在下载 POST 前拒绝，未访问真实 Provider。
- 后续确认 Docker Desktop 本机 Linux daemon 已可用：以只读工作树挂载、容器 `/tmp` 和 `/app/data` 的临时文件系统、`--network none` 运行当前源码。15 个核心测试文件 107 PASS / 0 skip；MoviePilot 同文件按名称过滤的五个相关场景 5 PASS / 21 skip（其余场景未执行）。容器 Node `v20.20.2`、`better-sqlite3 12.11.1`，复用现有 Linux 镜像 `markmahoro/shelfdeck:1d8a45843f`，镜像 ID `sha256:bd59d681900e1788905fba487d801abc3697393702f8bf39852569bad34900a0`，不是本分支构建的镜像。镜像锁文件 SHA-256 `72124c8cbd9f4ef0bbef605965839d0da3f5a1217778222e5bd1beca60e4a852`，与本分支 `c4c799a7c5e164d05fcbc06e4f7cbd1d2bd3795367099545448629760759ff21` 不同：比较锁文件包的版本及 integrity，差异是本分支新增 `usearch`、`node-addon-api` 和 `node-gyp-build`；本轮所选测试没有使用这些包。这是隔离 Linux 定向反馈，不是精确依赖镜像、完整 Linux 容器验收或生产验收。首次包含全部 Provider 场景的容器测试为节约共享本机资源而主动停止，保留日志；之后分别完成上述核心及五个定向场景。
- Manifest 和 P2 contract 检查 PASS。包边界首跑 2 finding：基线 `buffalo-face-catalogue.js` 的 `usearch`、`better-sqlite3` 尚未在全局策略登记；禁止语义首跑 1 finding：基线 `us-adult-catalogue-assessment.js` 的 `membership`。这三个源码/策略路径相对 `f24164ae0` 未修改；没有改变其他线程或全局策略来遮盖 finding。完整 Architecture 未通过。
- 保留首跑失败：Provider 三项最初因沙箱临时目录 `rename` 的 `EPERM` 全部失败，解除权限限制后同范围通过；新增电影字段测试最初发现空年份误拒、冲突年份/ID 误放行，新增类型测试最初发现剧集类型误放行；重放测试最初发现已替代 Run 拒绝重放，进一步的完整 Basis 篡改测试先红后绿；新 Run 初次测试证明缺失当前标准投影或评分要求改变仍可准入，追加基线门槛后定向复验通过。新增 Preview/确认测试先发现损坏 Foundation 回执仍能重放、复用幂等键改变 Preview 未返回冲突；Publication 新鲜度负例先证明未读取当前基线，均修正后复验通过。夹具加入基线读取器后，原“缺失读取器”测试一度因夹具默认值而未真正模拟缺失，显式传入 `undefined` 恢复原负例并通过。新增媒体观察局部变量 `sourceBindings` 被禁止语义扫描识别为旧 Domain 概念：实际变量是 Event 输入端口绑定，按真实含义改为 `mediaPortBindings` 后该文件 0 finding，基线 `membership` finding 仍保留。这些均未通过删断言或降低安全门槛修正。
- 最初 Docker daemon 不可用，后续已完成上面受限的 Linux 容器定向验证；仍未构建本分支精确依赖镜像，也未验证真实下载、真实媒体生产、最终 UI 或生产验收。未部署、改库、重试/取消生产任务、Reset、启停或修改生产媒体。

## Supporting Work 准入围栏（2026-10-29）

Foundation 的 Work Admission 新增可选 opaque read fence，并由实际写入 Work 和 Admission Receipt 的同一 Unit of Work 验证：读取后 Owner 状态变化会原子拒绝，且不留下 Work 或回执。精确已提交命令的重放先核验原回执，因此后续 Owner 变化不妨碍重放；这不放宽新提交的校验。真实临时 SQLite 测试先复现原实现忽略 fence、错误接受陈旧读取，再验证变化发生于旧 Effect 排空和新 Work 准入之间时拒绝，重新排空并获取新 fence 后通过。

提交 `8b8a19532` 的 Work Admission、Replacement Run Admission、Work Lifecycle 和 Arca Offer Withdrawal 四个测试文件，在 Windows Node 和隔离 Linux Docker 各为 **70 PASS / 0 skip**。这是供 Owner 编排选择使用的原子准入原语，尚未接入全部 Run、Workspace Admission 或 Scheduler；在途旧 Event/Effect 和已 Accepted/Rejected Offer 的处理仍须按各 Owner 合同完成，不能视为全局调度屏障或开放入口的证据。

## Arca 精确 Offer 责任读取（2026-10-29）

新增 Arca public 内部投影，以精确 Offer ID、Package ID/digest 和完整 Offer 身份读取 Arca 自己的 Acceptance Attempt、Decision、Receipt、Custody 与 Withdrawal。查询同时检查 Offer 和 Package 两个索引方向，避免关联错误被当作记录不存在；只要任一 Accepted 状态或 Custody 存在就返回接纳证据存在，不把单条证据宣称为完整 Accepted Receipt 或入藏。Withdrawal 必须重建并与完整 Offer 一致，与接纳证据共存或身份冲突时拒绝。调用方须在跨 Owner 读取之前捕获 opaque fence，并在实际写入事务验证；测试真实 SQLite 中读取后并发写入 Custody 会拒绝后续 Libra 写入且零副作用。

该投影尚未组合成覆盖 Subject/产品范围的完整责任查询，也未接入 Custom Target Baseline、用户入口或 Runtime；不能凭单个 Offer 无 Accepted 证据断言其他 Offer、已有收藏或后续接纳不存在。真实未投递/处理中/Rejected/Accepted 边界仍需要整合旅程核验，不能用该读取释放材料或替代排空。新测试先因缺少公开读取入口失败，最终投影、Withdrawal、Baseline 及 Replacement Admission 四文件在 Windows 与隔离 Linux Docker 各 **53 PASS / 0 skip**；Attempt/Decision/Custody/Receipt 为受控 Owner 数据夹具，Withdrawal 使用真实 Arca Store。包边界与禁止语义无新增 finding，原有全局 2 + 1 finding 保留；Linux 仍不是精确依赖镜像。

## Run 当前目标读取与迟到准入（2026-10-29）

新增未接线的 Libra Run 目标读取：在同一 opaque fence 下读取 Run、其精确 Spec 与该 Subject/产品范围 Target Head，核对 Basis、Spec、Scope 和持久 Head 的引用。旧标准 Run 在新的 Custom Head 确认后即为 `target_not_current`，不等待 replacement Run；终态 Run 返回 `run_not_active`。测试模拟读取旧 Head 后并发确认，随后 Foundation Work Admission 验证同一 fence，陈旧准入被原子拒绝且不留下 Work/回执；也验证可在 Replacement 排空证明上使用同一 fence 检查当前目标。目标匹配仅是局部事实，不能证明旧 Work/Effect 已排空、评分和 Shelf 基线新鲜、Material Control 或 Arca 责任安全，也不是调度许可。

Windows 和隔离 Linux Docker 运行 Replacement Admission、Work Admission、Work Lifecycle、Arca Offer 责任四文件，各 **76 PASS / 0 skip**；目标确认并发使用受控 SQLite 状态变化。新读取器包边界与禁止语义无新增 finding，原有全局 2 + 1 finding 保留。该读取器及围栏尚未接入所有 Run 协调、Workspace/Plan/Event 准入和 Scheduler，尚未形成全局屏障，也未启用用户入口。

## Formation Reset 的 Custom Target 精确依赖（2026-10-29）

依照 SSOT 的已入藏精确 Spec variant 保留合同复核：当前分支的 243 表 schema 与既有 239 表 Owner 保留声明不匹配，正式策略先以 `RESET_RETENTION_SCHEMA_UNREVIEWED` 拒绝。以**仅测试进程内**补齐新表 disposition 的合成 SQLite 复现，Reset 实际保留已入藏 Custom Spec，但其 Intent 为零；Spec 的 Custom Target 与原标准引用是 opaque JSON，没有现有 FK 或 Owner edge 从 Spec 选中。该结果不表示生产曾运行此 Reset 或已有数据受损。

修复由 Libra public Owner reader 在停止态只读来源快照中，对复制图实际选中的 Spec、Run 和 Package 验证并提供精确闭包；完整重建 Custom Spec、Intent 与 Preview，校验原标准、Subject/Scope、版本、digest、Run Target 和 Package/Spec 关系。Operator 只为已选中 Spec 加入对应 Intent、Preview 和原标准，继续执行现有 FK 闭包，不按 Subject 扫描或保留其他历史。新策略声明要求 Intent/Preview 为 `dependent`、可变 Target Head 为 `clear`；缺描述、错误分类、缺失或冲突直接拒绝。独立只读复验在复制后对来源和候选库重建相同依赖，并把摘要纳入预览证据；未改生成 DDL、FK 或共享表声明。

合成测试覆盖已入藏与未入藏、同 Subject 两个已入藏版本及一个未入藏版本、无关历史即使损坏也不扩大选取、缺失原标准/Intent/Preview、篡改完整记录/版本/引用、Package 与 Run 不一致、候选库依赖损坏，以及 `database_copied` / `owners_normalized` 检查点中断后从冻结来源重试。实际模型记录用于校验，收藏及部分 Run/Package 行是受控关系夹具，不是实际媒体接纳旅程。Windows 与隔离 Linux Docker 的六个相关文件各 **64 PASS / 0 skip**；额外 48 MiB 内存测试 Windows **2 PASS**。仅在测试进程内模拟四项表分类后，People、共享 metadata 和维护 Workspace 三文件 Windows/Linux 各 **16 PASS / 0 skip**。包边界与禁止语义无新增 finding，原有全局 2 + 1 finding 保留。

直接扩展运行另含既有 `formation-reset-schema.test.js` 时两平台各 **61 PASS / 4 FAIL**，四项均先被当前 239/243 schema 声明不一致挡住；仅模拟表分类后该组为 **17 PASS / 3 FAIL**，三项仍因旧来源 schema transition 未获当前目标审核而拒绝。不得修改声明或放宽 schema/FK 来掩盖；主整合须审核实际完整表集合及来源迁移合同后重新运行真实版本的 Reset 门禁。本轮没有运行生产 Reset、读取或修改 NAS，也没有证明实际收藏/生产验收。

## Work 规划 Attempt 的原子读取围栏（2026-10-29）

Foundation 的 `ensurePlanningAttempt` 增加可选 opaque read fence，由创建或重用 planning Attempt 的同一 Unit of Work 验证；与已提交命令回执重放不同，重用 ready Attempt 后仍会继续规划，因此陈旧读取不能绕过围栏。新增测试先复现原实现忽略 fence；修复后包括精确 Libra 目标 Head 在读取后变化、原 Work 已准入但新 Attempt 尚未创建、已存在 Attempt 的陈旧重用，均在事务前拒绝且不新增 Attempt。使用受控 SQLite 状态变化，旧 Work 保持原状态供正式取消入口处理。

Windows 和隔离 Linux Docker 的 Work Lifecycle、Work Admission、Replacement Admission、Arca Withdrawal 四文件各 **76 PASS / 0 skip**。该原语尚未接入 Runtime Host，也未覆盖 Plan Publication、Workspace、Event Attempt 及实际 Scheduler 的全部准入；目前仍不能称为全局调度屏障或启用用户自定义目标。

## 已入藏标准 Spec 历史形状复核（2026-10-29）

`24a199ee0` 新增的标准 Spec 完整校验原先只接受当前 schema 对，可能误拒绝历史已入藏事实。仓库提交 `8cce8e801a9aee74fe65f574474c8370952f682e` 的正式标准解析器把 Spec JSON 的 `schemaRef` 保存为 `helix://contracts/types/AcceptanceSpecDraft/v1`，同时该版本的 Publication Store 将行 `spec_schema_ref` 保存为 `AcceptanceSpec@1`；`053260c409` 后改为二者均为 `libra.acceptance-spec@1`。这是源码历史证据，不证明现有生产收藏含该格式。用旧解析器与受控输入生成并冻结 Movie/Series 两份合成记录，复制前的负例为旧版 2 FAIL、当前版 2 PASS。

修复限定在 Libra 的冷态保留只读器：仅识别上述精确旧版标准 schema 对，临时重建等价 Draft 以核验原本的 draft/semantic/record/ID 摘要，不改写存储行；错配 schema、需求或 digest 篡改和伪装 Custom 均拒绝。Custom Spec/Intent/Preview 继续执行完整重建，旧标准不作为 Custom Spec 的兼容基线，也不赋予旧未入藏 Run 执行或保留资格。测试使用当前正式解析器产生 Movie/Series 标准及 4、5 星、相同评分不同来源版本，并在临时库模拟已 Commit 引用、复制和独立只读复验；未入藏 active Run 被清除。相关五文件在 Windows 与隔离 Linux Docker 各 **53 PASS / 0 skip**；这些是合成历史/关系事实，Series 覆盖不扩大 Movie-only Beta 声称。边界扫描无新增 finding，已有全局 2 + 1 finding 保留。

此验证使用现行 243 表测试 schema，不证明任何旧版**数据库 schema**具备冷迁移资格；Owner 声明及来源 catalog/marker 的现有审核仍分别 fail-closed，主整合需核验其实际 244 表混合版本与授权来源。仅从共同基线 `f24164ae0` 移植 `24a199ee0` 最小源码为 `formation-reset-copy.js`、`formation-reset-owner-policy.js`、`formation-reset-verify.js`、`formation-reset-inspect.js`、Libra public index 与新 `fresh-reset-custom-target-retention.js`；还需要 `collection-target-reference.js`（`db7ec1a54` 新增）及 `custom-acceptance-spec.js` 的 `assertStandardAcceptanceSpec` 导出（同提交的一行改动）。原 `custom-target-records.js`、`custom-acceptance-requirements.js` 和测试用 `custom-acceptance-spec-harness.js` 已存在于共同基线；闭包测试需 `formation-reset-custom-target-copy.test.js`。本次历史补丁另需 `formation-reset-standard-spec-history.test.js` 与合成 fixture `fresh-reset-standard-history.json`。未改共享 schema、保留声明或全局计划，没有访问生产。

## Plan 发布与启动的读取围栏（2026-10-29）

Foundation Plan Publication 和 Work `startPlanned` 分别增加可选 opaque read fence，在写 Plan/Node/Event 或将 Work/Attempt 置 running 的同一事务验证；计划计算、发布和启动之间如发生 Owner 变化，须重新读取并取得新的 fence。Plan 的既有精确重用也会继续执行流程，因此同样不能使用陈旧 view。先添加竞态负例分别复现原实现忽略 fence；修复后陈旧读取不写 Plan/Contract/Event、不进入 running，fresh view 仍可使用既有合法重用。

Windows 与隔离 Linux Docker 运行 Plan、Work Lifecycle、Work Admission、Execution Runtime Host 与 Replacement Admission 五文件各 **104 PASS / 0 skip**。目前是未接线的事务能力；Host/Planner/Scheduler 必须在每个边界取得正确 Owner view 与 fresh fence，Event 实际开始及 Workspace 等其他边界仍未覆盖。不能据此宣称全局屏障已完成或开放 Custom Target。

## Workspace 准入的读取围栏与精确重放（2026-10-29）

Libra Workspace Admission 接受可选 opaque read fence，并在写 Workspace、Registry、Revision、Result 和 Marker 的同一 UoW 验证；读取后发生变化时新准入零写入。已提交的精确命令先核验原 Marker/Result，Owner 后续变化不妨碍重放；若精确提交发生在第一次重放检查之后、写事务之前，stale fence 被拒绝后重新核验原回执并返回同一结果，不产生第二套记录。新增测试先复现原入口忽略 fence；最终 Windows 与隔离 Linux Docker 的 Workspace Admission、Work Admission、Work Lifecycle、Replacement Admission 四文件各 **69 PASS / 0 skip**。

这是供协调层使用的可选事务原语，尚未从 Runtime 的 Workspace 创建路径传入当前目标及排空证明，不能单独形成屏障、释放材料或启用 Custom Target。真实 Owner/Arca 变化、完整 Event 调度和 UI/用户旅程仍待整合验收。

## Event Attempt 的 Owner 调度检查口（2026-10-29）

Foundation Event Runtime 新增可选 typed Owner 检查口，接收精确 Work/Event 范围；Owner 返回 pending 时不执行、不伪造失败，返回 ready 时由实际 Event Attempt 写事务验证 opaque read fence。输入准备失败、现有 execution fence 拒绝和外部等待转 ready 也先重新取得 Owner view，并在其各自写事务校验，避免目标变化后制造旧任务的新失败；在途 Effect 的完成/恢复仍由原 Owner 和现有恢复协议处理。Owner 等待让出当前调度轮次，使用明确的 Owner 等待原因，Host 不把它聚合成已完成 Work。该检查口可显式标识不适用的其他 Owner；错误形状直接拒绝。

测试先复现未安装检查口时的旧 Event 仍启动；受控 SQLite 竞态覆盖 Attempt 写入前、输入错误、首尾 execution fence 和外部等待恢复前的 Owner 变化，均不创建错误 Attempt/Effect；fresh view 正常执行，检查口错误、资源释放、调度公平与原恢复路径也覆盖。Windows 与隔离 Linux Docker 的 Event Runtime、Work Scheduler、Execution Runtime Host、Plan、Work Lifecycle 五文件各 **180 PASS / 0 skip**。

此口尚未接入实际 Libra Runtime；在 Scheduler 选择和 Resource Governor 内的技术等待/资源事务仍需同一 Owner 资格整体复核，不能宣称所有调度边界已受保护。新 Run 的完整评分/Shelf/材料和 Arca 责任读取、旧执行排空、恢复及用户入口仍须实际组合与验收。Linux 依旧使用已披露的非精确依赖镜像，没有运行生产或真实媒体。
