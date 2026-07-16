# ShelfDeck Clean Helix Current Phase Execution Packet

Current phase: `P1 — Clean Skeleton and Architecture Guards`

Status: in progress; P1-00 complete; Local Implementation Gate open for P1 only.

Last updated: 2026-07-16

## 1. Authority and relationship

本文件是唯一活动Phase详细执行包，从属于：

1. `../TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`；
2. `../CURRENT_PLAN.md`；
3. `../ENGINEERING_PLAYBOOK.md`。

它只把Master Plan中的P1拆成可执行Work Package，不新增架构合同。任何字段与SSOT冲突时，以SSOT为准并停止
对应Work Package。

## 2. Current authorization state

用户已经打开`Local implementation only` Gate。当前允许：

- 在隔离worktree实现P1-01至P1-08；
- 运行P1 unit/contract/isolated architecture fixture；
- 同步本文、Playbook、Status、Plan和Evidence。

当前禁止：

- 实现P2及以后合同、Schema、Runtime、Domain、API或UI；
- 运行E2E、Admin Web构建或Docker构建；
- 构建Docker、部署或接触生产；
- 修改`media-desktop`；
- 移动、替换或删除任何真实媒体。

本授权只覆盖P1，不自动覆盖P2或任何外部环境动作。

## 3. Phase objective

建立一个**不可被旧Runtime污染、可由机器验证边界、但尚未接入产品启动链**的clean Helix物理骨架，为P2
Contract/Schema实施提供安全容器。

P1完成时应成立：

- `media-service/src/helix/`固定目录和package边界存在；
- 五Domain只有唯一public入口，internal目录不能跨包导入；
- `composition/createHelixApplication.js`是唯一被允许的全局装配位置；
- clean root不能导入旧Libra/Nexora/Kairox/Task Runtime；
- package/import/forbidden-semantic/reuse/contract-inventory guard可本地重复运行；
- clean skeleton没有被`server.js`、`app.js`或旧Composition Root接线；
- P2可以在不改变P1边界的前提下填写112/96/156合同。

## 4. Non-goals

P1明确不实现：

- 112个Capability或96个Result family的业务合同正文；
- 156张表DDL、`SqliteKernel`、Repository、UoW或数据库连接；
- Material Control、Outbox/Inbox、Work/Plan/Event/Effect或Resource Runtime；
- Procurement、Libra、Arca、Perception、People业务模型或Facade行为；
- Integration Adapter、FFmpeg/Worker或旧函数提取；
- Admin API、Session/Auth、Projection、Admin Web页面；
- clean initialization、backup、restore或Runtime cutover；
- 旧Runtime删除、兼容层、dual-run、dual-read、dual-write或fallback。

P1创建的模块不得返回伪业务数据、伪Ready状态或占位成功结果。

## 5. Baseline and protected worktree

P0代码审计baseline固定为`4a16f0a94ef23fcf732843e9547bd7b724d9c19d`。P1 implementation baseline必须在
Gate打开时另行记录；默认应是“包含本工程文档包、且`media-service`代码仍与`4a16f0a9`一致”的批准commit，
不能直接从缺少这些治理文档的旧commit悄然开工。

实施开始前必须重新记录：

- 当前HEAD和目标baseline；
- 原工作区dirty files；
- 用户`media-desktop`修改；
- 用户`media-service/package.json`和未跟踪分析脚本修改；
- 独立worktree绝对路径和branch；
- P1允许修改的文件范围。

P1不得在当前dirty工作区直接实施。

### P1-00 baseline receipt

| Field | Recorded value |
| --- | --- |
| P0 code audit baseline | `4a16f0a94ef23fcf732843e9547bd7b724d9c19d` |
| Approved integration baseline | `c1c6bb0dc468c11bf34e7bd63b038fc1b197a689` |
| Integration branch | `codex/helix-clean` |
| Phase branch | `codex/helix-p1` |
| Phase worktree | `E:\my_project\emby_third_party-helix-p1` |
| Original worktree | `E:\my_project\emby_third_party` on `master` |
| Protected original changes | six `media-desktop` files、`media-service/package.json`、untracked `media-service/scripts/analyze-movie-size-policy.js` |
| Receipt result | original worktree restored to `master`; protected changes preserved; phase worktree clean |

