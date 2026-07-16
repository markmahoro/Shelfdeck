# P5-02 Secret Reference and Least-authority Lease Evidence

Status: **PASS / COMPLETE**

Audit date: 2026-07-17

## 1. SSOT traceability

| SSOT contract | Implementation evidence |
| --- | --- |
| §8.3.8 Adapter receives a short Handle, not Platform Store | `SecretLeaseBroker.issue()` returns one frozen bounded handle without locator or secret bytes |
| §8.5.13 `platform_secret_refs` owns opaque metadata | Platform-owned Repository writes only exact table columns through P3 registered statements/UoW |
| §8.6.17 dependencies are injected | repository、secret source、purpose policy、clock、ID and digest are explicit constructor dependencies |
| §8.6.18 `IntegrationHandle`/`WorkerHandle` freeze revision and Fence | lease freezes exact owner scope、kind、purpose、revision、expiry and fence digest |
| §9.6.7/9.6.9 Secret is masked/non-persistent | secret material never enters DB、handle、error details、logs or snapshots |

## 2. Security and authority result

- Repository保存`secret_ref + exact owner scope + kind + opaque locator + revision + state`，不保存secret value；
- issue必须精确匹配owner scope type/id、secret kind、active revision和显式purpose policy；
- TTL上限60秒，ID必须唯一，Fence必须是合法SHA-256 digest；
- consume只允许原始Handle对象一次，过期、伪造、重复或异步consumer全部fail closed；
- secret source只在consume时读取owned Buffer；同步调用结束后无条件清零；
- source或consumer异常被转换为无secret、无locator的稳定错误；
- 实现不读取`process.env`，测试只使用显式in-memory synthetic source。

## 3. Machine evidence

```text
node --test p5-secret-lease + p5-public-ports
→ 9/9 PASS

npm run test:helix-architecture
→ fixture files: 53
→ packageCount: 47
→ dependency findings: []
→ semantic findings: []
→ prohibitedActionsRun: []

npm run test:helix-persistence
→ 156 tables / 72 indexes / 19 partial unique
→ 18 canonical transactions / 132 crash points
→ prohibitedActionsRun: []
```

Negative fixtures覆盖wrong owner scope、wrong secret kind、stale revision、denied purpose、revoked reference、TTL超限、
expiry、handle replay、consumer exception和async retention。数据库与Handle JSON均证明不含synthetic secret。

## 4. Scope proof

- 没有真实credential、OS credential store、environment secret或Provider/network调用；
- 没有把secret写入Domain、Foundation、Artifact、Result、Audit或Projection；
- Platform UoW没有混入Domain/Foundation Repository；
- 没有连接Composition Root、startup、API/UI或真实Adapter；
- 未运行E2E、Docker、Canary、production或真实媒体副作用；
- 未修改SSOT或`media-desktop`。

## 5. Decision

P5-02满足Done。下一步P5-03建立Mount Scope与Workspace Root registries；它们只能保存Platform技术事实，不能
吸收Field/Shelf的Domain-local Binding ownership。
