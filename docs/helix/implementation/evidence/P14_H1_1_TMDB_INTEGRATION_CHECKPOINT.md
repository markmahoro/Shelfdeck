# P14 H1.1 TMDB Integration Checkpoint

状态：`REPLACEMENT IMPLEMENTATION CHECKPOINT FROZEN / AWAITING ARCHITECTURE REVIEW`

## 范围

- 基线：H1.0 replacement
  `9d396bb4265a628f08a2dcf069dad020f119a3a4`，P14 evidence
  `181c57ac`。
- 仅实施 H1.1：Platform-owned secure Integration configuration 与 real
  TMDB adapter。
- 未进入 H1.2；Douban、JAV/Adult、MoviePilot、optional Emby 保持
  unsupported/unimplemented。
- 未修改 Architecture SSOT、Feature baseline、五个 frozen vertical
  sentinel、Domain core、formal DTO/contracts、Foundation、Worker、
  Desktop 或 legacy runtime。

## 施工闭合

四条既有 Admin route 已通过 Clean Composition Root 接通：

- `GET /v1/admin/settings/integrations/:kind`
- `PATCH /v1/admin/settings/integrations/:kind`
- `POST /v1/admin/settings/integrations/:kind/actions/test`
- `POST /v1/admin/settings/integrations/:kind/actions/disconnect`

Platform owner-local implementation复用既有 `platform_integrations` 与
`platform_secret_refs`，不新增 Table、Capability、Result family 或 Canonical
Transaction。配置与 Secret Reference 在同一 Platform UoW 中以 exact revision
CAS 原子提交。

`POST .../actions/test` 先执行真实连接测试，成功后只返回短 TTL opaque
`connectionProofId`、expiry 与非敏感摘要。credential被封装进仅由进程内 proof
索引可达的 authenticated encrypted transient envelope；`PATCH` 只接受并消费
`connectionProofId + expectedConfigRevision + idempotencyKey`，不再接收或重测
credential。unknown、expired、consumed、restart-invalid 或 wrong-scope proof
均 fail closed；proof 不会形成 active Integration/Secret Handle。

configure/disconnect 的 durable replay 使用既有 Foundation
`fx_command_receipts`、`fx_commit_markers`、`fx_audit_records` technical
persistence。冻结的 Platform head 同时保存非敏感 HMAC request digest 与
`lastCommand` recovery anchor。Platform commit 后、Foundation receipt 前的
response-loss 窗口由下一次命令首先 exact-read current head 并补齐同一 frozen
public Result；在补齐前不会覆盖 head。由此旧命令在后续 revision 与 restart 后
仍能稳定重放，same key/different payload 为 `409`，且不重复 network、Secret
写入或 Platform revision。

Secret envelope 使用 `SHELFDECK_SECRET_ROOT` 派生的 AES-256-GCM key，
并绑定 opaque locator identity、integration identity、Secret Reference、kind
与 revision 作为 AAD；locator同时携带 keyed envelope digest。
SQLite 只保存 opaque encrypted locator；GET、错误、日志与本 Evidence 不包含
secret 或 locator。临时 owned Buffer 使用后清零；wrong root、tamper 与 missing
envelope 均 fail closed。每次 Handle/Lease签发以及每次真实请求之前都会重验
persisted endpoint 为 exact TMDB HTTPS v3 root，并把 locator digest、Integration、
Secret Reference、kind 与 revision 对齐当前 config/Lease scope；合法但foreign、
prior/future-revision 或同scope swapped envelope均在Secret consumer/network之前
fail closed。disconnect 原子撤销 Secret Reference，随后隔离/删除不可达
envelope，restart 保持 disabled 状态。

连接测试执行真实 TMDB `/configuration` 与一个 typed Movie identity probe；
保存只消费对应proof，测试失败、proof失效或Platform CAS失败均不提交active Owner
rows。正式 runtime 只通过现有
`IntegrationQueryPort`、`IntegrationHandleResolverPort`、
`SecretLeaseResolverPort` 及 P5 Integration typed ports访问 TMDB。config/secret
revision、operation 与 artifact kind 均有 fence。未配置 TMDB 时 production
Composition fail closed；显式 deterministic test adapter 不构成 production
fallback。

持久 `config_json` 是 closed bounded implementation value：字段集合、schema、
revision、capability order、test summary、last command、endpoint、Secret
Reference与digest均 exact 验证，即使攻击者重算外层 config digest也不能接受
extra/missing/drift。TMDB JSON/artifact responses在调用 `response.json()` /
`arrayBuffer()` 前执行 `content-length` 与 streamed upper-bound双重限制；typed
identity/metadata/people fields继续遵守P5 closed/unique/string/item bounds。

## 真实网络证据

使用 ignored private operator input 通过正式 H1.1 public command 完成一次
TMDB credential test/save，并在 restart 后执行一个 typed identity search 与
一个 typed metadata read。未读取历史 runtime `config.json`，也未将 private
value 输出、记录或提交。

- endpoint：官方 TMDB API v3 HTTPS root；
- committed config revision：`1`；
- config digest：
  `7c4bd14624c910243ca2be7124b435fd1b5241bef765496176c481b301199f95`；
- identity namespace：`tmdb_movie`；
- resolved identity digest：
  `82a675d7f5e3aea14f029f21c44c5de49791750c17f24ed48aa0f352e5f6f87e`；
- metadata entries：`6`；provider identity entries：`1`；
  bounded people hints：`16`；
- secret disclosure：`0`。

第一次外网调用遇到瞬时网络失败并按 typed error fail closed；未产生半提交。
随后重试成功。该证据只接受 real TMDB 最小纵切，不覆盖 H1.2 Provider。

## 回归与机器基线

- H1.1 Admin/proof/secret/recovery/bounds/real-port negatives：`10/10 PASS`；
- H1.1 + package/guard + P5 focused regression：`50/50 PASS`；
- frozen vertical sentinels：`27/27 PASS`；
- full `npm run test:helix-architecture`：`135 fixture files PASS`；
- H1.1 cumulative change-scope guard：`PASS`，violations `0`；
- inventories：`112 Capability / 97 Result / 178 Table /
  43 Canonical Transaction / 114 Route / 18 UI Surface`；
- route state：`40 real / 6 Worker Beta-404 / 68 unavailable-503`；
- manifest aggregate：
  `345a974464886d213ca36ba21678bd7ad88ece5b2a081f34f4ddbc94accdc3d9`；
- contract aggregate：
  `c5a62e222ce4063f7ad05073f343e525d417f625cc937ee5f1284a2cf2090995`；
- unresolved refs：`0`；dependency/semantic findings：`0`；
  prohibited actions：`0`。

## 冻结与残余

本 replacement checkpoint 只证明 H1.1 construction，不提升任何 Feature 为 PASS。
TMDB real artifact positive未作为本阶段外网验收硬门；artifact operation仍有
typed handle/kind/fence与 deterministic negative coverage。H1.2、H1.3、
H1.4、H1.5均未开始。实现线程保持冻结，等待 Architecture 主动复审与 P14
独立验收。
