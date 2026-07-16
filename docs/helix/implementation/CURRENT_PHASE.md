# ShelfDeck Clean Helix Current Phase Execution Packet

Current phase: `P5 — Platform and Integrations`

Status: in progress；P5-00–P5-04 complete；P5-05 next；P4 Exit Audit PASS；standing P2–P13 Local Implementation authorization active.

Last updated: 2026-07-17

## 1. Authority and authorization

本文件是唯一活动Phase详细执行包，从属于：

1. `../TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`；
2. `../CURRENT_PLAN.md`；
3. `../ENGINEERING_PLAYBOOK.md`；
4. P2合同、P3 Persistence与P4 Execution Foundation冻结Evidence。

SSOT仍是唯一架构Authority。P5只实现Platform技术Registry、typed Integration port和原子底层library；不得把
External Provider、Filesystem、FFmpeg或Worker变成Business Owner，也不得让Adapter写Domain Fact。

继续需要单独授权：真实来源E2E、Docker/Canary、production、真实媒体副作用和`media-desktop`。因此P5所有外部行为
只能使用fake adapter、owned temp root和合成小文件；不得读取真实凭据、Provider、媒体库或工作区`data/`。

## 2. Phase objective

在P3/P4 clean ports之上建立Platform与Integration substrate：Secret Reference、Mount Scope、Workspace Root、Artifact
Registry、Resource/Worker Registry，以及Filesystem/Hash/FFmpeg/Provider/Worker的versioned typed ports和安全handle。
这些组件只提供技术访问、Evidence与Effect Receipt，不创建Subject、Run、Shelf Entry、Decision、Handoff或任何Domain Fact。

## 3. Baseline and protected workspace

| Field | Value |
| --- | --- |
| P0 code audit baseline | `4a16f0a94ef23fcf732843e9547bd7b724d9c19d` |
| P4 audited implementation | `fa8debb37cf118e39bb769f82336ecc0c0a1f2a3` |
| P4 Exit evidence | `evidence/P4_PHASE_EXIT_AUDIT_FA8DEBB3.md` / digest `3c3053d3…` |
| P5 exact phase baseline | `5dd0b7094ea35cc04c7ba931fd109467462d0af6` |
| Phase branch/worktree | `codex/helix-p5` / `E:\my_project\emby_third_party-helix-p5` |
| Original workspace | `E:\my_project\emby_third_party` on `master`；dirty user work preserved |
| Excluded | real credentials/providers/files/media/FFmpeg/Worker、product startup、API/UI、E2E、Docker、production、`media-desktop` |

## 4. In scope

- Platform-owned Secret Reference、Mount Scope、Workspace Root、Artifact、Resource Profile/Device/Worker registries；
- typed opaque handles with owner scope、purpose、identity、revision、expiry and least authority；
- deterministic Physical Material Identity and binding-health primitives from explicit synthetic observations；
- typed Provider request/result/receipt ports with payload bounds and no shared Metadata Store；
- filesystem transaction、hash/probe and FFmpeg/Worker protocol atoms using fake/owned-temp adapters；
- P4 Effect Class、Fence、idempotency and Receipt integration without real dispatch；
- static dependency guards and isolated local contract/crash fixtures。

## 5. Out of scope

- any Domain Planner、Process、Decision、Business Fact、Handoff or Domain Repository；
- real Provider credentials、network calls、FFmpeg process、remote Worker or user media access；
- central Metadata domain/cache、global media ID、SourceBinding or cross-domain Store；
- product Composition Root/startup、HTTP/API/Admin Web and `media-desktop`；
- E2E、Docker/Canary、production、real media effects or migration of legacy settings/data。

## 6. Work Package index

