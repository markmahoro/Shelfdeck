# P9-04 Workspace Admission and Material Reference Evidence

Status: PASS

Date: 2026-07-20

## SSOT traceability

- 唯一架构来源：`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md` 6.4.7、8.5.11、8.6.21及8.9.7。
- Architecture Agent的`8746dfb8`闭合Workspace admission、Platform root/space Evidence、Workspace revision与CAS连续性。
- Architecture Agent的`828d55b4`闭合完整`WorkspaceMaterialHandle@1`、Handle/fence公式、Product Media Verification、Reference revision与Decision/Result连续性；实现分支原样纳入为`c04be80d`。
- 实现任务未修改SSOT，未新增Owner、Store、Handoff、Capability、事务或兼容路径。

## Implementation evidence

- Workspace Admission只从active Libra Run、current Run revision、typed Platform Workspace Root Snapshot及fresh Space Evidence建立pathless Workspace Registry、Workspace、首个revision、Result和marker。
- Foundation Workspace Material保存完整read-only Handle JSON、digest、fence及必要hot columns；Libra不改写正式外部Input，也不从路径推断身份或权限。
- Workspace Reference以append-only revision保存完整Handle、`0..32` Episode claims、scope digest及可选Product Verification；working与product staging状态严格分离。
- Product staging promotion验证同Run、同Workspace Handle、同Handle/fence digest和稳定Verification ID；Reference、Workspace revision、Workspace CAS、Result及marker在同一SQLite transaction全有或全无。
- replay从Libra Owner rows与Foundation immutable Handle重新验证完整结果；Reference set受1024上限、current materialKey唯一及单Handle单current role约束。
- `LibraWorkspaceEpisodeClaims@1`、Workspace Reference Decision/Result/Snapshot和Product Verification Snapshot已物化为closed typed application schemas。

## Machine counterexamples and tests

- stale Workspace/Run revision、过期Space Evidence、伪造Handle、错误Physical Identity、跨Handle Verification、非法Reference转换和重复materialKey均fail closed。
- Foundation participant或Reference事务注入crash时，Registry/Workspace/Reference/revision/CAS/Result/marker全部回滚。
- marker replay返回原typed Result，不重复写Workspace或Reference revision；测试确认不执行文件复制、移动、删除或真实媒体动作。
- 完整`npm run test:helix-architecture`：PASS；108 fixture files，dependency/semantic/contracts均`findings=[]`。
- 合同计数保持112 Capability、97 Catalog Result family、176 tables、43 Canonical Transactions；P2 aggregate为`530909a2cd450d3638286cb8966ccd6d11bfca67e591da412bd4542ddb8db1a9`。
- 未运行E2E、Docker、Canary、生产、真实媒体副作用；未触碰`media-desktop`。

## Exit decision

P9-04 PASS。Workspace admission、完整Material Handle、Reference revision、Product Staging promotion、Owner-row恢复、digest/revision/CAS、重放和crash atomicity均已闭合。下一工作包为P9-05 Product facts, metadata, cast and artifacts。
