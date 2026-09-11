# 三部电影修复证据

日期：2026-09-11。状态：本地代码完成并验证，未部署修复。用户随后明确要求尝试《太阳帝国》重新上架，已执行一次正式retry，结果仍失败；未直接改生产SQL或手工处理媒体。

## 基线与授权

用户要求修复《一战再战》《人生密密缝》《太阳帝国》。实际生产镜像为
`markmahoro/shelfdeck:helix-beta-20260909-7ceaeca7fb`，Image ID
`sha256:12db15cbc07e12becd793b20cb0f1270e03ec29241ddab05f4dde42d8152eb83`。
主工作区 `main@d486947c8` 落后于该版本；修复在独立工作区
`E:/my_project/emby_third_party-helix-three-films`、分支 `codex/three-film-recovery-20260911` 实施。
原工作区未提交的太阳帝国诊断保持原状。本次没有 SSOT diff。

## 已确认根因及修复

### 一战再战

Subject `libra-subject-8cf2a549d89f3c5bb8dfd0558abc91cba6a01b03`；Run
`7ddb25a2bf9d4bfa418c7ee81b7a449e19d78cbc7a0e24e9c860c3274f32673b`。
原片 19,910,447,074 bytes（约18.54 GiB），Acceptance Spec 上限15,032,385,536 bytes（14 GiB）。
Direct Verification 的唯一 Gap 是 `max_size_exceeded`。Probe 为HEVC 4K、DV Profile 5、compatibilityId=0、
baseLayerKind=unknown。QSV、VAAPI、CPU 的三份 Input Verification 均为
`strategy_rejected`，包含 `dolby_vision_base_layer_unsupported`；没有实际启动转码。
External query/search/select/request 已成功，observe 在 `waiting_for_external`。

SSOT 7.3.5 明确禁止对此类 DV 盲目 tone-map，并要求 GPU/CPU 均不合法后转 External Acquisition，
因此寻源是正确行为；不能把它改成支持安全转换的普通“仅体积超限”路径。
缺陷为 Formation 摘要仍优先选择旧 blocked assessment，并可能把已成功 request 当作整个获取完成。
修复后使用当前 External Event 状态，历史已拒绝本地评估显示“本地转码不可用，转入外部寻源”。
不改媒体策略、用户要求或实际下载。

### 人生密密缝

Subject `libra-subject-95a9b8022ae22dc6b66fc7e7c415d3c4f979b8ea`；Libra Run completed，
On-deck Run `844d2564f525ee73c36564559e8b5cbefc704f8cf65457796af7b72bf6215615` offloading。
Stage 第一代最终为 `RECOVERY_EXECUTION_BUDGET_EXHAUSTED`；第二代 Stage executing，Effect
`reconcile_required`；生产日志重复 `CLEAN_ARCA_TARGET_OCCUPIED`。
两个冲突目标为当前 title NFO（7427 bytes，本包7423）与 poster.jpg（1031527 bytes，本包333786）。
mtime 分别为2026-08-31T11:57:59Z、11:56:25Z，早于本次Run；只读当前 Inventory、Libra Binding、
Off-load Context 均不引用这两个位置。mtime 仅说明文件时间，不能单独证明历史作者或来源。

根因不是长片复制太慢：Stage 的明确目标冲突在 effectful executor 中抛出后进入未知 Effect 的恢复路径，
反复重试直到一小时预算耗尽。修复先对全体目标作只读冲突检查，保证当前 Stage 尚未写入任何文件；
此处独有的 `CLEAN_ARCA_STAGE_TARGET_OCCUPIED` 返回 typed terminal failure。当前执行产生效果之后的
旧 `CLEAN_ARCA_TARGET_OCCUPIED` 或未知 I/O 仍保留 reconcile，不扩大“安全失败”的异常范围。
新增中文原因明确说明保留现有文件。生产恢复必须先有界隔离上述两项，范围和SHA256见唯一活动包。

### 太阳帝国

On-deck Run `28c2d89e239b3e6d50bbbcdaeafe37fb5e04685fe9a1aa1c68238863d673fbb9` blocked，
未 Commit。沿用2026-09-10的生产源码/事实链，并在本次重新确认运行版本、五个失败成员及七个 Final Product
存在（MKV 7,888,988,781 bytes；NFO 6675 bytes）。本次存在性检查不冒充重新逐文件完成全部 fingerprint 验证。

逐文件精确 Approval 与旧整盘 leftover 删除循环冲突：STREAM/CLIPINF/PLAYLIST 部分已删除后因邻居越权失败；
index/MovieObject 被 BACKUP/META 目录检查提前阻断。修复同步与真实 async 端口：每次仅处理当前 Handle 的
source，保留 final 校验、Source 身份校验及删除前 Approval 重验；不再把 BDMV 邻居或空目录作为隐式删除目标。
未知邻居不再触发与其无关的单文件删除失败，它们原封不动保留；当前成员路径的未知替换、Identity drift、
Final 不合格及精确 Approval 失效仍必须停止。
没有把未知成员纳入 Scope、增加目录授权或取消 Owner 检查。原先期待删除未批准 STREAM/CERTIFICATE 的
四项测试改为验证保留。