| ID | Title | Status | Dependencies |
| --- | --- | --- | --- |
| P5-00 | P4 closure and isolated P5 baseline receipt | complete | P4 PASS |
| P5-01 | Platform and Integration public nominal ports | complete | P5-00；P2 contracts |
| P5-02 | Secret Reference and least-authority credential resolver | complete | P5-01；P3 Persistence |
| P5-03 | Mount Scope and Workspace Root registries | complete | P5-01–P5-02 |
| P5-04 | Physical Material Identity and binding-health primitives | complete | P5-03 |
| P5-05 | Artifact Registry and controlled payload handles | next | P5-03–P5-04 |
| P5-06 | Typed External Provider protocol adapters | pending | P5-01–P5-02、P5-05 |
| P5-07 | Filesystem transaction、probe/hash and FFmpeg atoms | pending | P5-03–P5-05 |
| P5-08 | Resource、device and passive Worker registries/protocol | pending | P5-01–P5-03；P4 Governor |
| P5-09 | Material Access Handle issuer and Fence enforcement | pending | P5-03–P5-08；P3 Control、P4 Fence |
| P5-10 | Cross-platform isolated integration verification harness | pending | P5-01–P5-09 |
| P5-11 | P5 Phase Exit Audit and evidence freeze | pending | P5-00–P5-10 |

## 7. Work Package contracts

### P5-00 P4 closure and isolated P5 baseline receipt

- Freeze the exact P4 phase-closure commit and create an isolated P5 branch/worktree from it.
- Re-run P4 Exit Audit and P3 regression in fresh checkout；verify original dirty workspace and `media-desktop` remain unchanged.
- Record the exact baseline before Platform or Integration implementation starts.
- Done: `codex/helix-clean` was fast-forwarded to exact P4 phase closure `5dd0b7094ea35cc04c7ba931fd109467462d0af6`，
  and isolated `codex/helix-p5` / `E:\my_project\emby_third_party-helix-p5` was created from that commit. Fresh checkout reran
  `P4_LOCAL_CROSS_RUNTIME_RECOVERY` with 51 architecture fixture files、7 Effect Classes and 31 cross-process crash scenarios，plus
  P3 156 tables/72 indexes/19 partial unique and 18 transactions/132 crash points；all PASS with `prohibitedActionsRun=[]`.
  Frozen P4 Exit Evidence still binds audited implementation `fa8debb3` and the docs-only closure adds no Runtime artifact. Original
  dirty workspace and `media-desktop` remain unchanged；no P5 implementation started before this receipt.

### P5-01 Platform and Integration public nominal ports

- Publish only typed registry/query/resolve/execute ports；never expose credentials、raw SQLite、generic request or child-process handles.
- Every port declares Owner、input/output schema、Effect Class、idempotency、Fence and payload bound.
- Static guards reject Domain Fact writes、internal HTTP、global Store and legacy adapter imports.
- Done: 17 immutable `@1` nominal contracts publish 10 Platform query/resolve ports and 7 typed Integration execute ports.
  Every contract declares Owner、input/output schema refs、P4 Effect Class、idempotency、Fence and byte bounds. Exact-shape
  factories reject added Repository/SQLite/Domain-write/HTTP/generic-request/process authority. Focused 19/19 and full
  architecture gate PASS with 47 packages、52 fixture files、0 dependency/semantic findings and `prohibitedActionsRun=[]`.
  Evidence: `evidence/P5_01_PUBLIC_NOMINAL_PORTS.md`.

### P5-02 Secret Reference and least-authority credential resolver

- Persist only opaque Secret Reference metadata；secret values never enter DB、logs、Result、Artifact or test snapshots.
- Resolve by exact integration/purpose/scope for one bounded invocation；unknown、wrong scope or stale revision fails closed.
- Fixtures use synthetic in-memory secrets only and prove ambient environment credentials are not inherited.
- Done: Platform-owned P3 Repository persists only exact opaque Secret Reference metadata. A one-shot lease broker requires exact
  owner scope/kind/revision/purpose、caps TTL at 60 seconds、freezes a Fence digest、rejects replay/expiry/async retention and
  wipes owned bytes after synchronous use. Wrong scope、stale revision、denied purpose、revoked state and error-redaction negative
  fixtures PASS；full architecture and P3 persistence regression remain PASS. Evidence: `evidence/P5_02_SECRET_REFERENCE_AND_LEASE.md`.

### P5-03 Mount Scope and Workspace Root registries

