# P4 Phase Exit Audit Evidence

Status: **PASS / CLOSED / ARCHIVED**

Audit date: 2026-07-17

## 1. Audited scope

| Field | Value |
| --- | --- |
| P4 baseline | `4a59356f3a89f1af38f594763aaaa0465e203b99` |
| Audited implementation commit | `fa8debb37cf118e39bb769f82336ecc0c0a1f2a3` |
| Audit scope | local Execution and Recovery Foundation only |
| Authorized SSOT repair | `4f3c41b9`；immutable Plan persistence gap only |
| SSOT Git blob digest | `962ff08531ce7f497d7939745784d469f576341d583fa8ba75d58e59b7554d2e` |
| SSOT contract aggregate | `8b250ce46f852c65b0843ef9a6e58dcf12d33258c22f3895ed7b0e513e5ba934` |
| P2 contract aggregate | `fe2f4433cab34d9c7dc4c682d92409552d3c50aee217bb477d553ccc89ef8160` |
| Exit evidence digest | `3c3053d37ffcc2836e5e07ae9fd73186bf0ddef8395c42163e227b74328a5827` |

## 2. Reverse traceability result

| SSOT contract | Audited result |
| --- | --- |
| Work/Attempt/Plan/Event state | exact nominal machines、immutable Plan、DAG and typed Result；PASS |
| Capability/Owner boundary | exact 112 Registry、Domain+Shared visibility、least-authority Context；PASS |
| Supply/Scheduler/priority | bounded supply、dependency readiness、five non-crossing priority classes；PASS |
| Resource/pressure | sole Governor、atomic Permit bundle、durable defer、persistent Circuit；PASS |
| Fence/Progress | double Fence、bounded monotonic technical samples、no auth/result extension；PASS |
| Retry/Timeout/Compensation | versioned exact policies、isolated timeout、predeclared non-destructive compensation；PASS |
| Effect recovery | seven exact classes、durable intent/receipt/marker/reality evidence；PASS |
| Startup readiness | read-only durable classification、no bulk reset or in-memory guard resurrection；PASS |
| Cross-process recovery | 31 crash scenarios；one Effect、one Marker、one fake dispatch；PASS |

## 3. Machine gates

```text
npm run test:helix-runtime
→ ok: true
→ scope: P4_LOCAL_CROSS_RUNTIME_RECOVERY
→ architecture fixture files: 50
→ Effect Classes: 7
→ cross-process crash scenarios: 31
→ prohibitedActionsRun: []

node media-service/scripts/helix-p4-exit-audit.js --require-clean
→ ok: true
→ scope: P4_EXIT_AUDIT_LOCAL_EXECUTION_RECOVERY_ONLY
→ audited commit: fa8debb37cf118e39bb769f82336ecc0c0a1f2a3
→ changed files: 73
→ findings: 0

npm run test:helix-persistence
→ 156 tables / 72 indexes / 19 partial unique
→ 18 canonical transactions / 132 crash points
→ prohibitedActionsRun: []
```

正式门禁与fresh detached worktree的`--require-clean`复审均PASS。首次Exit Audit只因Windows working-tree
CRLF字节被错误当作SSOT canonical digest而失败；`fa8debb3`改为同时校验Git blob digest与source-map aggregate，
消除了平台换行歧义，没有修改SSOT或放宽合同。

## 4. Changed-path and negative evidence

73个变更文件分类为：4 phase documents、1 authorized SSOT repair、2 dependency/command registration、5 isolated
runtime tooling、10 authorized repair tooling、7 repaired P2 contract artifacts、24 clean Execution Foundation artifacts、
20 isolated runtime fixtures。全部分类允许，findings为0。

- 未出现旧Kairox/Mirex/Nexora/Task Runtime引用、compatibility、dual path或fallback；
- 未出现Domain实现依赖、跨Owner Store、internal HTTP、第二Runtime或产品startup wiring；
- unknown Capability/Effect/Policy、orphan、Fence/Control/catalog/integrity drift全部fail closed；
- 进程崩溃后不会批量把executing改回ready，也不会恢复旧Permit/waiter/lease；
- Material与Destructive恢复保持forward-only语义；Runtime不能发明rollback；
- 所有DB和fake effect ledger均位于owned temp root并已删除。

## 5. Scope and safety proof

- 除用户授权的`4f3c41b9`最小Design修正外，未修改SSOT；
- 未接`server.js`、Composition Root、HTTP/API/Admin Web、P5 Adapter或任何Business Domain；
- 未读取凭据、旧Runtime data或工作区`data/`；
- 未运行E2E、Docker/Canary、production或真实来源；
- 未执行真实filesystem、Provider、Worker、FFmpeg、network或media effect；
- 未修改`media-desktop`，原dirty workspace保持隔离；
- `prohibitedActionsRun=[]`。

## 6. Exit decision

P4-00–P4-14全部满足Done。SSOT traceability、机器反例、P4单一聚合命令、P3 regression、独立Exit Audit和
fresh-worktree复现全部PASS。P4归档；依据standing Local Implementation authorization自动打开P5。P5仍只允许
fake/in-memory/owned-temp Adapter测试，真实Provider、Worker、FFmpeg和媒体文件副作用保持未授权。
