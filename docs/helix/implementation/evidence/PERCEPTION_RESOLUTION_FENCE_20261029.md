# Perception Resolution 冻结输入与 Effect 恢复证据

2026-10-29。本记录针对独立候选 `8153b403e49c659227beb61a7c1cb15b2c1e1807`；基础版本为 `27a0f68af3599a3422b21853632fc8a01878b750`。实现依次为 `14241bcfda168cf63c9b09f73ee5b069830344dc`、`1e562453f5f4297953cfed8714f4a637f51322f8`、`8153b403e49c659227beb61a7c1cb15b2c1e1807`。第三个提交只增加测试。没有访问或修改 NAS、生产数据库或生产文件。

## 根因与合同

原始 Commit Handle projection 使用当前 Target 派生的 Query 和当前 Record Set，但要提交的 Draft 已由此前 Resolve 固定。Target revision 变化时，同一 Handle 与 Draft 的 aggregate identity 不一致；Store 严格拒绝 `P6_PERCEPTION_RESOLUTION_COMMIT_MISMATCH`。独立候选的自然 Host 复现及 `a2bf2d6fd` 基线的受控复现材料保存在整合任务私有 `resolution-investigation/REPORT.md`；不能据此推断全量门禁首次失败样本的精确原因或生产中所有条目的状态。

SSOT §6.8.2 要求 Perception Owner 依据完整 Query、Record Set、Rule 形成不可变 Draft，相同三重 digest 已有 current Resolution 时 no-op；任一 digest 改变后必须先形成新的 Resolution，才能返回当前 found/not_found。SSOT §7.9.2 要求 `domain_fact_commit` 未知中断点先核对原 Effect 的 Marker、revision 和同事务 typed Result，已提交时返回原 Result，未提交时重验 Fence。实现保留该 Owner、事务及类型合同：

- Handle aggregate、payload、marker identity 与冻结 Draft 绑定，分别校验 Draft 完整性、Work basis 和当前三重 digest。读取 head 在当前输入校验之前完成；如果另一 Resolution 随后先提交，旧 Handle 的 head CAS 必须失败。
- 当前 basis 已提交则不追加重复 revision。输入被取代时，旧 Work 依据当前状态在同 basis 下有界重新规划或终结，再由 Owner 取得当前 basis 的后继 Work；目标消失则不发明后继目标。相同 basis 的重新规划使用持久前次 Attempt 完成时间与退避，最多三个 Attempt。
- 已持久化的原 Effect 只能在 Observer 再次证明精确 Marker 不存在且 Fence 允许时终结；已存在 Marker 与 typed Result 时，Foundation 依据注册的 schema alias、通用 DomainFactEnvelope 和原 Effect/Attempt/Marker/Result 关系恢复原 Outcome，不读取 Perception 内部表，也不重新生成业务事实。

## Commit projection 之后的输入变化

事务提交前即使 Target 或 Record Set 再变化，已有 Draft 及其 Handle 仍只绑定冻结的 Query/Record Set。若还没有较新的同 Query head，旧 Result 可以作为该冻结输入的历史 revision 原子提交；Perception 的当前读取与 Decision Facade 会重新组成当前 Query 和 Record Set，比较三重 digest，并在不匹配时返回 pending。旧 Work 成功后 Owner reconcile 当前 basis，形成后继 Work 和新 Resolution。若较新的同 Query head 已先提交，旧 Handle 的 revision CAS 失败，不能覆盖新 head，也不能留下孤立 Marker 或 Result。Target 改变造成不同 Query 时，旧 Query 的 revision 不会冒充新 Query 的结果。

`p6-perception-store.test.js` 分别在 projection 后改变 Target 和追加同 Query 的冲突 Record，验证历史 Result、当前 pending、当前 basis 后继 Work 和新结果；另验证新 head 抢先提交时旧 head CAS 拒绝、同三重 digest 不追加 revision、破损 Draft 和目标消失拒绝。`helix-perception-acceptance-spec-e2e.test.js` 通过真实 Host 在 projection 后、事务前改变公开 Target，事务完成后立即读取 current 状态为 pending，随后新 basis Work 成功。

