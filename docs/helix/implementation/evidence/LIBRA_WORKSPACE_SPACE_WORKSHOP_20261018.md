# Workspace 空间不足重试后转二号车间 — 2026-10-18

工作项：`LIBRA-WORKSPACE-SPACE-WORKSHOP`。用户追加“空间不足的话，反复尝试之后可以进入暂存区（2号车间）”。仅本地实施；无生产部署、清理、Reset或配置写入。

## 根因与实现

现有Run Coordinator每次执行真实Workspace空间检查，空间不足返回`waiting_for_resource / workspace_admission / insufficient_space`，保持active。Attention Workshop此前只认业务注意态，不把此返回计入转区，因此长期等待仍占来源一号席位。

扩展既有Libra Attention Workshop的进程内readiness观察：同一Owner fingerprint连续3次真实不足，每次计数至少间隔60秒；快速轮询不累计、计数饱和，不因中间重复轮询自唤醒。成功推进、原因变化或Owner fingerprint变化清零。转入前重启重新观察；计数不是持久业务事实，不恢复陈旧空间Evidence。

每个未交付Run均须满足自身资格，Season按Subject占一席；原有未分配材料责任、Open Work/Event和未收口Effect门禁保持。最终由既有转区事务重读Owner fingerprint并复验全局容量。二号满或0时保持一号占位，但已完成的空间不足观察保留，空位出现后的新真实不足检查可转入。

转区不更改Run状态、身份、Control或Workspace，不搬移/删除材料，不跳过原空间门槛。继续调用同一Run Coordinator；恢复空间后自动在二号继续，至既有Handoff B或合法终结释放位置与责任。普通encoder/volume等待不会因此转区。无schema/API/UI变更；Windows/Docker共用纯JS Owner逻辑，Desktop无变更。

SSOT在末尾追加本规则，保留既有机器合同引用位置；只更新source-map sourceDocumentDigest，121 capabilities /104 result families /210 tables /51 transactions /149 routes保持。

## 验证

- `node --test test/helix-architecture/p16-pipeline-admission.test.js`：17/17通过，新增5项覆盖计时间隔、快速轮询无唤醒循环、恢复/异因/Owner变化重置、转入前重启、满/0及空位恢复、Season逐Run门槛、执行安全与原子Owner变化拒绝。
- `libra-workshop-host.test.js`新增隔离真实Host旅程：1/1通过，161.1秒。使用disposable真实视频及正式Admin/Work/Effect链，Workspace statfs受控为0可用；仅推进注入时钟验证两次60秒间隔。实际快速重试不会立即转区；转区后下一Subject自动进入一号；真实关闭/重建Host保留位置；恢复真实statfs后2个原Run各完成一次On-deck Commit，Run数量仍2、位置/token最终0。没有操作生产或原始媒体。
- 原有二号Host旅程：1/1通过，44.2秒，缺身份→容量背压→真实重启→原Run在二号完成的旧行为保持。
- 二号配置API及204→210结构复制/回滚保护：4/4通过。
- 默认 `npm test`：676 tests，647 pass、29既有环境skip、0 fail，141.4秒。
- package boundary / forbidden semantics / manifests / SSOT source-map / P2 baseline通过；P2 aggregate保持`6d2541d40a33e9db3f4fa2d95ebca40ee69b9e020c97b415ac46109b742ab31b`。

未进行精确候选Linux/生产验证；本地通过不等于已经上线。
