# 当前 Phase：US Adult、演员库与每周维护窗口

日期：2026-10-18。状态：`LOCAL DEVELOPMENT / CONTRACT ALIGNMENT IN PROGRESS`。

## 1. 基线与授权

- 分支 `codex/us-adult` 从同步后的 `main@ac278f33e644f0fe52f93043bfa1ac0f2eb40b18` 建立；GitHub 默认分支已改为 main。
- 用户已确认五个议题并要求本地开发；[产品决定与开工取证](evidence/US_ADULT_DECISION_BASELINE_20261018.md)不是第二份架构。
- 沿用 Playbook §3.3：本任务先记录并回写已确认合同，再传播机器门禁、实现与测试；不为已确认决定重复申请授权。
- 本地代码、合同/单元/隔离 fixture 与构建在范围内；NAS 部署、停机、Reset、生产数据或真实媒体改动不在本次授权内。
- 前一开发包保留在 [历史交付快照](archive/JAV_AND_RUNTIME_DELIVERY_AC278F33E_20261018.md)。原未关闭 UAT、精确收藏保护与验收限制不变。
- 本次工作区忽略资料移存只用于保护本地文件，不新增 ShelfDeck 备份产品功能。

## 2. 顺序与当前工作

| 工作项 | 可验收结果 | 当前状态 |
| --- | --- | --- |
| `US-CONTRACT-BASELINE` | 五个议题映射至 Owner、命令、事实、Effect、恢复和验收；SSOT 与派生合同一致，负例与 Architecture Gate 通过 | 进行中：产品决定已冻结，已回写主要SSOT及机器合同；全局残余条款对齐及最终门禁待完成 |
| `US-PEOPLE` | 三库独立；普通/JAV 零用户介入；US Adult 有图手动/辅助建档、编辑、每轮最多五位推荐；认领来源影片无二次确认 | 开发中，尚未闭合 |
| `US-FORMATION` | 真实 service-local 抽帧/人脸匹配，唯一最高有效演员；未识别进入既有暂存车间，确认后原位继续，有演员才可上架 | 开发中，尚未闭合 |
| `US-PRESENTATION` | 初次生产和 Arca 刷新共用正式 Renderer；四张 2×2 大截图；演员名加冻结原名；无展示用自建番号 | 开发中，尚未闭合 |
| `US-ARCA-REFRESH` | 仅用户单片手动指定/自动刷新创建本类 Aftercare Case；演员、NFO、海报、相关命名一致更新，收藏身份不变 | 开发中，尚未闭合 |
| `SYSTEM-MAINTENANCE-WINDOW` | 每周配置、安全进入/退出、游标续跑和任务分类；概览只显示维护状态与当前任务 | 开发中，尚未闭合 |
| `US-QUALIFICATION` | 正式 Host 旅程、恢复反例、适用跨平台验证和具体版本 UI 审核有 Evidence | 待实现 |

本 Phase 滚动细化当前工作项；不另建活动计划，不分配开发用 UAT。缺失真实模型/适配器不能由旧 Face HTTP 服务、Mirex Store、mock Result 或空演员关系替代。

## 3. 验收门禁

- People：跨库同人可独立建档、唯一性/查询按库隔离；普通/JAV 无用户写操作/确认待办；不按同名强行归并。
- US Adult：姓名和有效单人参考图必需；无效图不发布可用演员；修改姓名/图片不广播改写已上架影片；无合并/停用/删除。
- 推荐：每轮最多五位且聚合人物；用户认领只作用于明确来源 A，Owner 命令幂等生效；跨域交互不伪装成共享 Store 或跨域原子事务。
- Formation：覆盖最高匹配、无匹配、无脸、空库、人工改选、暂存原位继续、单演员验收、重启和重复命令；沿用席位/公平与责任边界。
- Arca：本类 Case 仅由用户 Intent 创建；无结果保留原演员；命名冲突不覆盖；提交前后崩溃可恢复，Shelf Entry/Deck Fact/Canonical Identity 连续。
- 产物：预览可看清 2×2 截图，姓名/标题不遮图；原名冻结，刷新不重复追加演员前缀；不以文件名替代内部身份。
- 窗口：默认周六 03:00–09:00 Asia/Shanghai；跨重启、配置修订、手动停机、长转码错过进入、到点退出和单任务失败均有反例。
- 调度：周期健康检查只签发 Case，Case 与 Run 在正常模式执行；维护及安全收尾所需的 Foundation/消息能力不被全局 stop 误停。
- 数据：已入藏事实/引用保留；旧普通/JAV 确认项只经 Owner 有界再解析，不盲目接受、同名合并或硬删除。
- 执行适用 Service/Web/Architecture 检查，Windows/Linux 原生依赖按影响验证；未测项明示，fixture 不冒充真实模型或媒体验收。
- 本轮为跨层开发，UI 按 Playbook §12.3 接受具体版本审核，后续 UI diff 重验受影响路径。

