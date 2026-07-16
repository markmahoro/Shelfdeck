# P5-04 Physical Material Identity and Binding Health Evidence

Status: **PASS / COMPLETE**

Audit date: 2026-07-17

## 1. SSOT traceability

| SSOT contract | Implementation evidence |
| --- | --- |
| §3.2.4 `filesystemObjectKey = mountScopeId + inode` | identity factory accepts exactly stable Mount Scope ID and native inode |
| §3.2.4 Identity also requires byte content hash | only complete full-file lowercase SHA-256 can derive an Identity |
| §7.6.1 `materialKey=sha256(canonical tuple)` | focused test passes produced identity directly to frozen P3 `materialKey()` validator |
| §7.6.1 hash reuse requires exact stat fence | mount scope/revision、inode、size、mtimeNs、ctimeNs and trustworthy nanosecond stat must all match |
| §3.2.4 Binding Health is endpoint + location + object key + hash | exact evaluator returns healthy only when all four conditions pass |
| §3.2.4 location is outside Identity | location is absent from identity tuple；rename can update only Binding with reliable exact-scope Evidence |

## 2. Identity and health result

- The implementation does not define a second material key algorithm. It reproduces P3 canonical sorted JSON and verifies every
  generated identity through `foundation/persistence/material-control.materialKey()`；
- filenames、paths、size、timestamps、fast fingerprints and partial hashes cannot derive Identity；
- same mount scope + inode + full hash remains the same identity across location rename；
- mount change、inode change (including inode reuse with changed stat/content) or byte change produces a new identity；
- cached full hash is reusable only with exact current Mount Scope revision and all trustworthy nanosecond stat fields unchanged；
- endpoint unreachable reports only `endpoint_unreachable` and never falsely claims `location_missing`；
- missing、unreadable、location mismatch、filesystem object mismatch and content hash mismatch remain distinct reason codes；
- a location revision is allowed only when Identity is unchanged and reliable Evidence matches endpoint and Mount Scope revision。

## 3. Machine evidence

```text
node --test p5-material-identity.test.js p3-material-control.test.js
→ 10/10 PASS

npm run test:helix-architecture
→ fixture files: 55
→ packageCount: 47
→ dependency files/dependencies: 45/56
→ dependency findings: []
→ semantic files: 1424
→ semantic findings: []
→ P2 aggregate unchanged: bcde76e0d380ead9fbe9c76c6c21293325d2de3dd97144c1357438c3d3cc8530
→ prohibitedActionsRun: []

npm run test:helix-persistence
→ 156 tables / 72 indexes / 19 partial unique
→ 18 canonical transactions / 132 crash points
→ prohibitedActionsRun: []
```

Negative fixtures cover incomplete/alternate hash、mount separation、same-hash different inode、content change、all stat-fence
changes、untrusted stat、endpoint outage、missing、unreadable、location/object/hash mismatch and weak relocation Evidence。

## 4. Boundary and safety proof

- Physical Material Identity remains deterministic Evidence, not a Platform or Domain business aggregate；
- Binding Health is a pure diagnostic result and does not update any Domain Binding；
- no Identity grants Material Control、write permission、Business ownership or Handoff；
- no global media ID、global Binding or cross-domain Store was introduced；
- no file scanning、Journal、rename listener、real hashing or real media read occurred；
- no Composition Root/startup/API/UI wiring、E2E、Docker、Canary or production action occurred；
- SSOT and `media-desktop` were not modified。

## 5. Decision

P5-04 satisfies Done. P5-05 may use the same containment and digest primitives for controlled Artifact handles, but Artifact identity
must not become Physical Material Identity or a new media business object。