## 6. Target package skeleton

P1建立SSOT §8.1.2固定的物理结构：

~~~text
media-service/src/helix/
├─ composition/
├─ domains/
│  ├─ procurement/
│  ├─ libra/
│  ├─ arca/
│  ├─ perception/
│  └─ people/
├─ foundation/
│  ├─ execution/
│  ├─ capability/
│  ├─ control/
│  ├─ persistence/
│  ├─ effects/
│  └─ diagnostics/
├─ integrations/
├─ projections/
└─ contracts/
   └─ manifests/
~~~

每个Domain固定包含：

~~~text
<domain>/
├─ public/
│  └─ index.js
├─ model/
├─ application/
├─ planning/
├─ capabilities/
└─ persistence/
~~~

Git不跟踪空目录，因此P1只能添加表达package身份、public边界或manifest的最小文件；禁止添加伪业务实现、通用
Repository或未来Phase的占位Runtime。

## 7. Work Package index

| ID | Title | Status | Dependencies |
| --- | --- | --- | --- |
| P1-00 | Isolated implementation workspace and baseline receipt | complete | P0 audit closed |
| P1-01 | Clean physical package skeleton | next | P1-00 |
| P1-02 | Domain public/internal boundary contract | pending | P1-01 |
| P1-03 | Unique Composition Root shell | pending | P1-02 |
| P1-04 | Import and dependency architecture guard | pending | P1-01、P1-02 |
| P1-05 | Forbidden legacy semantics guard | pending | P1-01 |
| P1-06 | Machine-readable manifest and reuse-ledger framework | pending | P1-01、P1-02 |
| P1-07 | Isolated architecture verification harness | pending | P1-03–P1-06 |
| P1-08 | P1 Phase Exit Audit and evidence freeze | pending | P1-00–P1-07 |

## 8. Detailed Work Packages

### P1-00 Isolated implementation workspace and baseline receipt

| Field | Contract |
| --- | --- |
| SSOT / governance | Level 8 §8.8.1；Playbook §3–§4 |
| Gap | G-01、G-02；工作区保护风险 |
| Owner | Engineering governance |
| Outcome | 独立clean实施branch/worktree和可复验baseline receipt |
| In scope | Git状态只读检查、独立worktree/branch、允许修改范围、baseline记录 |
| Out of scope | 任何clean代码、测试运行、旧文件清理 |
| Required evidence | baseline commit、原工作区status、worktree路径、branch、无用户修改复制/丢失证明 |
| Stop triggers | baseline不一致；目标路径含用户修改；需要reset/checkout覆盖用户内容 |
| Done | 独立worktree干净且从批准baseline创建；Current Status记录实施位置和Gate范围 |

### P1-01 Clean physical package skeleton

| Field | Contract |
| --- | --- |
| SSOT | Level 8 §8.1.1–§8.1.2、§8.8.1 |
| Gap | G-01、G-03 |
| Owner | Composition/package structure |
| Outcome | 固定clean root、五Domain、Foundation、Integration、Projection和Contract目录可被Git追踪 |
| In scope | 最小package identity/public entry文件和目录 |
| Out of scope | Facade行为、Store、Runtime、Integration实现、业务DTO |
| Verification | 目录manifest精确匹配SSOT；clean root无旧模块import；import任意入口无startup side effect |
| Stop triggers | 需要使用旧Service作为placeholder；需要创建通用Domain/Store；目录名称偏离SSOT |
| Done | 物理树与package identity manifest一致，无伪业务实现 |

### P1-02 Domain public/internal boundary contract