2026-09-11 用户质疑定位后的复核：生产只读重建确认，Candidate Primary Input Manifest 和 Libra Run
均为5项（CLPI、index、MovieObject、主片M2TS、选定MPLS）；Off-load Context 为同5项加6项Related，
共11项。因此不能把同一BDMV容器内其他路径视为已交接删除成员。该依据是SSOT的BDMV主标题选择、
Candidate Material Disposition Scope及5.8.7，不是把UAT-134普通文件例外直接套用于BDMV；
SSOT的PROD-065 D3明确保留BDMV原子容器/结构依赖范围及独立收口规则。
本次复核没有扩大或缩小冻结Manifest，也未证明盘内全部剩余材料的历史来源与业务归属。

将同一组async BDMV payload/index隔离用例指向生产源码`7ceaeca7fb`，得到0 pass / 2 fail：
payload在原端口1964行向精确Approval回调传入邻居路径，index在1928行报
`CLEAN_ARCA_SETTLEMENT_UNKNOWN_MEMBER`。指向修复源码后为2 pass / 0 fail，并覆盖三次源已缺失重放。
这证明两个执行器失败机制可复现；该测试使用逐路径断言回调，不冒充完整持久化Approval、Event Journal
崩溃窗口或生产恢复链验收。生产历史`APPROVAL_STALE`的内层reason未被保存，不能声称读取到了
历史`Deletion exceeds the exact approved member.`原始异常，也没有证据将其解释成按时间过期或用户撤销。

## 验证结果与局限

- Inventory + Formation 专项：100 pass / 0 fail。新增覆盖 sync/async payload/index、BACKUP/META/未知文件保留、
  三次缺失输入重放、final drift、删除前撤销、Stage真实端口→Capability typed outcome、未知I/O不吞错、DV下载状态。
- Arca targeted contract：43 pass / 0 fail；额外 Formation process / NAS wrapper 测试30 pass / 0 fail。
- `node scripts/helix-architecture-verify.js`：PASS；226 fixture files，47 packages，1147 dependency checks，
  1976 semantic files；dependency/semantic/manifest/contracts均0 findings，SSOT digest保持基线。
- Service完整尝试发现既有 Setup 2项、rating On-deck 1项、UAT-131链路失败。前者2项在未修改的生产基线
  复现；rating与UAT-131 actor-only亦在基线复现（Settlement等待授权，没有建立Entry）。原全量尝试已记录失败并中止，
  不能声明全量全绿。该次另有测试期望尚未更新的6项和新worktree缺tools依赖1项，均已修正并定向通过。
- 补齐tools依赖后，Service以concurrency=4排除上述4个已知基线测试名称运行：531 pass / 0 fail / 22 skip，
  其中18个为既有skip，4个为本次明确排除。测试代码没有skip新增，本包不关闭既有UAT问题。
- 未执行修复版本的Linux镜像、真实浏览器或生产恢复验收；旧版本的用户指定retry结果见下，不能声明三条生产记录已经修好。
- 本轮日志保存在本机临时目录 `shelfdeck-three-films-20260911`，生产只读诊断数据不入库。

当前可交付的是本地修复及精确恢复范围；发布、备份隔离和正式retry必须按
[当前活动包](../CURRENT_PHASE.md)完成后才可关闭。

## 用户指定的生产重新上架尝试

2026-09-11用户明确要求“你现在尝试重新上架，看能否恢复正常”。本次只对《太阳帝国》执行正式
`POST /v1/admin/formation/acceptance/:offerId/actions/retry`；没有部署本地修复、调整standing Authorization、
Reset、直接SQL修改或手工移动/删除文件。生产仍为`helix-beta-20260909-7ceaeca7fb`。

- Offer：`ac19938ba6191e4976930d17e5eda4fea0e1eae0256b7fbb544e1bd50caea7c5`。
- 初次请求缺idempotencyKey，HTTP400在Command派发前拒绝；补齐后19:51:25北京时间返回HTTP202、
  `recovering`、generation 4、`replayed:false`，只建立一代恢复Work。
- Work：`arca-on_deck_execution-work-5018fb28b3554f009cb4dfd82646de8334753f27`；Event后缀
  `0776b1fca4df0dcd2a`。
- Stage、Staged Verify、Placement、Final Product Verify均succeeded；11项Settlement中6项succeeded，
  0001/0004/0006为`ARCA_ONDECK_SETTLEMENT_APPROVAL_STALE`，0002/0003为
  `CLEAN_ARCA_SETTLEMENT_UNKNOWN_MEMBER`，对应failure evidence digest与历史相同。
- 19:52:05北京时间确认Work failed、Run blocked，Fulfillment和Commit cancelled；Commit receipt count仍0。
- 重试前后各核验7项Final的size、inode及`middle-256k-sha256`均匹配对应Staged Physical Identity。
  11项旧输入的存在性前后一致，仍只有index.bdmv与MovieObject.bdmv存在。
- 本次结果证明当前生产版本单纯retry未恢复，不代表本地修复版本的生产验收失败；没有反复发起新一代retry。