`event-execution-input-provider.js` 的每次 `resolveBindings()` 都新建本次 `ownerScope`；同一次同步 `prepare()` 的多个 projection 共用它，Resolve、Commit、同 Event 重试/恢复、新 Work Attempt 及新建 Provider 各自创建新对象。`p4-event-execution-input-provider.test.js` 在真实 Provider 上验证这些对象身份，包括人为重复传入相同 `preparationScope`；真实 Host 在 Resolve 成功后改变 Target 并观察 Commit 被判 superseded，确认没有沿用 Resolve 的旧缓存。

## 定向验证

代码冻结版本均为 `8153b403e49c659227beb61a7c1cb15b2c1e1807`。Windows 11 x64 使用 Node 25.9.0；Linux 使用无网络 WSL2 Docker、Node 20.20.2，镜像 `shelfdeck-series-gate:27a0f68af` 的镜像 ID 为 `sha256:5573c02138922b23e0ab99a342786345f4fae65b5503712e6235847f360b587e`，源码只读挂载，依赖来自本地只读 dependency volumes。测试数据库、注入和进程退出均使用一次性合成目录。

| 验证 | Windows | Linux |
| --- | --- | --- |
| Event Runtime、Input Provider 与 Perception Store | 128 PASS / 0 FAIL | 128 PASS / 0 FAIL |
| 7 个 Resolution 真实 Host 变化、故障和重启场景 | 7 PASS / 0 FAIL | 7 PASS / 0 FAIL / 3 名称过滤 skip |
| 既有 Foundation Work 生命周期与取消合同 | 22 PASS / 0 FAIL | 22 PASS / 0 FAIL |
| 原始 Series 并发 Host 场景 | 未运行 | 1 PASS / 0 FAIL / 29 名称过滤 skip |

Host 故障测试分别在原 Effect intent 之后、事务执行前和事务提交后强制中断；重启后验证原 Effect 的同一 Marker/Result 数量为 0 或 1，并验证当前 basis 的后继 Work。输入未变化时，原 Effect 按原 Attempt 安全重试，不创建额外 Event Attempt。Store 测试覆盖同 Query 竞争 head、冲突值、目标消失和破损 Draft；Foundation 测试拒绝错误 aggregate、Marker、intent、scope 和 Result schema。额外的 Windows 边界/事务检查在代码相同的 `1e562453f` 上为 107 PASS / 0 FAIL；它不是 `8153b403e` 的全量验证。

对应私有原始日志 SHA-256：

| 日志文件名 | SHA-256 |
| --- | --- |
| `perception-fence-8153b403e-windows-units.log` | `eb27729d7b9c7e9ed164e1e6fa6165a13ef29f0ba418e05b658f8330a8f1ee62` |
| `perception-fence-8153b403e-linux-units.log` | `5a97e3d932992a7523dac8cfcf637bb4d2af7eae0c3e814ce48fdd925113ea53` |
| `perception-fence-8153b403e-windows-host.log` | `89d82e2b3cbf7ae2115d766d7dadd654f12c78fe0e827e45e58f56b8d4ea83c5` |
| `perception-fence-8153b403e-linux-host.log` | `3e575eb91b11299e5f4d25469028f0218053d5d4ea159e7d5c0739fd0fc3b9ed` |
| `perception-fence-8153b403e-windows-cancellation.log` | `3e4254f2d328aaac9ac9bc322f6508b5b9e59cea66133da958dda546f5b316c8` |
| `perception-fence-8153b403e-linux-cancellation.log` | `926a23cb479ee1f61158507ac56d0e19a2b088667eef98401d62811f080e38f2` |
| `perception-fence-8153b403e-linux-series.log` | `09e30ee8840a0e06a0314c6c2c83fa071fff696794881dafd49b0c5d189d0457` |

这些是定向合成测试，不代表全量架构门禁、生产 CIFS、NAS 部署资格或既有生产条目已经自愈。首次全量失败及受控诊断保留在原整合任务证据中，不被上述通过结果替代。
