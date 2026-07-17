# P6-03 Perception Acquisition and Immutable Record Pipeline Evidence

Status: `PASS`

Date: 2026-07-17

## 1. SSOT traceability

| SSOT contract | Implementation evidence |
| --- | --- |
| §3.6.2–3.6.3 | Acquisition冻结Source snapshot、cursor page、Integration config、scope和normalization rule digest |
| §8.6.13 `perception.source.acquire@1` | 仅通过P5 Provider pure-observation port取得bounded references，再读取为immutable `PerceptionObservationPage` Evidence |
| §8.6.13 `perception.record.normalize@1` | matching source-kind的revisioned rule将Observation Page转换为`PerceptionAcquisitionCommitDraft`，不写Store |
| §8.6.13 `perception.record.commit@1` | `domain_fact_commit` registration绑定Perception Owner与exact revision fence |
| §8.5.13、§8.6.21 | Record/Anchor/lineage/cursor/receipt/typed Result、Foundation Result binding、Commit Marker和Outbox在单一UoW原子提交 |
| §8.8.2 | Provider failure、input digest drift、rule drift和commit drift均fail closed；不引入旧Runtime fallback |

## 2. Implemented flow

~~~text
Source snapshot + Cursor + IntegrationHandle
  -> Provider Observation reference page
  -> immutable PerceptionObservationPage
  -> revisioned normalization rule
  -> PerceptionAcquisitionCommitDraft
  -> P3 Domain Commit Coordinator
  -> Perception facts + cursor + typed Result + Marker + Outbox
~~~

Terminal Provider page使用由response digest派生的稳定terminal cursor token；这仍是新架构的显式cursor事实，不是旧Runtime fallback。Observation Page和Commit Draft各自受64 KiB上限约束。

## 3. Machine evidence

- `p6-perception-acquisition-pipeline.test.js`：`3/3 PASS`。
- 与P6 Store及P3 Domain Commit组合：`22/22 PASS`。
- Domain input schema（含integer `pageOrdinal`、positive `pageBudget`和nullable `cursorIn`）：`8/8 PASS`。
- Package/semantic/clean-skeleton guards：`21/21 PASS`。

反例覆盖Source/Integration config漂移、Source/Cursor digest漂移、observation payload tamper、normalization source-kind/rule digest漂移、stale commit fence、atomic rollback、marker replay和Outbox authority escape。

## 4. Remaining gate

P6-03不消费`perception.dedup.resolve@1`，因此可以独立PASS。P6-04仍不得开始物化dedup Result/Capability：当前SSOT把括号说明纳入了nominal output identity。Architecture Agent修正后必须重新生成并审计P2 contracts，禁止在生成器内清洗绕过。

无E2E、Docker、production、真实来源、真实媒体、Service startup或`media-desktop`动作；本线程未修改SSOT。
