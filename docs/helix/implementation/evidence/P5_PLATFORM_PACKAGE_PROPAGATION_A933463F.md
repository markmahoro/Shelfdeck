# P5 Platform Package SSOT Propagation Evidence

Status: **PASS / BOUNDED PROPAGATION COMPLETE**

Audit date: 2026-07-17

## 1. Source and authority

| Field | Value |
| --- | --- |
| Architecture Agent source commit | `18746060 docs: align Helix platform package boundary` |
| Implementation-branch integration commit | `a933463f docs: align Helix platform package boundary` |
| Implementation-thread governance commit | `9a91a88a docs: forbid ssot edits in implementation threads` |
| Propagation scope | SSOT source locators、derived contracts、physical package skeleton、dependency guard and tests |

本线程没有编辑SSOT。`a933463f`是对Architecture Agent已评审提交的原样cherry-pick；后续工作只传播该提交的
派生影响。任何新的SSOT矛盾仍须停止实现并上报Architecture Agent，不能在本线程直接修正。

## 2. Bounded propagation result

| Contract | Before | After | Result |
| --- | --- | --- | --- |
| SSOT Git blob/source digest | `962ff08531ce7f497d7939745784d469f576341d583fa8ba75d58e59b7554d2e` | `d5426ec79f6fcff3ef287b89804aebd63d422e6da62297507a2d4ca76265555a` | Architecture Agent change only |
| SSOT source-map aggregate | `8b250ce46f852c65b0843ef9a6e58dcf12d33258c22f3895ed7b0e513e5ba934` | `fa27242e59bc670ff351877680d6e41d4905e91a26e2c87a4ef911ae22726aea` | rematerialized |
| P2 contract aggregate | `fe2f4433cab34d9c7dc4c682d92409552d3c50aee217bb477d553ccc89ef8160` | `bcde76e0d380ead9fbe9c76c6c21293325d2de3dd97144c1357438c3d3cc8530` | rematerialized |
| Table contract aggregate | `7ad7a3051530a8801d90260cfef4fc3fb9cb1e0ac606f7662ff65c9e864300c9` | `b1b3028a6fc3bda147aecf56856ff2cd5b79181801f8c1d280d0c85da9b19ccb` | locator-only propagation |
| DDL digest | `29a8e6b6c857ab551b25197231ef6e37feb1e5ea4ee469f31d50ba181a4db7b5` | unchanged | no persistence semantics changed |
| Package boundaries | 43 | 47 | exact four-layer Platform package added |
| Catalog counts | 112 capabilities / 96 Result families / 156 tables / 18 transactions | unchanged | no business contract expansion |

新增物理包严格对应SSOT：`platform.public`、`platform.model`、`platform.application`和
`platform.persistence`。Platform不是第六Business Domain，不拥有Domain Fact；唯一公开入口是
`platform/public/index.js`。依赖矩阵允许Composition、Domain application、Foundation和Integrations读取
`platform.public`，同时拒绝任何调用方越过公开入口访问Platform内部层。

## 3. Machine evidence

```text
focused clean-skeleton/source-map/package-boundary tests
→ 25 tests PASS

npm run test:helix-architecture
→ packageCount: 47
→ dependency files: 35
→ dependency findings: []
→ semantic files: 1413
→ semantic findings: []
→ P2 aggregate: bcde76e0d380ead9fbe9c76c6c21293325d2de3dd97144c1357438c3d3cc8530

npm run test:helix-persistence
→ 156 tables / 72 indexes / 19 partial unique
→ 18 canonical transactions / 132 crash points
→ DDL digest unchanged
→ prohibitedActionsRun: []
```

反例明确证明：允许的调用方只能导入`platform.public`；直接导入`platform.application`、
`platform.model`或`platform.persistence`会被package-boundary guard拒绝。

## 4. Scope and safety proof

- 没有在本线程编辑SSOT，也没有放宽或重解释Architecture Agent提交；
- 没有增加compatibility、dual-read/write/run、legacy Runtime fallback或跨域Store；
- 没有连接产品startup、HTTP/Admin Web、真实Provider/Worker/FFmpeg或真实filesystem effect；
- 没有运行E2E、Docker、Canary、生产或真实媒体副作用；
- 没有修改`media-desktop`；原始dirty workspace保持隔离；
- 本证据只关闭Architecture Agent修正的派生传播，不宣称P5-01完成。

## 5. Decision

Architecture Agent对`platform/`物理包边界的修正已完整传播到代码结构、机器合同和守卫。架构与持久化
回归门禁PASS，可以在不触碰SSOT的前提下继续P5-01公开nominal ports实现。