| Field | Contract |
| --- | --- |
| SSOT | Level 8 §8.1.2、§8.7.1–§8.7.3 |
| Gap | G-02、G-03、G-16 |
| Owner | Each Domain public package |
| Outcome | 每个Domain只有`public/index.js`可被外部导入，internal目录不可跨包访问 |
| In scope | package boundary descriptor、public export discipline、allowed dependency matrix |
| Out of scope | 真实Facade方法、Query/Handoff实现、Domain Object |
| Verification | 正例public import通过；跨Domain internal/Repository/Capability负例失败；DTO不泄露internal object |
| Stop triggers | public入口重新导出Repository/Executor；通过路径别名绕过边界；Domain共享model目录 |
| Done | 五Domain边界由manifest和负例fixture共同证明 |

### P1-03 Unique Composition Root shell

| Field | Contract |
| --- | --- |
| SSOT | Level 8 §8.1.3、§8.1.4 |
| Gap | G-02、G-20 |
| Owner | Composition |
| Outcome | `composition/createHelixApplication.js`成为唯一允许的全局装配模块位置 |
| In scope | side-effect-free factory shell、dependency injection shape、lifecycle contract placeholder的显式未实现状态 |
| Out of scope | 构造Store/Runtime、注册Capability、启动Timer、连接`server.js/app.js` |
| Verification | import无Timer/DB/file/network；Root之外多Domain import负例失败；没有singleton或Signal subscription |
| Stop triggers | 为了“先跑起来”接旧Root；创建第二Registry/Runtime；返回伪Ready应用 |
| Done | Root位置和唯一性可被guard证明，且旧产品启动链完全未引用它 |

### P1-04 Import and dependency architecture guard

| Field | Contract |
| --- | --- |
| SSOT | Level 8 §8.7、§8.8.1 |
| Gap | G-02、G-03、G-05、G-16–G-20 |
| Owner | Engineering architecture guard |
| Outcome | 可重复运行的静态dependency checker，拒绝越域import和clean→legacy依赖 |
| In scope | CommonJS/relative path解析、package classification、allowed-edge manifest、bounded fixture exemptions |
| Out of scope | 扫描旧Runtime并要求其满足clean边界；自动改写import |
| Verification | 每类allowed/forbidden edge至少一个fixture；unknown package/escape path fail closed；结果非零退出 |
| Stop triggers | wildcard allowlist；以目录名包含测试为由全部豁免；无法解析时默认通过 |
| Done | Playbook §9.1全部规则具有自动正反例，clean root当前零违规 |

### P1-05 Forbidden legacy semantics guard

| Field | Contract |
| --- | --- |
| SSOT | Level 8 §8.0.5、§8.8.1、§8.8.3 |
| Gap | G-04、G-09、G-17–G-20、G-27 |
| Owner | Engineering semantic guard |
| Outcome | 旧业务语义不能以重命名、注释或兼容字段进入clean implementation |
| In scope | Membership、Admission、targetGate、maintenanceComplete、flowKind、global SourceBinding、独立Kairox Runtime等规则 |
| Out of scope | 禁止Evidence locator、负例fixture或合法自然语言；扫描整个历史目录 |
| Verification | 结构化豁免只允许具体文件/字段/用途；正反例；unknown exemption fail closed |
| Stop triggers | 使用大范围regex ignore；通过改拼写隐藏旧语义；旧类型作为temporary DTO |
| Done | Playbook §9.3规则自动化，clean implementation零未解释命中 |

### P1-06 Machine-readable manifest and reuse-ledger framework

| Field | Contract |
| --- | --- |
| SSOT | Level 8 §8.6、§8.8.3、§8.9；Level 10 §10.10 |
| Gap | G-06、G-18、G-23、G-28 |
| Owner | Contracts/engineering evidence |
| Outcome | versioned、可校验、可计算digest的manifest框架 |
| In scope | package boundary、legacy reuse、Capability/Result/table/route/transaction inventory schema和target counts |
| Out of scope | 实现112/96/156/113正文；宣称后续合同已完成 |
| Required fields | stable ID、SSOT ref、Owner、status、source/target locator、digest/version；reuse项补typed I/O/Effect/Fence/Resource/Test |
| Verification | schema invalid/duplicate ID/unresolved owner/非法status负例失败；相同输入digest稳定 |
| Stop triggers | 用自由文本代替stable ID；manifest与代码手工双维护且无校验；未登记旧函数可进入clean root |
| Done | P2及后续可增量填写inventory；P0历史62 registration/named helper有稳定待审locator，不被标记为已复用 |

