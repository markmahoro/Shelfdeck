# P14 JAV Routing / Acceptance Spec / Active Run Checkpoint

状态：**FROZEN — 待 Architecture active review / P14 独立复验**

## Baseline 与范围

- Accepted source baseline：`26b63c4e`。
- P14 Handoff A evidence：`94c060d1`（local tested `95f0daf3`）。
- Architecture SSOT last-touch baseline：
  `6178437b8648c3557ce54d2001881cbc83748826`。
- 本检查点只覆盖：
  `accepted single/jav Subject → Routing Assessment/Decision
  → Decision Basis → Acceptance Spec → active Libra Run`。
- 明确未进入：Workspace、Provider、Product Facts、Production、Handoff B、
  Western Adult、横向 Feature Matrix。
- Architecture SSOT 未修改。

## Typed continuity

- 复用既有 Movie/Series Formation Coordinator、Libra Owner Stores、正式 Arca
  Routing Target/Standard projections 与 canonical transactions；没有 JAV
  专用 Store、跨 Owner 读取或 Composition 业务判断。
- 正式 Admin HTTP 创建 active JAV Shelf，绑定
  `system-beta-recommended@1`，再发布 Field Routing Policy。唯一匹配目标被解析为
  `jav-routing-shelf`；inactive 高优先目标继续使用共享的
  `higher_priority_rule_unknown` fail-closed 语义，不会落穿。
- Candidate 的 `jav_code` 只保留为 Handoff A 的 weak/correctable Evidence；
  本段没有创建 Resolved Provider Identity、Provider Result 或 Arca Canonical
  Identity。
- JAV Profile 的 `decisionInputKinds=[]`。Acceptance Spec Basis 不含
  `decision_fact` / `query_result`，Perception Resolution 行数为零。
- Acceptance Spec 从 exact Shelf Standard 派生：
  - `single` structure；
  - identity `jav_code`；
  - required metadata fields：
    `genre,jav_code,release_date,studio,title`；
  - required artifacts：`fanart,nfo,poster`；
  - mandatory media：HEVC + Matroska + `.mkv`；
  - Product space：2 GiB / 2147483648 bytes。
- Run Admission 冻结同一 Subject/Decision/Spec/Standard/Control head。Run
  Material Manifest 为 `run_input/single`，恰有一个 `primary_payload`，Episode
  claims 表为零。

## Owner / Transaction 与恢复

- Arca 只通过既有 public Projection port 提供 active Shelf、Routing Target 与
  Shelf Standard；Libra 只写自己的 Basis、Routing Decision、Spec、Run 与
  Manifest Owner rows。
- Composition Root 只装配共享端口；当正式 JAV Provider adapter 尚未装配时，
  clean host 在 `libra_run_active` 返回，不调用 Workspace/Production。该门禁与
  Series 已接受的 adapter-availability 门禁共用，不是 fallback。
- exact HTTP replay 在重启后保持同一 Routing Decision/Basis/Spec/Run/Manifest
  identity 与 digest，只返回持久化结果；same key/different payload 为 409。
- 共享反例覆盖：
  - stale Subject / Routing Policy / Routing Basis / Material Control；
  - inactive 高优先 Shelf 不落穿；
  - Spec publication CAS；
  - Run Admission Control stale；
  - Run domain/Foundation Result/marker 写入故障全事务回滚。
- restart/replay 后 `fx_workspace_registry=0`、
  `libra_product_fact_revisions=0`，未发生 Provider 调用或 Product 写入。

## 验证

- 新增 JAV public HTTP + retained P14 sample / built-in FFprobe：`2/2 PASS`。
- Routing/Spec/Run/CAS/rollback/JAV Handoff regression：`28/28 PASS`。
- 完整 `npm run test:helix-architecture`：
  `132 files PASS`，findings 与 `prohibitedActionsRun` 均为空。
- 机器库存：
  112 Capabilities / 97 Result families / 177 tables /
  43 canonical transactions / 114 routes / 18 UI surfaces。
- Contract aggregate：
  `30089e947738bab7933af3b606cd22336746321e05ae4d4d44a4bd5534e2d4e5`。
- Manifest aggregate：
  `351063009c3d50fe07c3fb70503bb4ff71e30b1ebef40beb3700c2e22a414b18`。
- retained JAV sample 的 MKV/NFO/poster SHA内容、size 与 mtime 在正式 HTTP
  journey 前后不变。

## Residual risk / 下一步

- 本检查点不声明 real JAV Provider、Production 或 Feature/UI acceptance。
- Material Field `contentProfile Hint` Owner-row/API continuity 仍未实施；本段
  未新增 Field/Run 列、API 或 caller/Composition 临时注入。该项保持为
  Western 纵切前的独立 Architecture closure。
- Architecture/P14 ACCEPTED 后才可进入 JAV Workspace/Provider/Product
  Facts/Production；在结论前保持冻结。
- `F02.17` 继续为 `NOT_RUN`。
