# 媒体整理维护状态与回收站清晰度修正

2026-09-08；Local Implementation。基线 `1755743c1`，独立worktree/branch `codex/formation-care-clarity`。
用户本轮四项反馈授权实施；统筹任务要求仅交付本地commit与Evidence，由iteration统一整合发布。
唯一Master Plan、Current Phase、Current Status与SSOT由统筹任务维护，本提交不并行修改。

## 合同与范围

- Owner：Arca只读Query / Admin Web；依据SSOT §9.4.6与2026-09-08统一工作区修订。
- 输入：持久Case state/terminal reason/time/冻结goal、Case CareBasis指定的历史Inventory、当前Inventory及Arca正式健康Projection。
- 输出：工作分类/分页计数，列表当前健康与结果，详情历史目标与前后正片体积；不把历史失败当当前活动工作。
- Effect/transaction：GET-only；无DDL、新事务、业务事实修改或真实媒体副作用。停止条件为Owner/授权越界、倒推历史要求或伪造成功。
- 不触及Libra/Aftercare编码策略、BR-01/UAT-079、BR-02、Settlement执行及历史终态；保留基线中的详情加载反馈、倍速显示、大NFO记录刷新修正。

## 生产只读发现

现场镜像：`markmahoro/shelfdeck:helix-beta-20260908-6e37bf5679`。SSH统一经过`tools/nas-ssh-config.js`；数据库连接`readonly:true,fileMustExist:true`，仅SELECT。

Case汇总为44 resolved、11 unresolved、3 invalidated（queued_basis_changed，既有合同已排除），无queued/active。
11条unresolved分布于8部收藏：external_writer_conflict 1、reassessment_exhausted 1、repair_commit_exhausted 5、settlement_or_commit_failed 4。
旧care-work-store和care-query均把所有unresolved映射attention_required，未区分“工作终结记录”与“当前收藏问题”。
这些记录本身是真实历史，错误在工作区把它们当作当前需继续处理的任务，不应直接删除或改成功。

霍比特人1：意外之旅的精确记录：

- Entry `fb83bebf65cad90e9abb5452a5b6cd633d1cad1508a4d9640f9b24e406b8bc7d`。
- Case `arca-care-7a7e5123b1f7a834e5b44d613dbe22e0c8421232`；goal `conformance:max_size_exceeded`。
- 2026-09-07 18:52建单，09-08 04:41以`settlement_or_commit_failed`/unresolved终结。
- CareBasis inventoryRevision 1正片11,666,913,036 bytes（10.87 GiB）；当前revision 2为4,027,793,937 bytes（3.75 GiB）。
- 04:43三项最新assessment custody/presentation/conformance均healthy、inventoryRevision 2、standardRevision 1。
- 这是已发生媒体体积变化后的旧收尾失败记录；没有证据证明当前再次排队转码。原/当前体积来自Inventory记录，不冒充本次现场重新ffprobe。

其余七部不以“最近三行”冒充每维最新检查；当前健康使用Arca正式Projection，不从旧Case结果推断。

## 已实现

1. unresolved映射ended，保留原state和reason；invalidated+unresolved共用分类时计数累加，保持跨state分页稳定。queued及未准入失效继续排除。
2. UI只有全部/整理中/需要处理/已结束四筛选；已结束合并成功上架、成功维护、未解决、失效、用户放弃，具体结果保留在行内。API completed分类仍可供准确结果查询，不更改Libra状态机。
3. 本页每个有界Case page按去重Entry批量读取currentHealth；只有精确Case详情读取caseEvidence。当前不健康仍明确显示、展示Finding并提供收藏健康入口，不把移入历史当健康修复。
4. 详情分别显示建单原因、本次结束结果、开始/结束时间、历史/当前正片体积和当前健康；真实Plan/Event继续使用共享组件，历史目标不假扮当前待办。
5. 回收站历史、恢复和逐影片旧目录preview统一进入系统设置“回收站”tab；从Formation/Collection移除原面板。新的选择器按需分页读取收藏，原归档/恢复安全合同复用。
6. 实际浏览器发现维护行“查看过程”按钮窄列竖排，改用既有text样式并限定不换行。

## 持久可解释性缺口（交由统筹任务）

**新Case也未冻结具体体积上限。** `aftercare-process-coordinator.js`创建CareRequirement时typedParameters仅有finding代码，acceptanceDigest为effects摘要。
因此`max_size_exceeded`可说明当时判定的缺口类型，但Case本身不能给出当时maxSizeBytes/对应评分分支。
本提交明确显示缺少历史上限，不用当前Standard/评分反算；历史和当前体积也分别标识。
统筹任务已接手补齐新建Case可解释性持久合同；这属于判定依据保留，不是BR-02码率/编码策略改动。此缺口未由本提交关闭。

## 验证与限制

- SQL/Query定向：`node --test media-service/test/helix-architecture/p15-care-work-query.test.js`，2 PASS；覆盖分页/累计计数、终态分类、排队排除、历史/当前Inventory区分及只读不改Case。
- 完整架构Gate：`npm run test:helix-architecture`，214 Fixture文件通过，dependency/semantic/manifest/contracts全部ok，无finding。113 Capability/99 Result/187 tables/45 transactions/127 routes/17 UI surfaces不变。
- Web：49 PASS / 0 FAIL；包括统一终态筛选、失败历史当前健康、历史成功但当前不健康、具体体积/缺失上限说明、回收站设置及preview无自动归档/恢复。
- Web TypeScript/Vite构建PASS。
- Chromium隔离HTTP fixture交互：1440×900和1280×800下打开已结束、查看维护详情、系统设置回收站，0 pageerror；截图人工核对完成。1280沿用表格水平滚动，详情按钮不再竖排。该验证不声称真实生产浏览器验收。
- Service回归：默认并发首轮492 PASS / 18 SKIP / 1文件加载FAIL（缺依赖）；补齐后该文件9/9通过。默认并发第二轮仍FAIL（FFmpeg stall watchdog超时）。最终以`node --test --test-concurrency=1 --test-reporter=spec test/*.test.js`串行运行，501 PASS / 18 SKIP / 0 FAIL，519 tests，177.37秒。未把前两轮失败改记为通过。首轮缺新worktree的tools/node_modules/ssh2，补齐依赖后该文件9/9通过；第二轮高并发出现既有FFmpeg stall watchdog计时测试超时，未更改执行器或放宽测试。
- 未部署、未修改NAS数据/媒体、未运行real-source E2E或media-desktop；Windows本地query/web结果不替代Linux发布Gate与生产最终验收。


最终浏览器截图（本地隔离fixture，非生产）：

- `C:/Users/markm/AppData/Local/Temp/care-formation.png`：1280×800终态列表，最后一次QA。
- `C:/Users/markm/AppData/Local/Temp/care-detail.png`：历史原因/体积/本次结果/当前健康。
- `C:/Users/markm/AppData/Local/Temp/care-settings.png`：系统设置回收站。
- 临时QA脚本：`C:/Users/markm/AppData/Local/Temp/care-ui-qa.cjs`及`care-ui-qa-compact.cjs`。静态资源来自本次Web build，API由fixture拦截，未调用生产写接口。

Boundary/Exit审查：Query仅Arca Repository和coordinator，列表按页去重批量健康读取、详情只读精确Case历史；
无跨Owner SQL/import、无DDL/事务变化、无伪造健康或终态。SSOT及三份统筹文档无diff。
本包Local Implementation完成，持久目标可解释性缺口与Linux/生产集成验证移交统筹任务；本包不独立发布。
