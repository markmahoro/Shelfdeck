# P14 H1.1 TMDB Integration Checkpoint

状态：`IMPLEMENTATION CHECKPOINT FROZEN / AWAITING ARCHITECTURE REVIEW`

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
CAS 原子提交。same idempotency key/same payload 稳定重放；same key/different
payload 与 stale revision fail closed。

Secret envelope 使用 `SHELFDECK_SECRET_ROOT` 派生的 AES-256-GCM key，
并绑定 integration identity、Secret Reference、kind 与 revision 作为 AAD。
SQLite 只保存 opaque encrypted locator；GET、错误、日志与本 Evidence 不包含
secret 或 locator。临时 owned Buffer 使用后清零；wrong root、tamper 与 missing
envelope 均 fail closed。disconnect 原子撤销 Secret Reference，随后隔离/删除
不可达 envelope，restart 保持 disabled 状态。

保存先执行真实 TMDB `/configuration` 与一个 typed Movie identity probe，测试
通过后才提交 Owner rows。正式 runtime 只通过现有
`IntegrationQueryPort`、`IntegrationHandleResolverPort`、
`SecretLeaseResolverPort` 及 P5 Integration typed ports访问 TMDB。config/secret
revision、operation 与 artifact kind 均有 fence。未配置 TMDB 时 production
Composition fail closed；显式 deterministic test adapter 不构成 production
fallback。

## 真实网络证据

使用 ignored private operator input 通过正式 H1.1 public command 完成一次
TMDB credential test/save，并在 restart 后执行一个 typed identity search 与
一个 typed metadata read。未读取历史 runtime `config.json`，也未将 private
value 输出、记录或提交。

- endpoint：官方 TMDB API v3 HTTPS root；
- committed config revision：`1`；
- config digest：
  `832946b280990646c8000efbedca842a9216eeda65e19cc4e34e1ee6840b393d`；
- identity namespace：`tmdb_movie`；
- resolved identity digest：
  `82a675d7f5e3aea14f029f21c44c5de49791750c17f24ed48aa0f352e5f6f87e`；
- metadata entries：`6`；provider identity entries：`1`；
  bounded people hints：`16`；
- secret disclosure：`0`。

第一次外网调用遇到瞬时网络失败并按 typed error fail closed；未产生半提交。
随后重试成功。该证据只接受 real TMDB 最小纵切，不覆盖 H1.2 Provider。

## 回归与机器基线

- H1.1 Admin/secret/real-port/route negatives：`6/6 PASS`；
- P5 secret/provider/public-port/integration：`25/25 PASS`；
- frozen vertical sentinels：`27/27 PASS`；
- package-boundary + H1 guard + H1.1 combined：`26/26 PASS`；
- full `npm run test:helix-architecture`：`135 fixture files PASS`；
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

本 checkpoint 只证明 H1.1 construction，不提升任何 Feature 为 PASS。
TMDB real artifact positive未作为本阶段外网验收硬门；artifact operation仍有
typed handle/kind/fence与 deterministic negative coverage。H1.2、H1.3、
H1.4、H1.5均未开始。实现线程保持冻结，等待 Architecture 主动复审与 P14
独立验收。