## 4. 停线与完成

未确认新业务边界只暂停依赖工作，纯工程选择由实施方处理。不得跨 Owner 写入、引入旧 Runtime、隐藏来源失败或擅自清理生产。
全部工作项具备具体实现与适用验收证据后才能称本版开发完成；本文件当前记录本地开发进度。实际发布、数据升级与真实媒体效果需要相应精确授权。

## 5. 2026-10-18 本地开发进度（未交付）

三库身份/Provider唯一性与查询隔离、普通/JAV内部弱Evidence、US首图原子提交围栏已有代码与隔离验证。真实CPU模型包已锁定校验值/许可，实际单人、无脸、多脸及同图缩放匹配已验证；US上传建档已接入正式Work/Effect并通过实际CPU模型Host旅程；Formation尚未接入。2×2 Renderer与冻结原名组件已有局部测试，尚未接入实际产物。

维护状态机、配置API/设置页/概览、调度筛选及持久cursor已接线；正式Host配置重放、版本冲突和手动停机跨重启测试通过。周期健康检查与正常Case推进已拆分，并修复维护截止后终态回调续发的边界；自动豆瓣与手动同步衔接已获确认：同一Acquisition/原cursor继续，并以持久用户Intent转normal准入，隔离重启验证通过。

适用全量回归、数据副本升级、完整US Host链路、Windows/Linux及具体版本UI审核尚未完成。首轮Architecture整合主动终止，不能记PASS；未部署或操作生产。

最新具体进度及验证限制见[本地实施Evidence](evidence/US_ADULT_LOCAL_IMPLEMENTATION_20261018.md)。US上传建档/头像/重启重放/无脸拒绝已通过正式Host；当前合同217表/56事务/154路由；三库页、US上传/搜图建档、姓名/别名编辑和补充参考图已接正式链路，Web207项通过。推荐、Formation、Arca刷新和完整平台/UI资格继续开发。

US整理已开始接当前Libra Run的internal_source正式身份分支；原名随Identity Fact冻结并跨replacement保持，真实20点抽帧/CPU算法已有证据。People完整库分页及版本摘要已验证270人；正式Analysis Work、暂存确认与全链路仍开放。详见同一Evidence追加记录。

US Analysis Basis及完整Reference Page已持久冻结，正式CPU分析/分页Match Capability与Planner构造已接Service；跨页最高分及中断反例通过。尚未接完主Formation演员选择/暂存与Product链路，不计US Host旅程通过；Service全量及升级、平台、UI资格仍开放。

用户演员选择Intent/head及正式幂等命令已有Owner事务和28项组合局部验证；按Subject保存选择，REST/Formation UI与原Run继续尚未接完。此前Service647 pass/29 skip/0 fail是015fd5f60检查点，当前未做US影片完整链路或新数据升级验收。

完整分页匹配完成事实已持久冻结并验证后续不重新查库；Foundation正式Plan验证的依赖和资源声明已修正。当前为217表/56事务/133 Domain inputs；这仍是整理链路局部开发，不是完整US影片Host或发布资格。

明确Actor Selection及US单演员Media-Cast Owner提交已实现，人工Intent不伪造算法Evidence；当前134 Domain inputs。主US Metadata/Artifact接入、暂存原位继续及完整Host仍在开发，局部验证见同一Evidence。
