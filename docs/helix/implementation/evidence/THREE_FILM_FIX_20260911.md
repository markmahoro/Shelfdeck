# 三部电影修复证据

日期：2026-09-11。当前状态：修复已部署，《太阳帝国》正式重新上架成功。旧版本generation 4失败及其后修复版本generation 5成功分别记录在下文。未直接改生产SQL或手工处理媒体；其他两条未宣称全部恢复完成。

## 基线与授权

用户要求修复《一战再战》《人生密密缝》《太阳帝国》。诊断时生产镜像为
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
- 初次本地交付时未执行修复版本的Linux镜像、真实浏览器或生产恢复验收；后续Linux及《太阳帝国》生产恢复结果见下，仍不能声明三条生产记录均已修好。
- 本轮日志保存在本机临时目录 `shelfdeck-three-films-20260911`，生产只读诊断数据不入库。

整个三片优先包仍由[当前活动包](../CURRENT_PHASE.md)管理；下文单片恢复通过不替代其他条目的关闭条件。

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

## 修复部署与太阳帝国恢复通过

用户随后明确要求“部署，再尝试重新上架”，并在执行中要求继续。此次授权覆盖标准部署及该片正式retry；
没有实施《人生密密缝》的两文件隔离，也没有修改standing Authorization或扩大Settlement Scope。

| 发布身份 | 值 |
| --- | --- |
| Source / image tag | `c10e516e64` / `markmahoro/shelfdeck:helix-beta-20260911-c10e516e64` |
| NAS config Image ID | `sha256:fd03632b156ff535c84be0e853ee384dc98bea1fba41bf59eee4c8c2687a1b57` |
| Tar SHA256 | `6c3dede8106cc46b91e6da3f34092afca959bef81738cd3e89e49db8ffb3d2e4` |
| Container StartedAt | `2026-09-11T15:47:29.758910825Z` |
| Backup | `/vol1/1000/docker/shelfdeck/backups/three-films-c10e516e64-20260911` |
| Data backup aggregate digest | `35386a45e38915ad7573ee021a85df2d9ce644c97de583b92d1d36c2f171735d` |

在clean worktree通过`scripts/build-image.js`构建，最终Linux镜像运行Inventory及Formation专项100 pass / 0 fail；
以`scripts/upload-nas-image.js`上传并校验，再执行`scripts/deploy-nas.js` dry-run/apply。完整data在停服后由
既有`helix-operational-safety.createBackup/verifyBackup`保存并校验，42项文件及SQLite quick_check均通过；
另备份原Compose和secret.env，Secret未输出或入库。

第一次apply在readiness检查处因`SQLITE_CANTOPEN`停止，未进入新容器重建：正常停服关闭WAL辅助文件后，
现有readiness脚本无法在只读bind mount内打开WAL-mode源库。核实db存在、wal/shm缺失，并在相同新镜像
复现只读打开失败；恢复原有旧容器正常运行后，health为ok、只读查询成功，再次走同一标准apply，readiness、
health、Admin Web、全部挂载、运行镜像检查均通过。没有手工建WAL、改SQLite、绕过readiness或更换部署入口。
生产3项关键源码SHA256与构建输入逐项一致。NAS管理页HTTP200，根目录和应用目录权限、无关容器原状态保持。

部署后重新核验7项Final，再由正式retry入口受理generation 5：

- Work：`arca-on_deck_execution-work-cf12cc0db84c28666f26fd342c2afd7035e7e628`，最终succeeded。
- On-deck Run最终committed；11项Settlement全部succeeded，Fulfillment及Commit成功，相关活动Work为空。
- 唯一Commit receipt：`5f0d1493a3b32a4aec42bea863d30969dbf32a8aad7156f42a2187df635a394e`，
  `committed_at_ms=1789141774133`（2026-09-11 23:49:34北京时间）。
- Shelf Entry：`3c66f5560d36baebdeefacec91f810df7d994447ea6106f5987be88b37172e85`，active；
  Deck Fact revision 1 active。全局Shelf Entry及Commit数量均从108变109。
- 11项旧输入均absent；只有此前仍存在的index.bdmv和MovieObject.bdmv新增完成物理处置。
- 7项当前Inventory的size/inode/bounded fingerprint均匹配；原盘246项范围外文件在前后枚举中的
  path、size、inode、bounded fingerprint逐项相同，BACKUP/META保持。
- Formation详情API HTTP200、classification=completed、arcaStatus.stage=completed且reasonCode=null；
  Collection详情API HTTP200、Entry active，指向上述同一Entry。首次Aftercare评估尚未完成，快照为
  never_assessed/unknown、maintenanceState=none，不能把上架验收等同于独立Aftercare全部healthy。

因此本片原清理错误与上架阻断已在生产恢复。此次覆盖该条真实恢复链，未重跑完整产品E2E、未新增
真实浏览器操作验证，也未关闭三片包的全部剩余事项。操作与核验日志仍在本机临时目录，完整生产导出未入库。

回滚候选保留为旧镜像`helix-beta-20260909-7ceaeca7fb`，NAS原tar SHA256为
`2b5d16ee6d023540c567890e1bec4d0987df6dfaa3becf86be19ecc08d251f26`。
如需binary回滚，仍先dry-run再apply：

```powershell
node scripts/deploy-nas.js /vol1/1000/docker/shelfdeck/shelfdeck-helix-beta-20260909-7ceaeca7fb.tar --sha256 2b5d16ee6d023540c567890e1bec4d0987df6dfaa3becf86be19ecc08d251f26
node scripts/deploy-nas.js /vol1/1000/docker/shelfdeck/shelfdeck-helix-beta-20260909-7ceaeca7fb.tar --sha256 2b5d16ee6d023540c567890e1bec4d0987df6dfaa3becf86be19ecc08d251f26 --apply
```

回滚不撤销已经正常完成的Commit，不覆盖当前数据库；完整备份作为事故恢复证据保留。