- Platform owns stable Mount Scope、Endpoint and controlled Workspace Root technical facts；no Domain-local Binding ownership moves here.
- Canonical containment rejects traversal、symlink escape、cross-scope path and unregistered root.
- Registry revisions are typed and immutable/current-headed；location remains outside Physical Material Identity.
- Done: Mount Scope uses atomic head/revision bootstrap and exact current+1 CAS；active fingerprints are unique and every field
  must match synthetic probe evidence. Three exact Workspace Root kinds map to technical owner scopes and require resolved-path plus
  create/write/atomic-rename/read/delete capability evidence. Canonical POSIX/Windows guards reject traversal、realpath drift、root
  nesting and formal Material Field/Shelf target overlap. Focused 7/7、full architecture and P3 persistence gates PASS. Evidence:
  `evidence/P5_03_LOCATION_REGISTRIES.md`.

### P5-04 Physical Material Identity and binding-health primitives

- Derive identity only from explicit mount-scoped filesystem object key plus full content hash using the frozen algorithm contract.
- Hash cache/revalidation is Evidence，not a global media object or Field membership；location-only change preserves identity.
- Synthetic fixtures cover rename、content change、inode reuse、missing/unreadable and mount-scope separation.
- Done: the pure factory reproduces and cross-validates P3's single canonical `materialKey` algorithm from exact Mount Scope + inode
  + full SHA-256. Hash reuse requires all trustworthy stat-fence fields unchanged. Binding Health keeps endpoint、location、object
  and hash reasons separate；endpoint outage never becomes false missing. Reliable exact-scope Evidence alone may evolve location while
  unchanged Identity remains outside the Binding. Focused 10/10、full architecture and P3 persistence PASS. Evidence:
  `evidence/P5_04_PHYSICAL_IDENTITY_AND_BINDING_HEALTH.md`.

### P5-05 Artifact Registry and controlled payload handles

- Large payloads live only under controlled Artifact/Workspace roots；hot records contain typed checksum/size/owner/scope/reference.
- Create/read/release operations require exact containment and purpose；reference does not grant Domain ownership or Material Control.
- Orphan、checksum drift、scope mismatch and deletion without authority fail closed.

### P5-06 Typed External Provider protocol adapters

- Implement versioned provider-specific protocol atoms behind exact ports；External Provider remains information/service only.
- Enforce request timeout/idempotency/payload bounds、typed receipt and redaction；no central Metadata business Store/cache.
- Tests use deterministic fake transports only；no DNS、socket、credential or real provider request.

### P5-07 Filesystem transaction、probe/hash and FFmpeg atoms

- Split observation、staged write、atomic promote、declared cleanup and destructive commit into exact Effect-class operations.
- FFmpeg/probe invocation is represented by typed command/result adapters；no shell string、path escape or undeclared overwrite.
- Tests use fake process adapters and owned-temp synthetic bytes only；no installed FFmpeg or real media invocation.

### P5-08 Resource、device and passive Worker registries/protocol

- Platform records versioned Resource Profile、validated device/volume/endpoint and passive Worker capabilities/health.
- Worker accepts one typed job and returns Result/Receipt；it never polls Store、owns Work or writes Domain facts.
- P4 Governor consumes only validated resource projections；unknown/unhealthy capacity remains zero.

### P5-09 Material Access Handle issuer and Fence enforcement

- Issue one invocation-scoped handle freezing identity、binding、Control、permission、containment and Fence revision.
- Read/write/promote/delete authority is explicit and non-escalating；Related reference does not imply write or Control.
- Stale Control/Binding/Auth、wrong Owner/purpose、scope escape and handle replay after expiry fail before effect.

### P5-10 Cross-platform isolated integration verification harness

- One local command verifies all registries、ports、redaction、containment、identity、Artifact、Provider、FFmpeg and Worker contracts.
- Inject fake crashes around staged/observed/promoted/receipt boundaries and prove stable P4 recovery without duplicate fake effect.
- Harness cannot read ambient credentials、start Service、bind ports、invoke real binaries/network or access non-temp media.

### P5-11 P5 Phase Exit Audit and evidence freeze

- Reverse-audit SSOT Levels 7–8/10 and P2–P4 contracts，including Owner、handle authority and Adapter dependency direction.
- Prove no Domain/API/UI/Composition Root、legacy adapter、shared Metadata Store or real external effect entered P5.
- PASS archives this packet and opens P6 under standing authorization.

## 8. Execution order

```text
P5-00 → P5-01 → P5-02 → P5-03 → P5-04 → P5-05
                                      ├──────→ P5-06
                                      ├──────→ P5-07
                                      └──────→ P5-08 → P5-09 → P5-10 → P5-11
```