### P1-07 Isolated architecture verification harness

| Field | Contract |
| --- | --- |
| SSOT | Level 8 §8.7.4、§8.9；Level 10 §10.10.1 |
| Gap | G-28 |
| Owner | Test/engineering evidence |
| Outcome | 单一明确命令可只验证P1 skeleton/guards，不启动旧服务或访问Runtime数据 |
| In scope | architecture test入口、fixture、稳定输出、non-zero failure、Windows路径行为 |
| Out of scope | 旧Runtime回归、E2E、Admin build、Docker、真实DB或媒体root |
| Verification | 正常树通过；逐类注入违规均失败；测试不创建`media-service/data`或启动Timer/port |
| Stop triggers | 为通过测试修改旧Runtime；依赖本机用户路径；读取私密测试凭据；测试有副作用 |
| Done | P1全部guard在Windows本地隔离运行并产生可保存Evidence；未运行平台列明风险 |

### P1-08 P1 Phase Exit Audit and evidence freeze

| Field | Contract |
| --- | --- |
| SSOT | Level 8 §8.1、§8.7、§8.8、§8.9；Playbook §12、§17 |
| Gap | G-01–G-03、G-17–G-20、G-28 |
| Owner | Independent phase review |
| Outcome | 证明P1只建立安全骨架，没有提前实现或连接旧主路径 |
| In scope | 全量P1 guard、diff审查、Root不可达证明、manifest digest、Known risk、phase closure record |
| Out of scope | P2合同/Schema实现或P13 cutover |
| Verification | 独立反向审计；clean→legacy import=0；架构guard violation=0；未登记复用=0；旧server引用clean root=0 |
| Stop triggers | 任一blocking finding；P1外能力混入；Evidence不可从commit复验 |
| Done | Exit Audit为PASS；Evidence冻结；Current Status更新；本文归档后才允许细化P2 |

## 9. Execution order and permitted parallelism

~~~text
P1-00
  → P1-01
       ├─→ P1-05 ──────────────────┐
       └─→ P1-02                    │
              ├─→ P1-03 ───────────┤
              ├─→ P1-04 ───────────┤→ P1-07 → P1-08
              └─→ P1-06 ───────────┘
~~~

P1-05可以在P1-01后先行；P1-03、P1-04和P1-06必须等待P1-02冻结package classification后再由独立worktree
并行。并行包不得修改相同manifest schema；若出现规则冲突，优先串行收敛，不以临时豁免解决。

## 10. P1 Phase Exit Gate

P1只有同时满足以下条件才能关闭：

- 固定clean物理树完整，五Domain public/internal边界明确；
- 唯一Composition Root shell无startup side effect且未接旧产品；
- import guard、semantic guard和manifest validator均有正反例；
- clean root→旧Runtime import为0；
- cross-Domain internal/Repository import为0；
- 未登记legacy reuse为0；whole-executor reuse为0；
- 没有数据库连接、DDL、Runtime timer、network、file effect或Admin route；
- architecture verification不读取Runtime数据、Credential或媒体root；
- P1 diff不包含`media-desktop`、用户分析脚本、生成物或无关旧代码修改；
- 独立Phase Exit Audit通过并保存baseline/result digest/commit/known risk。

P1关闭只允许进入P2 Contract and Schema Baseline，不自动授权E2E、Docker、生产或任何真实媒体副作用。

## 11. Current blockers and next action

当前没有P1 entry blocker。下一步执行P1-01；任何需要P2能力、E2E、Docker、生产、真实媒体副作用或
`media-desktop`修改的情况都必须停线并请求新授权。
