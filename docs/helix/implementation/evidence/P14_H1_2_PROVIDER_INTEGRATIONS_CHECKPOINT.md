# P14 H1.2 Provider Integrations Implementation Checkpoint

状态：**REPLACEMENT IMPLEMENTATION FROZEN — 等待 Architecture 主动复审；H1.3 未授权**

## 基线与范围

- immutable vertical baseline：`ddc3e51909ca4e9f5729c4326b05daee4792326f`
- H1.1 accepted source：`8bf8feb5873419ed49deece15cc856cee6046fa9`
- H1.2 replacement implementation closure：`b5cc89ae`（前序REST identifier
  continuity：`a9b1f993`）
- Architecture SSOT未修改；H1.3–H1.5与H2未开始。
- 变更只位于H1允许的Platform、Integration、Composition/Clean Host seam及
  独立H1.2测试和既有implementation治理文档。

## 冻结施工结果

H1.2复用H1.1接受的四条dynamic Integration Admin route和同一套Platform
owner-local配置、短期one-use connection proof、AES-256-GCM Secret envelope、
revision-fenced Integration Handle/Secret Lease及durable command replay：

- `douban`：官方HTTPS endpoint，Cookie/user identity只经加密Secret流程；
  Perception读取投影为closed bounded source refs。
- `adult-provider`：只实现当前官方ThePornDB Bearer REST最小子集：
  `GET /auth/user`、`GET /jav?q=<jav_code>&per_page=2`与
  `GET /jav/{identifier}`。GraphQL endpoint/query/fixture已从Clean Helix路径
  完全移除；只有逐字节匹配的`sku`才建立`jav/jav_code` Resolved Identity。
  唯一共享REST client先以`jav_code`搜索唯一SceneResource，再使用返回的
  bounded official `scene.id`读取`/jav/{identifier}`；exact response同时重验
  `id`与`sku`。`scene.id`必须是1..256 UTF-8 bytes的真实string，禁止把object、
  number、null或其他非官方shape经`String()`转成identifier；search row非法时不
  发起第二次transport，exact response非法时同样fail closed。performer identifier
  也不接受object coercion。generic metadata与JAV Product metadata/artifact不再
  各自解释协议。
  SceneResource仅投影当前Product所需metadata、people hints及poster/fanart；
  未授权的performer detail与其他resource明确typed fail closed。
- `moviepilot`：显式HTTPS或private/loopback HTTP endpoint；availability、
  candidate search和external acquire request/receipt使用既有P5 typed ports。
- optional `emby`：username/password只用于一次认证，保存的是Server签发token；
  password不进入proof后的Secret、SQLite、HTTP response、日志或Evidence。

未知、unsupported或未配置kind fail closed。Production Composition不存在
跨Provider fallback、deterministic fixture fallback、ambient credential读取、
历史runtime config导入或legacy adapter。

## Security与恢复连续性

- persisted endpoint、closed config、Secret locator/envelope的integration、
  kind、revision与digest在Secret消费和网络请求前逐项复验；
- cross-provider合法envelope swap、endpoint drift及revision drift在Secret/
  network前拒绝；
- Provider response执行Content-Length与streamed byte cap，随后进行closed、
  bounded、unique projection；JSON/Emby token response原始Buffer及Emby
  adapter返回的原始`persistedSecretBytes`均在`finally`中清零；
- JAV Product Handle以唯一builder/validator重算完整`handleId`与
  `fenceDigest`，foreign type/secret/revision/operation/artifact kind在transport
  前拒绝；
- Douban Observation的request source与返回页面都必须精确属于已配置userId；
- ThePornDB artifact只允许`cdn.theporndb.net`或`thumb.theporndb.net`，
  HTTPS default port、无userinfo，redirect禁用；IPv4/IPv6/private/mapped及
  redirect反例均不会访问foreign transport；
- test proof一次使用；configure/disconnect历史command receipt在head推进及
  restart后仍稳定重放，不倒退active state；
- Emby登录明文使用后清零；proof/transient envelope与active Secret生命周期
  沿用H1.1已接受的response-loss恢复合同。

## 实际网络与construction evidence边界

ignored private operator input仅作为一次formal public command输入，未输出、
提交或写入Evidence。当前环境已完成真实MoviePilot
`test → proof → save → typed availability`，只记录：

`publicTest=PASS / save=PASS / typedAvailability=PASS / responseBytes=187`

Douban、ThePornDB和optional Emby当前没有可用private credential，因此其
网络transport使用deterministic test implementation验证正式Port与投影；这不是
real Provider acceptance。ThePornDB official protocol形状依据当前公开OpenAPI
进行有界construction验证，尚未形成真实外网credential acceptance。MoviePilot
search/request的实现与typed contract已由隔离测试覆盖；未向真实MoviePilot提交
具有下载副作用的construction请求，外部协议的exactly-once也未被宣称。

## Material-cost decision

MoviePilot `ready/material stability`要求正式transfer root authority、路径
containment、member stat/SHA-256及稳定窗口。将其提前到H1.2会引入H1.3的
root/probe权限、Windows/Linux路径与长期版本维护。已向Architecture提交bounded
cost packet，用户已批准最低成本合规方案：

- H1.2冻结secure config/test、availability/search/request/receipt；
- ready/stability在缺少正式root/probe时继续fail closed；
- H1.3只实现一次正式root/path/probe continuity，不使用历史`savePath`、裸路径
  或隐藏current-config旁路。

该残余保持相关Feature未验收，不构成fallback或虚假成功。
这是intentional phase sequencing，不是未决Architecture defect。

## 机器与回归证据

- focused H1.1/H1.2/P5 replacement：
  `33 tests / 33 PASS`
- immutable vertical sentinels：
  `41 tests / 41 PASS`
- H1.2 cumulative scope guard：
  `PASS / violations=[]`
- route state：
  `114 total / 40 real / 6 Worker Beta-404 / 68 unavailable-503`
- full `npm run test:helix-architecture`：
  `136 fixture files / PASS`
- dependency：
  `47 packages / 194 files / 471 dependencies / findings=0`
- semantic：
  `1734 files / findings=0`
- inventories：
  `112 Capability / 97 Result / 178 Table / 43 Canonical Transaction`
- unresolved type refs：
  `0`
- prohibited actions：
  `0`

Frozen digests：

- manifest aggregate：
  `345a974464886d213ca36ba21678bd7ad88ece5b2a081f34f4ddbc94accdc3d9`
- contract aggregate：
  `c5a62e222ce4063f7ad05073f343e525d417f625cc937ee5f1284a2cf2090995`
- Architecture SSOT component：
  `59a36f2312f45110dc159ffab8dabe2f34611ec991001191a8721663ffd7414a`
- table contract：
  `c2b1dd21b92b30b9ab5aa4a09e378e2cc3136f40cf75e1f7dbbd07dc05a636ba`
- transaction contract：
  `4d37eb40a1851fae068780e184ce4bc152be5428d662447576d0f166ea9a82ab`

## 冻结边界

- Feature Matrix未提升任何Feature为PASS。
- Worker/Desktop/Ollama/Python/NAS/Docker/production均未触碰。
- H1.3未授权；本replacement checkpoint后实现线程停止，先等待Architecture
  主动复审。只有Architecture接受后才能交P14，双门前不得继续。
