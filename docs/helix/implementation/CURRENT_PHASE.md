# 当前活动包：三部电影修复

更新：2026-09-11。ACTIVE；Master Plan 的有界优先包。用户要求修复三条精确电影记录；原 UAT 队列继续由总表维护。

| 字段 | 合同 |
| --- | --- |
| ID / Outcome | P14-FILMS-01：正确投影外部获取；Stage 冲突形成终态；Settlement 只处置精确批准成员 |
| Basis / Evidence | 修复基线7ceaeca7fb；当前生产c10e516e64；2026-09-11 Event/Result/Effect/现场及太阳帝国generation 5成功恢复 |
| SSOT | 7.3.5 DV Profile 5 拒绝与 External Acquisition；5.8.7 exact Approval；10.10.2.1 逐成员收口及空目录无隐式授权 |
| Owner | Libra 媒体决策与 Formation 投影；Arca Stage、Settlement、On-deck；Foundation 持久化 typed outcome |
| Scope | Formation query、Arca Inventory port / capability failure mapping、回归测试和证据 |
| Exclusions | SSOT、转码策略改变、跨域事实、通用旧运行兼容、任意 Reset、直接 SQL 修改、其他电影、Desktop 功能 |
| Typed I/O | 保留媒体 Verification / Event Result；PhysicalMaterialReadHandle + exact Approval + final mapping → SettlementDeletionEvidence |
| Effect / transaction | Stage 冲突保留文件，仅已知前置冲突返回 failed，未知 Effect 仍 reconcile；Settlement 只删除当前 source，重验 final、Approval，缺失 source 可重放，不枚举删除邻居或目录 |
| Legacy reuse | 仅修现有端口，无 legacy wrapper |
| Verification | Windows isolated fixtures；async exact Approval、范围外成员/目录保留、已删除 source 重放、final drift/撤销负向；Stage known/unknown failure；寻源优先于终态预检展示；service suite、架构检查 |
| Recovery | 保留两条精确 Arca Package/成品；先冻结路径、身份、冲突来源及回滚方案，再按适用授权走 Owner 流程 |
| Stop triggers | Owner/授权缺口返回 Design；无法证明归属的媒体不删除或覆盖；部署/真实副作用按当前 Gate |

Implementation Gate由修复指令打开，Production Gate由后续“部署，再尝试重新上架”打开。`c10e516e64`已按标准流程发布，最终Linux镜像100项专项通过；《太阳帝国》generation 5正式retry后11项Settlement成功、唯一Commit及7项Inventory核验通过，246项范围外文件保持。该片的上架恢复已完成；《人生密密缝》精确冲突隔离及其恢复未在本次执行，整个优先包保持ACTIVE。原活动包可由基线commit复验。

## 已冻结的生产恢复动作及执行状态

1. 已完成：标准build-image → upload-nas-image → SHA256 → deploy dry-run/apply；完整data和配置备份位于`/vol1/1000/docker/shelfdeck/backups/three-films-c10e516e64-20260911`。未clean-init/Reset或直接改SQLite。
2. 《人生密密缝》精确 On-deck Run 为 `844d2564f525ee73c36564559e8b5cbefc704f8cf65457796af7b72bf6215615`。停服后重验下面两个冲突文件的 size、SHA256、非 symlink、路径 containment，以及当前 Inventory/Libra Binding/Off-load Context 未引用它们；任何变化停止。
   - `/media/Film/人生密密缝 (2017)/人生密密缝 (2017).nfo`：7427 bytes；SHA256 `0c36f85dad179428446e6fb946a98df535913aa297dc9e90be83285560df25d4`。
   - `/media/Film/人生密密缝 (2017)/poster.jpg`：1031527 bytes；SHA256 `db80299781122985c4dea6001f88bcffce25c7f5952c91823259eb3bc98f8619`。
   - 两项先复制到应用根下独立备份目录，验证复制的 SHA256 及原件仍未变化，再移出冲突位置；保留 manifest 与原件恢复路径。原 MKV、字幕、旧源 NFO、fanart、torrent 不在隔离范围。
3. 已完成：《太阳帝国》精确On-deck Run为`28c2d89e239b3e6d50bbbcdaeafe37fb5e04685fe9a1aa1c68238863d673fbb9`。恢复前重新验证7项Final；generation 5正式retry成功，11项精确旧输入均absent，7项当前Inventory核验通过，246项范围外文件前后不变，BACKUP/META保留。详情见本包证据。
4. 两条均使用正式 `POST /v1/admin/formation/acceptance/:offerId/actions/retry`，以当前持久事实解析 Offer ID，不手改 Work/Event/Effect。若旧执行仍活动，先让修复后的当前 Owner 恢复流程收敛，不人为置终态。
5. 验收必须看到每条恰好一个 On-deck Commit、相应 Shelf Entry/Deck Fact、精确 Inventory 文件、settlement/member 终态及无活动相关执行。只看到 UI 进度变化不算恢复。
6. 《一战再战》保留合法外部下载；验证页面当前阶段及解释，不取消下载、不放宽 DV 转换、不调整14 GiB要求。
7. 回滚先保留新现场及失败证据；新镜像无 Schema 变更，可回滚 binary，但不把已完成的正常业务 Commit 当作应回滚数据库。冲突备份只在目标无人占用且核实当前 Owner 后恢复，禁止覆盖新产品。
