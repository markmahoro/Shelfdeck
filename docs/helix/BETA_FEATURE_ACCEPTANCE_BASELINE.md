# ShelfDeck Helix Beta 功能验收基线

Status: `FROZEN`；Product Owner于2026-07-23确认；尚未下发P14  
Owner: Architecture / Product Director  
Executor: P14独立测试验收任务  
Product defect fixer: 既有P2–P13实现任务；仅凭有界Defect Packet恢复  
Architecture authority: `1619735c`治理基线下的`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`  
Implementation under test: P13冻结E2E-ready package `3684118d`

## 1. 目的与权威性

本文档是Helix架构SSOT面向用户产品结果的验收投影，不建立第二份架构权威，也不能改变Domain、Owner、
Handoff、Policy或Authorization语义。

本Feature Matrix由Architecture / Product拥有，P14测试任务只负责执行并记录Evidence。测试任务不得合并、
删除、降级、重新解释或静默推迟Feature。实现无法满足某项Feature时，该项必须携带证据保持为`BLOCKED`、
`CONDITIONAL`或`NOT_RUN`，不能从Beta范围中消失。

只有Architecture / Product独立复核完成矩阵并给出Release Candidate结论后，Beta才允许交付。

### 1.1 协作职责

| 角色 | 责任 | 明确不做 |
| --- | --- | --- |
| 用户 / Product Owner | 决定Beta业务范围、用户可见结果、不可逆授权语义与最终是否发布 | 不负责拆测试Case或判断实现细节 |
| 当前Architecture / Product任务 | 持有Feature Matrix、设定Evidence门槛、审查测试结果、分类Defect、守住SSOT边界并给出Release Candidate建议 | 不直接替P14执行测试，也不在本任务编写产品实现 |
| P14独立测试验收任务 | 按冻结矩阵设计/执行Case、建立样本、记录原始Evidence与Residual Risk | 不改Feature定义、SSOT或产品代码；不自行降低验收标准 |
| 既有P2–P13实现任务 | 只接收Architecture / Product确认的有界产品Defect Packet，修复实现并提交可复测Commit | 不自行改变Feature、Owner、Handoff或Beta范围 |
| 后续部署任务 | 仅在Beta验收通过且用户明确授权后执行Canary/生产部署 | 不参与P14，也不提前触碰生产NAS |

缺陷闭环固定为：

~~~text
P14发现Evidence
  → Architecture / Product判断：测试问题、产品实现缺陷或真正架构矛盾
  → 测试问题退回P14；产品缺陷交既有实现任务；架构矛盾留在当前任务
  → 修复Commit经Architecture / Product边界复核
  → P14只对受影响Feature及回归范围复测
  → Architecture / Product独立完成Beta验收
~~~

P14与实现任务不得绕过Architecture / Product直接协商产品语义或验收降级。

## 2. 状态词汇与交付门禁

| Status | 含义 |
| --- | --- |
| `NOT_RUN` | 尚未执行要求的验证 |
| `PASS` | 已在要求的环境中证明用户可见结果和安全边界 |
| `CONDITIONAL` | 只在明确写出的Provider、硬件或平台条件下成立 |
| `BLOCKED` | 当前实现无法交付已确认的用户结果 |
| `NOT_APPLICABLE` | 基于已确认且有记录的原因不适用于本环境；不等于跳过 |

交付门禁：

1. 每项Beta Feature都必须有状态和Evidence。
2. API `200`、页面渲染、单元测试或纯Mock证据不能单独证明用户旅程通过。
3. `BLOCKED`阻止Beta交付，除非用户明确把对应Feature移出Beta。
4. 无解释的`NOT_RUN`阻止Beta交付。
5. `CONDITIONAL`必须说明缺少的Provider、Credential、硬件或平台及用户影响；本次Beta验收目标为全部
   Feature和排除项最终`PASS`，`CONDITIONAL`只能作为测试过程中的临时状态，不能作为最终交付状态。
6. 破坏性测试只能在P14 disposable root中执行。
7. Beta排除项同样必须提供负向/未暴露Evidence。

## 3. 验证与Evidence代码

### 3.1 验证方法

| Code | 必须采用的方法 |
| --- | --- |
| `UI` | 通过Admin Web执行，并验证用户可见交互和结果 |
| `API` | 通过公开Application/Query Facade HTTP路由执行；禁止Store捷径 |
| `E2E` | 通过公开产品入口完成对应业务旅程 |
| `MEDIA-S` | 使用disposable样本库中已校验的`functional_slice` |
| `MEDIA-F` | 使用保留的`full_length`副本；适用于绝对大小、质量、吞吐或长时间行为 |
| `PROVIDER` | 使用真实已配置Provider协议；Mock不足以通过 |
| `FS` | 核验物理文件系统前后状态、containment与Hash |
| `PROBE` | 使用真实FFprobe/FFmpeg输出验证媒体事实 |
| `RECOVERY` | 注入崩溃/重启/重放并证明收敛和幂等 |
| `NEG` | 执行负例、安全边界和反例验证 |
| `VISUAL` | 人工/浏览器审查文案、层级、警告和交互 |
| `AUDIT` | 以静态/运行时审计证明禁止的表面或路径不存在 |

### 3.2 必须提供的Evidence

| Code | Evidence要求 |
| --- | --- |
| `EV-UI` | 截图/录屏、路由、测试Commit和可见终态 |
| `EV-API` | 脱敏请求/响应、revision/幂等结果及适用的稳定错误 |
| `EV-ACT` | Activity Ledger阶段、动作、进度、等待和结果历史 |
| `EV-FACT` | 面向Owner的公开Projection/Receipt，证明Canonical业务结果 |
| `EV-FS` | Disposable root目录树、前后Hash、大小和路径 |
| `EV-MEDIA` | FFprobe/FFmpeg事实、流/容器/编码/时长和输出Digest |
| `EV-PROVIDER` | 脱敏真实Provider请求/结果及Capability/revision fence |
| `EV-REC` | 崩溃点、重启输入、重放次数和收敛结果 |
| `EV-NEG` | 被拒绝的动作/输入，以及未发生禁止副作用或状态变化的证明 |
| `EV-PERF` | Full-length吞吐、耗时、资源和存储观察 |
| `EV-AUDIT` | 依赖/表面/源码/运行时审计，证明禁止路径不存在 |

## 4. Feature Acceptance Matrix

### 4.0 Feature组与SSOT追溯

| Feature组 | 主要Accepted SSOT来源 |
| --- | --- |
| F01 | §9.1.1, §9.4.11, §9.6.5 |
| F02 | §3.2, §5.3, §9.4.3, §9.6.2 |
| F03 | §3.4, §5.2, §9.4.4, §9.5.6 |
| F04 | §5.4, §5.6, §9.5.2 |
| F05 | §6.3–§6.6, §9.1.2, §9.4.6, §9.5.3 |
| F06 | §9.0.2, §9.3.5, §9.4.6 |
| F07 | §5.5.3–§5.5.7, §6.4.7.1 |
| F08 | §5.5.3–§5.5.8, §6.4.7.1 |
| F09 | §5.5.3–§5.5.8, §6.4.7.1 |
| F10 | §5.5.3–§5.5.8, §6.4.7.1 |
| F11 | §5.5.6–§5.5.8, §6.4.7, §7.4, §8.6 |
| F12 | §5.5.6–§5.5.8, §9.6.3 |
| F13 | §3.4, §9.1.3, §9.4.5 |
| F14 | §5.9.1–§5.9.3, §6.8, §9.1.6 |
| F15 | §5.7, §6.6, §9.1.4–§9.1.5, §9.4.7 |
| F16 | §5.8, §6.6, §9.1.7, §9.4.8, §9.5.5, §9.6.4 |
| F17 | §5.9.4–§5.9.5, §6.8.3, §9.4.9 |
| F18 | §8.2, §8.4, §9.6.7 |
| F19 | §7.2–§7.4, §9.6.6, §9.6.8 |
| F20 | §6.1–§6.8, §9.6.5 |
| F21 | §9.1.9, §9.4.2, §9.6.9, Level 10 |

### F01 — 首次配置

| Feature | 已确认用户结果 | 必须验证 | Evidence | Status |
| --- | --- | --- | --- | --- |
| F01.01 | 用户可以通过浏览器Admin Web操作Beta | `UI,API,VISUAL` | `EV-UI,EV-API` | `NOT_RUN` |
| F01.02 | 唯一Admin Owner可以认证，未认证访问受保护资源会被拒绝 | `UI,API,NEG` | `EV-UI,EV-API,EV-NEG` | `NOT_RUN` |
| F01.03 | “建立收藏”向导按顺序呈现完整首次配置旅程 | `UI,VISUAL` | `EV-UI` | `NOT_RUN` |
| F01.04 | 向导创建一座Shelf并设置唯一、已验证的Physical Target Folder | `UI,API,E2E,FS` | `EV-UI,EV-API,EV-FACT,EV-FS` | `NOT_RUN` |
| F01.05 | 向导新增或选择一片或多片Material Field | `UI,API,E2E,FS` | `EV-UI,EV-API,EV-FACT,EV-FS` | `NOT_RUN` |
| F01.06 | 用户可以选择不可改写的系统推荐Rule Template | `UI,API` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F01.07 | 用户可以选择“全自动”或“关键步骤确认”，并看见准确后果 | `UI,API,VISUAL` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F01.08 | Setup准确报告Field、Shelf、Routing、Workspace、Provider和计算Readiness，但不宣称已经形成收藏 | `UI,API,NEG,VISUAL` | `EV-UI,EV-API,EV-NEG` | `NOT_RUN` |
| F01.09 | 关闭并重新打开浏览器后可以继续已保存的Setup | `UI,API,RECOVERY` | `EV-UI,EV-API,EV-REC` | `NOT_RUN` |
| F01.10 | Service重启后保留所有已完成配置事实和Readiness | `API,RECOVERY` | `EV-API,EV-FACT,EV-REC` | `NOT_RUN` |

### F02 — 文件来源管理

| Feature | 已确认用户结果 | 必须验证 | Evidence | Status |
| --- | --- | --- | --- | --- |
| F02.01 | 用户可以把本地或已挂载物理目录添加为Material Field | `UI,API,FS` | `EV-UI,EV-API,EV-FS,EV-FACT` | `NOT_RUN` |
| F02.02 | 用户可以修改Field显示名称并发布新的Physical Access Binding | `UI,API,FS` | `EV-UI,EV-API,EV-FS,EV-FACT` | `NOT_RUN` |
| F02.03 | 保存时验证可达、可读和路径containment | `API,FS,NEG` | `EV-API,EV-FS,EV-NEG` | `NOT_RUN` |
| F02.04 | 用户可以设置`movie|series|jav|western_adult|mixed` content hint | `UI,API` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F02.05 | 用户可以配置包含目录边界 | `UI,API,E2E,FS` | `EV-UI,EV-API,EV-FS` | `NOT_RUN` |
| F02.06 | 用户可以配置排除目录边界 | `UI,API,E2E,FS,NEG` | `EV-UI,EV-API,EV-FS,EV-NEG` | `NOT_RUN` |
| F02.07 | 用户可以配置允许的媒体扩展名 | `UI,API,E2E,FS` | `EV-UI,EV-API,EV-FS` | `NOT_RUN` |
| F02.08 | 用户可以配置最小Material大小 | `UI,API,E2E,FS` | `EV-UI,EV-API,EV-FS` | `NOT_RUN` |
| F02.09 | 用户可以排除指定Physical Material而不删除文件 | `UI,API,E2E,FS,NEG` | `EV-UI,EV-API,EV-FS,EV-NEG` | `NOT_RUN` |
| F02.10 | “立即观察”建立durable bounded observation并报告Activity | `UI,API,E2E` | `EV-UI,EV-API,EV-ACT,EV-FACT` | `NOT_RUN` |
| F02.11 | Field页面从Projection显示已发现、可处理、处理中和被排除数量 | `UI,API` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F02.12 | Field观察到替换/新Physical Identity时登记为新材料，旧受控Identity安全进入不健康/冻结；同Identity外部移动仅在取得可靠新location Evidence时更新，不承诺无界搜索 | `E2E,MEDIA-S,FS,RECOVERY,NEG` | `EV-FS,EV-ACT,EV-FACT,EV-REC,EV-NEG` | `NOT_RUN` |
| F02.13 | Material Field与Shelf Target允许相同或重叠 | `UI,API,E2E,MEDIA-S,FS` | `EV-UI,EV-API,EV-FS,EV-FACT` | `NOT_RUN` |
| F02.14 | 重叠Field内已处于Production/Finished Goods的文件由Material Control排除，不会再次采购 | `E2E,MEDIA-S,FS,RECOVERY,NEG` | `EV-FS,EV-FACT,EV-REC,EV-NEG` | `NOT_RUN` |
| F02.15 | 注销Field停止新的Observation/Extraction，不修改物理文件 | `UI,API,E2E,FS,NEG` | `EV-UI,EV-API,EV-FS,EV-FACT,EV-NEG` | `NOT_RUN` |
| F02.16 | Field注销后，已被Procurement/Libra/Arca接管的责任继续收口 | `E2E,RECOVERY` | `EV-ACT,EV-FACT,EV-REC` | `NOT_RUN` |
| F02.17 | 只有sealed失败批次仍满足当前Eligibility时才能“重新尝试准备”；该动作建立新Retry Intent，不重开旧Run | `UI,API,E2E,RECOVERY,NEG` | `EV-UI,EV-API,EV-ACT,EV-FACT,EV-REC,EV-NEG` | `NOT_RUN` |
| F02.18 | Field注销确认显示注销后仍会继续的在途责任 | `UI,API,VISUAL` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |

### F03 — 收藏架管理

| Feature | 已确认用户结果 | 必须验证 | Evidence | Status |
| --- | --- | --- | --- | --- |
| F03.01 | 用户可以创建Shelf | `UI,API` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F03.02 | 每座Shelf有且仅有一个已验证Physical Target Folder | `UI,API,FS,NEG` | `EV-UI,EV-API,EV-FS,EV-NEG` | `NOT_RUN` |
| F03.03 | Shelf显示当前绑定Template/Standard支持的content profile，不另造冲突的独立Profile设置 | `UI,API,NEG` | `EV-UI,EV-API,EV-FACT,EV-NEG` | `NOT_RUN` |
| F03.04 | 用户可以绑定/更换Rule Template，Shelf持续跟随该Template后续active revision | `UI,API,E2E` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F03.05 | 用户可以配置最终Placement/layout结果 | `UI,API,E2E,FS` | `EV-UI,EV-API,EV-FS,EV-FACT` | `NOT_RUN` |
| F03.06 | Shelf从权威Projection显示收藏数量、空间和健康比例 | `UI,API` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F03.07 | Shelf显示当前生效收藏标准 | `UI,API` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F03.08 | Shelf显示哪些Field/Routing Policy可以把材料送入本Shelf | `UI,API` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F03.09 | 用户可以在安全预览和验证后发布新的Shelf Target | `UI,API,FS,NEG` | `EV-UI,EV-API,EV-FS,EV-NEG` | `NOT_RUN` |
| F03.10 | 现有Shelf Entry保持身份，Aftercare把不符合Placement的Inventory移动到新Target | `E2E,MEDIA-S,FS,RECOVERY` | `EV-FS,EV-ACT,EV-FACT,EV-REC` | `NOT_RUN` |
| F03.11 | 用户可以强确认Shelf注销，并被告知active Field内释放后的文件可能被重新采购 | `UI,API,VISUAL` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F03.12 | Shelf注销终结收藏事实并释放Control，但不删除、移动或重命名文件 | `E2E,MEDIA-S,FS,NEG` | `EV-FS,EV-FACT,EV-NEG` | `NOT_RUN` |
| F03.13 | 已注销Shelf和收藏历史仍可查询，但不计入当前Own | `UI,API,RECOVERY` | `EV-UI,EV-API,EV-FACT,EV-REC` | `NOT_RUN` |

### F04 — 固定去向与自动分拣

| Feature | 已确认用户结果 | 必须验证 | Evidence | Status |
| --- | --- | --- | --- | --- |
| F04.01 | 每片Material Field拥有独立current routing mode | `UI,API` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F04.02 | 固定去向模式下，Libra对来源于该Material Field、已成功接管的每个Subject，直接形成指向唯一active Shelf的Routing Decision；该决策本身不建立Shelf Entry或Deck Fact | `UI,API,E2E,MEDIA-S,NEG` | `EV-UI,EV-API,EV-ACT,EV-FACT,EV-NEG` | `NOT_RUN` |
| F04.03 | 按内容分拣让一片Field依次评估多个active Shelf | `UI,API,E2E,MEDIA-S` | `EV-UI,EV-API,EV-ACT,EV-FACT` | `NOT_RUN` |
| F04.04 | 用户可以通过拖拽/重排设置唯一Shelf评估顺序 | `UI,API,VISUAL` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F04.05 | 分拣只选择第一个命中的Shelf | `E2E,MEDIA-S,NEG` | `EV-ACT,EV-FACT,EV-NEG` | `NOT_RUN` |
| F04.06 | Draft Preview显示当前命中情况，但不发布也不启动生产 | `UI,API,NEG` | `EV-UI,EV-API,EV-NEG` | `NOT_RUN` |
| F04.07 | Preview和Formation明确显示`unknown`和`unmatched`，不虚构去向 | `UI,API,E2E,NEG` | `EV-UI,EV-API,EV-ACT,EV-NEG` | `NOT_RUN` |
| F04.08 | 用户可以为unresolved Subject一次性选择Shelf | `UI,API,E2E` | `EV-UI,EV-API,EV-ACT,EV-FACT` | `NOT_RUN` |
| F04.09 | 发布Routing revision不会移动或重新路由已有Shelf Entry | `E2E,MEDIA-S,FS,NEG` | `EV-FS,EV-FACT,EV-NEG` | `NOT_RUN` |
| F04.10 | 同一实例可以同时存在固定去向Field和分拣Field | `UI,API,E2E,MEDIA-S` | `EV-UI,EV-API,EV-ACT,EV-FACT` | `NOT_RUN` |

### F05 — 自动发现、生产与On-deck

| Feature | 已确认用户结果 | 必须验证 | Evidence | Status |
| --- | --- | --- | --- | --- |
| F05.01 | 新的eligible媒体会被自动发现 | `E2E,MEDIA-S,FS` | `EV-FS,EV-ACT,EV-FACT` | `NOT_RUN` |
| F05.02 | 已发现Physical Material会被确定性Triage | `E2E,MEDIA-S` | `EV-ACT,EV-FACT` | `NOT_RUN` |
| F05.03 | Triage建立content profile和最小结构，但不冒充Canonical Identity确认 | `E2E,MEDIA-S,NEG` | `EV-ACT,EV-FACT,EV-NEG` | `NOT_RUN` |
| F05.04 | Triage发布完整不可变Candidate Package | `E2E,MEDIA-S,RECOVERY` | `EV-FACT,EV-REC` | `NOT_RUN` |
| F05.05 | Libra解析目标Shelf，或明确保持unresolved | `E2E,MEDIA-S` | `EV-ACT,EV-FACT` | `NOT_RUN` |
| F05.06 | Libra依据当前Shelf Standard和Decision Facts计算确定性Acceptance Spec | `E2E,MEDIA-S,NEG` | `EV-FACT,EV-NEG` | `NOT_RUN` |
| F05.07 | 所有变更产品只在Libra Workspace中生产 | `E2E,MEDIA-S,FS,NEG` | `EV-FS,EV-ACT,EV-NEG` | `NOT_RUN` |
| F05.08 | Arca依据当前Shelf Standard独立接受或拒绝提交产品 | `E2E,MEDIA-S,NEG` | `EV-ACT,EV-FACT,EV-NEG` | `NOT_RUN` |
| F05.09 | Accepted产品被安全Off-load到Shelf Target | `E2E,MEDIA-S,FS,RECOVERY` | `EV-FS,EV-ACT,EV-FACT,EV-REC` | `NOT_RUN` |
| F05.10 | 只有成功On-deck Commit才能建立或扩充正式Shelf Entry和Deck Fact | `E2E,MEDIA-S,NEG` | `EV-FACT,EV-NEG` | `NOT_RUN` |
| F05.11 | Service中断后恢复时不产生重复物理副作用，也不丢失责任 | `E2E,MEDIA-S,FS,RECOVERY` | `EV-FS,EV-FACT,EV-REC` | `NOT_RUN` |
| F05.12 | 有界恢复预算耗尽后Run进入Frozen，释放计算供给但继续持有Material责任 | `E2E,RECOVERY,NEG` | `EV-ACT,EV-FACT,EV-REC,EV-NEG` | `NOT_RUN` |
| F05.13 | 用户可以discard Frozen Run；Workspace被回收，原材料可以作为新流程重新采购 | `UI,API,E2E,MEDIA-S,FS` | `EV-UI,EV-API,EV-FS,EV-FACT` | `NOT_RUN` |
| F05.14 | 用户可以加快/取消加快active Libra Run，不改变已执行工作，也不把优先级传给Arca | `UI,API,E2E,NEG` | `EV-UI,EV-API,EV-ACT,EV-NEG` | `NOT_RUN` |
| F05.15 | 全自动维持standing settlement authorization，但Arca只处理由它派生的本次On-deck精确冻结Scope | `UI,API,E2E,MEDIA-S,FS,NEG` | `EV-UI,EV-API,EV-FS,EV-FACT,EV-NEG` | `NOT_RUN` |
| F05.16 | 关键步骤确认会等待当前Scope的旧Input处理Approval | `UI,API,E2E,MEDIA-S,FS,NEG` | `EV-UI,EV-API,EV-ACT,EV-FS,EV-NEG` | `NOT_RUN` |
| F05.17 | Libra Run建立前，用户可以放弃unresolved Subject，释放Primary Control并保持源文件不变，以便未来重新采购 | `UI,API,E2E,MEDIA-S,FS,NEG` | `EV-UI,EV-API,EV-FS,EV-FACT,EV-NEG` | `NOT_RUN` |

### F06 — 上架过程可见性

| Feature | 已确认用户结果 | 必须验证 | Evidence | Status |
| --- | --- | --- | --- | --- |
| F06.01 | Formation显示稳定用户阶段`已发现|正在准备|待选择去向|正在生产|正在验收|正在上架|需要处理|已完成` | `UI,API,E2E,VISUAL` | `EV-UI,EV-API,EV-ACT` | `NOT_RUN` |
| F06.02 | Activity显示真实发生的分析、身份、Metadata、图片、NFO、字幕、转码、Remux、验证和整理动作 | `UI,API,E2E,MEDIA-S,VISUAL` | `EV-UI,EV-API,EV-ACT` | `NOT_RUN` |
| F06.03 | 可量化转码/下载显示真实百分比、速率和已用时间 | `UI,E2E,MEDIA-S,PROBE,VISUAL` | `EV-UI,EV-ACT,EV-MEDIA` | `NOT_RUN` |
| F06.04 | 只有在能从真实进度计算时才显示ETA | `UI,E2E,MEDIA-S,NEG,VISUAL` | `EV-UI,EV-ACT,EV-NEG` | `NOT_RUN` |
| F06.05 | 等待状态说明资源、Provider或Approval等真实暂时原因 | `UI,E2E,NEG,VISUAL` | `EV-UI,EV-ACT,EV-NEG` | `NOT_RUN` |
| F06.06 | 刷新或重启后仍保留已完成动作的时间和结果摘要 | `UI,API,E2E,RECOVERY` | `EV-UI,EV-ACT,EV-REC` | `NOT_RUN` |
| F06.07 | Advanced Diagnostics可以追溯技术Evidence，但不污染普通页面 | `UI,API,VISUAL,AUDIT` | `EV-UI,EV-API,EV-AUDIT` | `NOT_RUN` |
| F06.08 | 普通UI不暴露Task、Gate、Capability或Flow控制 | `UI,NEG,VISUAL,AUDIT` | `EV-UI,EV-NEG,EV-AUDIT` | `NOT_RUN` |

### F07 — Movie Profile

| Feature | 已确认用户结果 | 必须验证 | Evidence | Status |
| --- | --- | --- | --- | --- |
| F07.01 | 一部Movie作为一个`single` Shelf Entry形成正式收藏 | `E2E,MEDIA-S` | `EV-ACT,EV-FACT,EV-FS` | `NOT_RUN` |
| F07.02 | Movie On-deck要求有效TMDB Movie Identity | `E2E,MEDIA-S,PROVIDER,NEG` | `EV-PROVIDER,EV-FACT,EV-NEG` | `NOT_RUN` |
| F07.03 | 外部Metadata之前先读取有效Candidate Related NFO | `E2E,MEDIA-S,FS` | `EV-FS,EV-ACT,EV-FACT` | `NOT_RUN` |
| F07.04 | 缺失的Movie必需字段从真实TMDB补齐 | `E2E,MEDIA-S,PROVIDER` | `EV-PROVIDER,EV-ACT,EV-FACT` | `NOT_RUN` |
| F07.05 | TMDB默认值不覆盖用户NFO中已有的有效值 | `E2E,MEDIA-S,PROVIDER,FS,NEG` | `EV-PROVIDER,EV-FS,EV-NEG` | `NOT_RUN` |
| F07.06 | Product包含受控、可解析Movie NFO | `E2E,MEDIA-S,FS,NEG` | `EV-FS,EV-FACT,EV-NEG` | `NOT_RUN` |
| F07.07 | Product至少包含一张存在、非空且可解码的Poster | `E2E,MEDIA-S,FS,NEG` | `EV-FS,EV-FACT,EV-NEG` | `NOT_RUN` |
| F07.08 | Product提供TMDB ID、标题、年份/上映日期、简介、类型、演员和导演 | `UI,API,E2E,MEDIA-S,PROVIDER` | `EV-UI,EV-API,EV-PROVIDER,EV-FACT` | `NOT_RUN` |
| F07.09 | BDMV/ISO/disc Input在形成stream file前不能On-deck | `E2E,MEDIA-F,FS,PROBE,NEG` | `EV-FS,EV-MEDIA,EV-FACT,EV-NEG` | `NOT_RUN` |
| F07.10 | 已解析Rating选择对应不可变Movie媒体与空间要求 | `E2E,MEDIA-S,NEG` | `EV-FACT,EV-MEDIA,EV-NEG` | `NOT_RUN` |
| F07.11 | No-rating Movie以stream-file正式On-deck，不设置评分空间上限，也不强制HEVC、4K或高质量音轨 | `E2E,MEDIA-S,NEG` | `EV-FACT,EV-MEDIA,EV-NEG` | `NOT_RUN` |

### F08 — Series Profile

| Feature | 已确认用户结果 | 必须验证 | Evidence | Status |
| --- | --- | --- | --- | --- |
| F08.01 | Series收藏以Season颗粒度拥有 | `UI,API,E2E,MEDIA-S` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F08.02 | Season On-deck要求TMDB Series Identity和Season Number | `E2E,MEDIA-S,PROVIDER,NEG` | `EV-PROVIDER,EV-FACT,EV-NEG` | `NOT_RUN` |
| F08.03 | 每个规范化Episode有且仅有一个Primary Video | `E2E,MEDIA-S,FS,NEG` | `EV-FS,EV-FACT,EV-NEG` | `NOT_RUN` |
| F08.04 | 每个交付Episode包含number、title、plot和NFO | `UI,API,E2E,MEDIA-S,FS` | `EV-UI,EV-API,EV-FS,EV-FACT` | `NOT_RUN` |
| F08.05 | Season包含series title、plot、genre、actor、NFO和poster | `UI,API,E2E,MEDIA-S,PROVIDER,FS` | `EV-UI,EV-API,EV-PROVIDER,EV-FS,EV-FACT` | `NOT_RUN` |
| F08.06 | 不重叠Episode交付可以独立运行 | `E2E,MEDIA-S,RECOVERY` | `EV-ACT,EV-FACT,EV-REC` | `NOT_RUN` |
| F08.07 | 后续Accepted Episode扩充同一Season Shelf Entry | `E2E,MEDIA-S,FS,RECOVERY` | `EV-FS,EV-FACT,EV-REC` | `NOT_RUN` |
| F08.08 | 只验收冻结的本次Episode交付Scope；理论缺集不阻断 | `E2E,MEDIA-S,NEG` | `EV-FACT,EV-NEG` | `NOT_RUN` |
| F08.09 | `E01-E02`或multipart Input被规范化，不以长期N:M结构On-deck | `E2E,MEDIA-S,FS,PROBE,NEG` | `EV-FS,EV-MEDIA,EV-FACT,EV-NEG` | `NOT_RUN` |
| F08.10 | 空间要求按Episode独立验收，不使用Season总大小 | `E2E,MEDIA-F,PROBE,NEG` | `EV-MEDIA,EV-FACT,EV-NEG` | `NOT_RUN` |
| F08.11 | No-rating Season可以正式On-deck，每个Episode要求HEVC但不设置评分空间上限 | `E2E,MEDIA-S,PROBE,NEG` | `EV-MEDIA,EV-FACT,EV-NEG` | `NOT_RUN` |

### F09 — JAV Profile

| Feature | 已确认用户结果 | 必须验证 | Evidence | Status |
| --- | --- | --- | --- | --- |
| F09.01 | 一部JAV作为一个`single` Shelf Entry形成正式收藏 | `E2E,MEDIA-S` | `EV-ACT,EV-FACT,EV-FS` | `NOT_RUN` |
| F09.02 | JAV On-deck要求非空、稳定、规范化番号 | `E2E,MEDIA-S,NEG` | `EV-FACT,EV-NEG` | `NOT_RUN` |
| F09.03 | Metadata通过已配置真实JAV Provider取得 | `E2E,MEDIA-S,PROVIDER` | `EV-PROVIDER,EV-ACT,EV-FACT` | `NOT_RUN` |
| F09.04 | Product提供番号、标题、发布日期、片商、类型和可解析NFO | `UI,API,E2E,MEDIA-S,FS` | `EV-UI,EV-API,EV-FS,EV-FACT` | `NOT_RUN` |
| F09.05 | Product至少包含一张可解码Poster和Fanart | `E2E,MEDIA-S,FS,NEG` | `EV-FS,EV-FACT,EV-NEG` | `NOT_RUN` |
| F09.06 | 最终Primary Video经验证为HEVC | `E2E,MEDIA-S,PROBE,NEG` | `EV-MEDIA,EV-FACT,EV-NEG` | `NOT_RUN` |
| F09.07 | 最终Primary Video经验证为Matroska | `E2E,MEDIA-S,PROBE,NEG` | `EV-MEDIA,EV-FACT,EV-NEG` | `NOT_RUN` |
| F09.08 | 最终Primary Video扩展名为`.mkv`，仅重命名不能伪造合规 | `E2E,MEDIA-S,FS,PROBE,NEG` | `EV-FS,EV-MEDIA,EV-NEG` | `NOT_RUN` |
| F09.09 | 推荐Template以full-length Evidence验证每个JAV single最大2 GiB | `E2E,MEDIA-F,PROBE` | `EV-MEDIA,EV-PERF,EV-FACT` | `NOT_RUN` |
| F09.10 | 推荐JAV规则不查询Rating，也不按Rating分支 | `E2E,MEDIA-S,NEG` | `EV-FACT,EV-NEG` | `NOT_RUN` |

### F10 — Western Adult Profile

| Feature | 已确认用户结果 | 必须验证 | Evidence | Status |
| --- | --- | --- | --- | --- |
| F10.01 | 一部Western Adult作为一个`single` Shelf Entry形成正式收藏 | `E2E,MEDIA-S` | `EV-ACT,EV-FACT,EV-FS` | `NOT_RUN` |
| F10.02 | Libra形成稳定内部Resolved Product Identity | `E2E,MEDIA-S,NEG` | `EV-ACT,EV-FACT,EV-NEG` | `NOT_RUN` |
| F10.03 | On-deck不要求也不伪造外部Provider Identity | `E2E,MEDIA-S,NEG,AUDIT` | `EV-FACT,EV-NEG,EV-AUDIT` | `NOT_RUN` |
| F10.04 | Frames/analysis/normalize形成Product Metadata Basis | `E2E,MEDIA-S,PROBE` | `EV-MEDIA,EV-ACT,EV-FACT` | `NOT_RUN` |
| F10.05 | Product包含标题、可解析NFO和至少一张可解码Poster | `UI,API,E2E,MEDIA-S,FS,NEG` | `EV-UI,EV-API,EV-FS,EV-FACT,EV-NEG` | `NOT_RUN` |
| F10.06 | 最终Primary Video经验证为HEVC | `E2E,MEDIA-S,PROBE,NEG` | `EV-MEDIA,EV-FACT,EV-NEG` | `NOT_RUN` |
| F10.07 | 最终Primary Video经验证为Matroska | `E2E,MEDIA-S,PROBE,NEG` | `EV-MEDIA,EV-FACT,EV-NEG` | `NOT_RUN` |
| F10.08 | 最终Primary Video扩展名为`.mkv`，仅重命名不能伪造合规 | `E2E,MEDIA-S,FS,PROBE,NEG` | `EV-FS,EV-MEDIA,EV-NEG` | `NOT_RUN` |
| F10.09 | 推荐Template以full-length Evidence验证每个Western single最大1 GiB | `E2E,MEDIA-F,PROBE` | `EV-MEDIA,EV-PERF,EV-FACT` | `NOT_RUN` |
| F10.10 | 推荐Western规则不查询Rating，也不按Rating分支 | `E2E,MEDIA-S,NEG` | `EV-FACT,EV-NEG` | `NOT_RUN` |

### F11 — 媒体优化

| Feature | 已确认用户结果 | 必须验证 | Evidence | Status |
| --- | --- | --- | --- | --- |
| F11.01 | 真实FFprobe检查Input和Output媒体事实 | `E2E,MEDIA-S,PROBE` | `EV-MEDIA,EV-ACT` | `NOT_RUN` |
| F11.02 | 真实FFmpeg在Workspace中执行绑定目标的转码 | `E2E,MEDIA-S,FS,PROBE,RECOVERY` | `EV-FS,EV-MEDIA,EV-ACT,EV-REC` | `NOT_RUN` |
| F11.03 | 兼容流可以无损Remux，不进行不必要重编码 | `E2E,MEDIA-S,FS,PROBE` | `EV-FS,EV-MEDIA,EV-ACT` | `NOT_RUN` |
| F11.04 | HEVC要求依据Output Probe判断，不看文件名 | `E2E,MEDIA-S,PROBE,NEG` | `EV-MEDIA,EV-NEG` | `NOT_RUN` |
| F11.05 | 容器和扩展名要求分别、精确判断 | `E2E,MEDIA-S,FS,PROBE,NEG` | `EV-FS,EV-MEDIA,EV-NEG` | `NOT_RUN` |
| F11.06 | 适用max-size依据最终字节和正确product/Episode unit判断 | `E2E,MEDIA-F,FS,PROBE` | `EV-FS,EV-MEDIA,EV-PERF,EV-FACT` | `NOT_RUN` |
| F11.07 | 4K class依据规范化display raster判断，不看名称或UI标签 | `E2E,MEDIA-F,PROBE,NEG` | `EV-MEDIA,EV-NEG` | `NOT_RUN` |
| F11.08 | 高质量主音轨只按照closed accepted classes判断 | `E2E,MEDIA-F,PROBE,NEG` | `EV-MEDIA,EV-NEG` | `NOT_RUN` |
| F11.09 | 已合规Input直接复用/no-op，不重复处理 | `E2E,MEDIA-S,FS,PROBE,NEG` | `EV-FS,EV-MEDIA,EV-ACT,EV-NEG` | `NOT_RUN` |
| F11.10 | 小于max-size的Product不会为贴近上限而扩大 | `E2E,MEDIA-S,FS,PROBE,NEG` | `EV-FS,EV-MEDIA,EV-NEG` | `NOT_RUN` |
| F11.11 | Planner在不改变Spec的前提下选择合法质量/空间/计算路径 | `E2E,MEDIA-S,NEG` | `EV-ACT,EV-FACT,EV-NEG` | `NOT_RUN` |
| F11.12 | 用户只配置Outcome，不需要选择编码参数、码率或Flow | `UI,VISUAL,AUDIT` | `EV-UI,EV-AUDIT` | `NOT_RUN` |
| F11.13 | 系统不存在也不会使用音频转码Capability/路径 | `E2E,MEDIA-S,PROBE,NEG,AUDIT` | `EV-MEDIA,EV-NEG,EV-AUDIT` | `NOT_RUN` |
| F11.14 | 在确有要求且已配置时，真实外部Acquisition通过typed Integration提供替代Input | `E2E,MEDIA-S,PROVIDER,RECOVERY,NEG` | `EV-PROVIDER,EV-ACT,EV-REC,EV-NEG` | `NOT_RUN` |
| F11.15 | 低于4K的Input通过普通resize/scale不能满足4K Requirement | `E2E,MEDIA-S,PROBE,NEG` | `EV-MEDIA,EV-FACT,EV-NEG` | `NOT_RUN` |
| F11.16 | Beta不包含AI Upscale工具、设置、Capability或执行路径 | `UI,API,NEG,AUDIT` | `EV-UI,EV-API,EV-NEG,EV-AUDIT` | `NOT_RUN` |

### F12 — 推荐评分规则

| Feature | 已确认用户结果 | 必须验证 | Evidence | Status |
| --- | --- | --- | --- | --- |
| F12.01 | 1星Movie解析为最大2 GiB、HEVC和stream-file | `UI,API,E2E` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F12.02 | 2星Movie解析为最大4 GiB、HEVC和stream-file | `UI,API,E2E` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F12.03 | 3星Movie解析为最大8 GiB、HEVC和stream-file | `UI,API,E2E` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F12.04 | 4星Movie解析为最大14 GiB、HEVC和stream-file | `UI,API,E2E` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F12.05 | 5星Movie解析为最大50 GiB、HEVC、stream-file、4K和Accepted高质量主音轨 | `UI,API,E2E,MEDIA-F,PROBE` | `EV-UI,EV-API,EV-MEDIA,EV-FACT` | `NOT_RUN` |
| F12.06 | 1星Season解析为每Episode最大0.75 GiB | `UI,API,E2E` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F12.07 | 2星Season解析为每Episode最大1 GiB | `UI,API,E2E` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F12.08 | 3星Season解析为每Episode最大1.5 GiB | `UI,API,E2E` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F12.09 | 4星Season解析为每Episode最大2 GiB | `UI,API,E2E` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F12.10 | 5星Season解析为每Episode最大3 GiB，不增加4K/音轨升级要求 | `UI,API,E2E,NEG` | `EV-UI,EV-API,EV-FACT,EV-NEG` | `NOT_RUN` |
| F12.11 | 用户可以复制System Template、编辑可恢复User Draft并发布新的不可变active revision | `UI,API,RECOVERY` | `EV-UI,EV-API,EV-FACT,EV-REC` | `NOT_RUN` |
| F12.12 | 系统推荐Template不可编辑或覆盖 | `UI,API,NEG` | `EV-UI,EV-API,EV-NEG` | `NOT_RUN` |
| F12.13 | Template编辑器只暴露Outcome，并拒绝未注册生产手段字段 | `UI,API,NEG,AUDIT` | `EV-UI,EV-API,EV-NEG,EV-AUDIT` | `NOT_RUN` |
| F12.14 | 关闭浏览器后保留未发布User Template Draft及revision | `UI,API,RECOVERY` | `EV-UI,EV-API,EV-FACT,EV-REC` | `NOT_RUN` |
| F12.15 | Template Preview显示受影响Shelf、现有Entry潜在Gap、未On-deck Spec变化和unknown，不发布也不启动工作 | `UI,API,NEG,VISUAL` | `EV-UI,EV-API,EV-FACT,EV-NEG` | `NOT_RUN` |
| F12.16 | 历史User Template revision只能恢复为新的active revision，不改写历史 | `UI,API,RECOVERY,NEG` | `EV-UI,EV-API,EV-FACT,EV-REC,EV-NEG` | `NOT_RUN` |

### F13 — 正式收藏

| Feature | 已确认用户结果 | 必须验证 | Evidence | Status |
| --- | --- | --- | --- | --- |
| F13.01 | “我的收藏”只列出当前有效Shelf Entry | `UI,API,E2E` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F13.02 | Candidate、Subject、Run、Workspace Product和已接受但未On-deck货品永不计入Own | `UI,API,E2E,NEG` | `EV-UI,EV-API,EV-FACT,EV-NEG` | `NOT_RUN` |
| F13.03 | 用户可以按Shelf筛选收藏 | `UI,API,VISUAL` | `EV-UI,EV-API` | `NOT_RUN` |
| F13.04 | 用户可以按Movie、Season和single/profile筛选 | `UI,API,VISUAL` | `EV-UI,EV-API` | `NOT_RUN` |
| F13.05 | 用户可以按健康、评分、Person、空间、编码和On-deck时间筛选 | `UI,API,VISUAL` | `EV-UI,EV-API` | `NOT_RUN` |
| F13.06 | 详情显示标题、封面、Canonical Content Identity和Season结构 | `UI,API,VISUAL` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F13.07 | 详情显示当前Inventory Representation和物理位置 | `UI,API,E2E,FS` | `EV-UI,EV-API,EV-FS,EV-FACT` | `NOT_RUN` |
| F13.08 | 详情显示Primary/Related Material摘要，不把内部Handle暴露为用户身份 | `UI,API,VISUAL,NEG` | `EV-UI,EV-API,EV-NEG` | `NOT_RUN` |
| F13.09 | 详情显示Metadata和媒体技术事实 | `UI,API,PROBE` | `EV-UI,EV-API,EV-MEDIA,EV-FACT` | `NOT_RUN` |
| F13.10 | 详情显示空间和规范化成果 | `UI,API,E2E,FS,PROBE` | `EV-UI,EV-API,EV-FS,EV-MEDIA` | `NOT_RUN` |
| F13.11 | 详情显示Formation、Aftercare和Off-deck历史 | `UI,API,RECOVERY` | `EV-UI,EV-API,EV-FACT,EV-REC` | `NOT_RUN` |
| F13.12 | 历史筛选显示offdecked/deregistered记录，但不计入当前Own | `UI,API,NEG` | `EV-UI,EV-API,EV-FACT,EV-NEG` | `NOT_RUN` |

### F14 — Rating与Watched Perception

| Feature | 已确认用户结果 | 必须验证 | Evidence | Status |
| --- | --- | --- | --- | --- |
| F14.01 | 用户可以持久化1–5星媒体评分 | `UI,API,RECOVERY` | `EV-UI,EV-API,EV-FACT,EV-REC` | `NOT_RUN` |
| F14.02 | 用户可以持久化watched/unwatched状态 | `UI,API,RECOVERY` | `EV-UI,EV-API,EV-FACT,EV-REC` | `NOT_RUN` |
| F14.03 | 缺少Rating时解析为`not_found`，不会从其他Perception Record伪造 | `API,E2E,NEG` | `EV-API,EV-FACT,EV-NEG` | `NOT_RUN` |
| F14.04 | On-deck前后都可以记录Rating/Watched | `UI,API,E2E` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F14.05 | 后续更强Content Identity触发确定性重新Resolution，但不改写原Record | `E2E,RECOVERY,NEG` | `EV-FACT,EV-REC,EV-NEG` | `NOT_RUN` |
| F14.06 | Perception变化不直接中断已运行消费者 | `E2E,NEG` | `EV-ACT,EV-FACT,EV-NEG` | `NOT_RUN` |
| F14.07 | 新Decision Preparation使用当前Perception Resolution | `E2E,NEG` | `EV-FACT,EV-NEG` | `NOT_RUN` |
| F14.08 | Rating不会作为Acceptance Requirement写入NFO | `E2E,MEDIA-S,FS,NEG` | `EV-FS,EV-FACT,EV-NEG` | `NOT_RUN` |
| F14.09 | 配置真实Douban来源后，用户可以执行/安排有界Perception同步 | `UI,API,PROVIDER,RECOVERY` | `EV-UI,EV-API,EV-PROVIDER,EV-REC` | `NOT_RUN` |

### F15 — Collection Assurance与Aftercare

| Feature | 已确认用户结果 | 必须验证 | Evidence | Status |
| --- | --- | --- | --- | --- |
| F15.01 | Assurance验证每个受控Material存在且可达 | `E2E,MEDIA-S,FS,NEG` | `EV-FS,EV-FACT,EV-NEG` | `NOT_RUN` |
| F15.02 | Assurance验证Physical Identity一致性，不只验证路径 | `E2E,MEDIA-S,FS,NEG` | `EV-FS,EV-FACT,EV-NEG` | `NOT_RUN` |
| F15.03 | Presentation依据Standard检查Metadata、NFO、Poster/Fanart和Sidecar | `E2E,MEDIA-S,FS,NEG` | `EV-FS,EV-FACT,EV-NEG` | `NOT_RUN` |
| F15.04 | Conformance检查编码、容器、大小、分辨率和音轨要求 | `E2E,MEDIA-F,PROBE,NEG` | `EV-MEDIA,EV-FACT,EV-NEG` | `NOT_RUN` |
| F15.05 | Conformance检查物理位置、布局和命名 | `E2E,MEDIA-S,FS,NEG` | `EV-FS,EV-FACT,EV-NEG` | `NOT_RUN` |
| F15.06 | 用户可以要求立即执行有界健康Assessment | `UI,API,E2E` | `EV-UI,EV-API,EV-ACT,EV-FACT` | `NOT_RUN` |
| F15.07 | 低成本、高成功率、非破坏性的确定性Finding自动修复 | `E2E,MEDIA-S,FS,RECOVERY` | `EV-FS,EV-ACT,EV-FACT,EV-REC` | `NOT_RUN` |
| F15.08 | 每次Repair在收藏恢复健康前独立复验 | `E2E,MEDIA-S,NEG` | `EV-ACT,EV-FACT,EV-NEG` | `NOT_RUN` |
| F15.09 | 不确定/不可修复Finding形成明确`attention_required`，不显示虚假修复按钮 | `UI,API,E2E,NEG,VISUAL` | `EV-UI,EV-API,EV-FACT,EV-NEG` | `NOT_RUN` |
| F15.10 | 共享Endpoint/Provider Incident聚合显示，不为每个Shelf Entry重复制造问题 | `UI,API,E2E,NEG` | `EV-UI,EV-API,EV-FACT,EV-NEG` | `NOT_RUN` |
| F15.11 | 发布新Shelf Standard后重新评估现有Shelf Entry | `UI,API,E2E` | `EV-UI,EV-API,EV-ACT,EV-FACT` | `NOT_RUN` |
| F15.12 | 完全可规划Gap建立Aftercare Case并完成独立验收 | `E2E,MEDIA-S,FS,RECOVERY` | `EV-FS,EV-ACT,EV-FACT,EV-REC` | `NOT_RUN` |
| F15.13 | 需要不可用Acquisition/Capability的Gap保持可解释attention，不伪造Case | `UI,API,E2E,NEG` | `EV-UI,EV-API,EV-FACT,EV-NEG` | `NOT_RUN` |
| F15.14 | Aftercare不能建立Off-deck Authorization或销毁媒体 | `E2E,MEDIA-S,FS,NEG,AUDIT` | `EV-FS,EV-FACT,EV-NEG,EV-AUDIT` | `NOT_RUN` |

### F16 — 退出收藏

| Feature | 已确认用户结果 | 必须验证 | Evidence | Status |
| --- | --- | --- | --- | --- |
| F16.01 | 已配置低评分条件可以产生Off-deck Candidate；无评分不等于低评分 | `UI,API,E2E,NEG` | `EV-UI,EV-API,EV-FACT,EV-NEG` | `NOT_RUN` |
| F16.02 | 已确认Disliked Person条件可以依据Media-Cast Fact产生Candidate | `UI,API,E2E,NEG` | `EV-UI,EV-API,EV-FACT,EV-NEG` | `NOT_RUN` |
| F16.03 | Collection Duplicate依据On-deck Canonical Identity形成Group | `UI,API,E2E,MEDIA-S` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F16.04 | 长期未解决Care Finding可按Policy形成Candidate | `UI,API,E2E` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F16.05 | Season收藏期限从最后一次新增Episode开始计算 | `UI,API,E2E,NEG` | `EV-UI,EV-API,EV-FACT,EV-NEG` | `NOT_RUN` |
| F16.06 | 用户可以显式触发Duplicate Detection | `UI,API,E2E` | `EV-UI,EV-API,EV-ACT,EV-FACT` | `NOT_RUN` |
| F16.07 | Candidate显示精确原因、Shelf Entry、Material和预计释放空间 | `UI,API,VISUAL` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F16.08 | 由用户而非系统选择重复项的保留/销毁成员 | `UI,API,NEG,VISUAL` | `EV-UI,EV-API,EV-NEG` | `NOT_RUN` |
| F16.09 | 用户可以保留全部重复成员 | `UI,API,E2E,NEG` | `EV-UI,EV-API,EV-FACT,EV-NEG` | `NOT_RUN` |
| F16.10 | Suppression/Whitelist在精确Scope内防止重复产生Candidate | `UI,API,E2E,RECOVERY` | `EV-UI,EV-API,EV-FACT,EV-REC` | `NOT_RUN` |
| F16.11 | 用户可以为一个不可变Shelf Entry Scope授权销毁 | `UI,API,E2E,MEDIA-S,FS,VISUAL` | `EV-UI,EV-API,EV-FS,EV-FACT` | `NOT_RUN` |
| F16.12 | 用户可以批量授权，但每个Entry仍有独立不可变Scope/Case | `UI,API,E2E,MEDIA-S,FS` | `EV-UI,EV-API,EV-FS,EV-FACT` | `NOT_RUN` |
| F16.13 | 达到`>=10` Entry、`>=50` Primary、`>=100 GiB`或已确认Shelf/Deck比例阈值时，必须独立二次确认并重复显示精确影响 | `UI,API,NEG,VISUAL` | `EV-UI,EV-API,EV-NEG` | `NOT_RUN` |
| F16.14 | 破坏性Authorization前用户可以取消并释放Reservation | `UI,API,E2E,MEDIA-S,FS,NEG` | `EV-UI,EV-API,EV-FS,EV-FACT,EV-NEG` | `NOT_RUN` |
| F16.15 | 已持久化破坏性Authorization不可撤销，且不存在取消路径 | `UI,API,E2E,NEG,AUDIT` | `EV-UI,EV-API,EV-FACT,EV-NEG,EV-AUDIT` | `NOT_RUN` |
| F16.16 | Off-deck只删除目标Shelf Entry独占的Primary Material | `E2E,MEDIA-S,FS,RECOVERY,NEG` | `EV-FS,EV-FACT,EV-REC,EV-NEG` | `NOT_RUN` |
| F16.17 | Related Material仅在最后有效引用释放后删除 | `E2E,MEDIA-S,FS,NEG` | `EV-FS,EV-FACT,EV-NEG` | `NOT_RUN` |
| F16.18 | 重启后Off-deck历史仍保留terminal Shelf Entry、Authorization和Deletion Evidence | `UI,API,E2E,RECOVERY` | `EV-UI,EV-API,EV-FACT,EV-REC` | `NOT_RUN` |

### F17 — People Management

| Feature | 已确认用户结果 | 必须验证 | Evidence | Status |
| --- | --- | --- | --- | --- |
| F17.01 | 用户可以直接注册Person，不要求先有Candidate或Reference Image | `UI,API,RECOVERY` | `EV-UI,EV-API,EV-FACT,EV-REC` | `NOT_RUN` |
| F17.02 | 用户可以维护Person姓名和别名 | `UI,API,RECOVERY` | `EV-UI,EV-API,EV-FACT,EV-REC` | `NOT_RUN` |
| F17.03 | 用户可以维护稳定Provider Person Identity | `UI,API,NEG` | `EV-UI,EV-API,EV-FACT,EV-NEG` | `NOT_RUN` |
| F17.04 | 用户可以设置五级Person Preference | `UI,API,RECOVERY` | `EV-UI,EV-API,EV-FACT,EV-REC` | `NOT_RUN` |
| F17.05 | Person注册后用户可以新增Reference Image | `UI,API,E2E,FS` | `EV-UI,EV-API,EV-FS,EV-FACT` | `NOT_RUN` |
| F17.06 | 用户可以释放Reference Image而不删除Person | `UI,API,E2E,FS` | `EV-UI,EV-API,EV-FS,EV-FACT` | `NOT_RUN` |
| F17.07 | Reference Image没有检测到人脸时拒绝，不形成部分Reference Fact，也不回滚Person | `UI,API,E2E,FS,NEG` | `EV-UI,EV-API,EV-FS,EV-FACT,EV-NEG` | `NOT_RUN` |
| F17.08 | Reference Image检测到多张人脸时拒绝，不显示Face选择UI，也不形成部分Fact | `UI,API,E2E,FS,NEG` | `EV-UI,EV-API,EV-FS,EV-NEG` | `NOT_RUN` |
| F17.09 | Reference Face保持内部，普通API/UI不暴露 | `UI,API,NEG,AUDIT` | `EV-UI,EV-API,EV-NEG,EV-AUDIT` | `NOT_RUN` |
| F17.10 | 每日补偿扫描消费On-deck NFO Person Evidence，不直接读取Arca Store/NFO | `E2E,MEDIA-S,RECOVERY,AUDIT` | `EV-FACT,EV-REC,EV-AUDIT` | `NOT_RUN` |
| F17.11 | 精确稳定Provider Person Identity形成可审计自动接受的strong Candidate | `E2E,MEDIA-S,NEG` | `EV-FACT,EV-NEG` | `NOT_RUN` |
| F17.12 | 只有姓名/Alias/图片/人脸Evidence时形成open weak Candidate，永不静默注册 | `UI,API,E2E,NEG` | `EV-UI,EV-API,EV-FACT,EV-NEG` | `NOT_RUN` |
| F17.13 | 重启后用户仍可接受或忽略Registration Candidate | `UI,API,RECOVERY` | `EV-UI,EV-API,EV-FACT,EV-REC` | `NOT_RUN` |
| F17.14 | 用户可以审阅并接受/忽略Merge Candidate | `UI,API,RECOVERY` | `EV-UI,EV-API,EV-FACT,EV-REC` | `NOT_RUN` |
| F17.15 | Merge存在Preference冲突时必须由用户明确选择 | `UI,API,NEG,VISUAL` | `EV-UI,EV-API,EV-FACT,EV-NEG` | `NOT_RUN` |
| F17.16 | Person详情通过Arca公开Projection显示关联收藏和数量 | `UI,API,VISUAL` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F17.17 | People Command永不写入或修正Libra/Arca Media-Cast Fact | `E2E,NEG,AUDIT` | `EV-FACT,EV-NEG,EV-AUDIT` | `NOT_RUN` |

### F18 — Provider与Integration

| Feature | 已确认用户结果 | 必须验证 | Evidence | Status |
| --- | --- | --- | --- | --- |
| F18.01 | 用户可以测试并保存真实TMDB连接，并看见Identity/Metadata能力 | `UI,API,PROVIDER,NEG` | `EV-UI,EV-API,EV-PROVIDER,EV-NEG` | `NOT_RUN` |
| F18.02 | 用户可以测试并保存真实Douban Perception来源 | `UI,API,PROVIDER,NEG` | `EV-UI,EV-API,EV-PROVIDER,EV-NEG` | `NOT_RUN` |
| F18.03 | 用户可以测试并保存真实MoviePilot搜索/Acquisition Integration | `UI,API,PROVIDER,NEG` | `EV-UI,EV-API,EV-PROVIDER,EV-NEG` | `NOT_RUN` |
| F18.04 | 用户可以测试并保存已配置JAV/Adult Provider | `UI,API,PROVIDER,NEG` | `EV-UI,EV-API,EV-PROVIDER,EV-NEG` | `NOT_RUN` |
| F18.05 | 用户可以认证/测试可选Emby Provider；ShelfDeck保存签发的Access Token/Secret Handle而非密码 | `UI,API,PROVIDER,NEG` | `EV-UI,EV-API,EV-PROVIDER,EV-NEG` | `NOT_RUN` |
| F18.06 | Beta不交付Remote Worker探测或保存；该组件在ShelfDeck Service完整验收后再决定是否重建 | `NOT_APPLICABLE` | `EV-AUDIT` | `NOT_APPLICABLE` |
| F18.07 | “测试连接”在显式Save前绝不持久化配置 | `UI,API,PROVIDER,NEG` | `EV-UI,EV-API,EV-PROVIDER,EV-NEG` | `NOT_RUN` |
| F18.08 | 已保存Secret只显示掩码，GET、错误、审计、HTML和日志均不返回明文 | `UI,API,NEG,AUDIT` | `EV-UI,EV-API,EV-NEG,EV-AUDIT` | `NOT_RUN` |
| F18.09 | Provider失败在受影响Work上形成用户可行动Integration状态 | `UI,API,E2E,PROVIDER` | `EV-UI,EV-API,EV-PROVIDER,EV-ACT` | `NOT_RUN` |
| F18.10 | 可选Provider失败不会单独把整个ShelfDeck标成System Fault | `UI,API,PROVIDER,NEG` | `EV-UI,EV-API,EV-PROVIDER,EV-NEG` | `NOT_RUN` |
| F18.11 | Emby设置不要求Library ID或Field/Shelf Mapping | `UI,API,NEG,VISUAL` | `EV-UI,EV-API,EV-NEG` | `NOT_RUN` |
| F18.12 | ShelfDeck永不创建或修改Emby Library；由用户在Emby侧指向Shelf Target | `PROVIDER,NEG,AUDIT` | `EV-PROVIDER,EV-NEG,EV-AUDIT` | `NOT_RUN` |

### F19 — Workspace与计算资源

| Feature | 已确认用户结果 | 必须验证 | Evidence | Status |
| --- | --- | --- | --- | --- |
| F19.01 | 用户可以配置Libra生产Workspace Root | `UI,API,FS` | `EV-UI,EV-API,EV-FS,EV-FACT` | `NOT_RUN` |
| F19.02 | 用户可以配置Arca Aftercare Workspace Root | `UI,API,FS` | `EV-UI,EV-API,EV-FS,EV-FACT` | `NOT_RUN` |
| F19.03 | 用户可以配置内部Artifact Repository Root | `UI,API,FS` | `EV-UI,EV-API,EV-FS,EV-FACT` | `NOT_RUN` |
| F19.04 | Root保存执行真实create/write/fsync-close/rename/read/delete与可用空间检查 | `UI,API,FS,NEG` | `EV-UI,EV-API,EV-FS,EV-NEG` | `NOT_RUN` |
| F19.05 | 不支持atomic rename时阻止Readiness，不回退到不安全目标 | `API,FS,NEG` | `EV-API,EV-FS,EV-NEG` | `NOT_RUN` |
| F19.06 | Workspace/Artifact Root相互不能重叠，也不能与active Field/Shelf Target重叠 | `UI,API,FS,NEG` | `EV-UI,EV-API,EV-FS,EV-NEG` | `NOT_RUN` |
| F19.07 | 本机CPU/GPU设备只有通过真实短编码/Probe后才显示可用 | `UI,API,PROBE,NEG` | `EV-UI,EV-API,EV-MEDIA,EV-NEG` | `NOT_RUN` |
| F19.08 | 仅列出NVENC/QSV/AMF名称不能算设备可用 | `UI,API,PROBE,NEG` | `EV-UI,EV-API,EV-MEDIA,EV-NEG` | `NOT_RUN` |
| F19.09 | Beta不交付Remote Worker注册或注销；P14把Worker视为不存在 | `NOT_APPLICABLE` | `EV-AUDIT` | `NOT_APPLICABLE` |
| F19.10 | 用户可以选择“默认”Resource Operating Profile | `UI,API` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F19.11 | 用户可以选择“火力全开”；它提高eligible计算供给，但不降低验证要求 | `UI,API,E2E,PROBE,NEG` | `EV-UI,EV-API,EV-ACT,EV-MEDIA,EV-NEG` | `NOT_RUN` |
| F19.12 | 用户可以按配置时区设置每周“火力全开”时段 | `UI,API` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F19.13 | 重启后依据当前时间和Policy恢复Resource Operating Profile | `API,RECOVERY` | `EV-API,EV-FACT,EV-REC` | `NOT_RUN` |
| F19.14 | 不存在Pause或零容量Operating Profile | `UI,API,NEG,AUDIT` | `EV-UI,EV-API,EV-NEG,EV-AUDIT` | `NOT_RUN` |

### F20 — 自动运营

| Feature | 已确认用户结果 | 必须验证 | Evidence | Status |
| --- | --- | --- | --- | --- |
| F20.01 | 用户可以启用推荐“全自动”预设 | `UI,API,E2E` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F20.02 | 用户可以选择“关键步骤确认”，但不关闭其他已确认自动化 | `UI,API,E2E` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F20.03 | Setup显示派生的“全自动已就绪”，不建立跨Domain全局状态机 | `UI,API,NEG,AUDIT` | `EV-UI,EV-API,EV-NEG,EV-AUDIT` | `NOT_RUN` |
| F20.04 | 缺失Field/Shelf/Routing/Workspace/Integration要求逐项列出 | `UI,API,NEG,VISUAL` | `EV-UI,EV-API,EV-NEG` | `NOT_RUN` |
| F20.05 | 全自动无需逐步确认即可推进eligible非破坏性Formation | `E2E,MEDIA-S,RECOVERY` | `EV-ACT,EV-FACT,EV-REC` | `NOT_RUN` |
| F20.06 | 全自动只允许安全、确定性的Aftercare auto-repair | `E2E,MEDIA-S,FS,NEG` | `EV-FS,EV-ACT,EV-FACT,EV-NEG` | `NOT_RUN` |
| F20.07 | 全自动建立On-deck旧Input处理的standing authorization | `UI,API,E2E,NEG` | `EV-UI,EV-API,EV-FACT,EV-NEG` | `NOT_RUN` |
| F20.08 | 全自动永不建立破坏性Off-deck Authorization | `E2E,MEDIA-S,FS,NEG,AUDIT` | `EV-FS,EV-FACT,EV-NEG,EV-AUDIT` | `NOT_RUN` |
| F20.09 | 关闭全自动只影响未来Settlement Approval，不暂停已建立责任 | `UI,API,E2E,NEG` | `EV-UI,EV-API,EV-ACT,EV-NEG` | `NOT_RUN` |
| F20.10 | 类NAS进程中断/重启后自动恢复durable work，不要求用户点击“继续” | `E2E,MEDIA-S,FS,RECOVERY` | `EV-FS,EV-ACT,EV-FACT,EV-REC` | `NOT_RUN` |

### F21 — 运行与安全

| Feature | 已确认用户结果 | 必须验证 | Evidence | Status |
| --- | --- | --- | --- | --- |
| F21.01 | Overview系统状态严格为`尚未配置|正常运行|系统故障` | `UI,API,NEG,VISUAL` | `EV-UI,EV-API,EV-NEG` | `NOT_RUN` |
| F21.02 | Overview报告正式收藏数量，不重复计算Season/Episode | `UI,API,E2E` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F21.03 | Overview报告最近On-deck和已完成Repair结果 | `UI,API,E2E` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F21.04 | Overview报告已证明空间节省，并区分潜在节省 | `UI,API,E2E,FS` | `EV-UI,EV-API,EV-FS,EV-FACT` | `NOT_RUN` |
| F21.05 | Overview Action Center按unresolved routing、Frozen、Approval、Person和配置分组attention | `UI,API,VISUAL` | `EV-UI,EV-API,EV-FACT` | `NOT_RUN` |
| F21.06 | Overview报告近期Formation、Care和Exit结果，不暴露技术Retry次数 | `UI,API,VISUAL,NEG` | `EV-UI,EV-API,EV-FACT,EV-NEG` | `NOT_RUN` |
| F21.07 | 除公开health外，所有Admin API/UI要求有效Admin Credential/Session | `UI,API,NEG` | `EV-UI,EV-API,EV-NEG` | `NOT_RUN` |
| F21.08 | `GET /v1/health`公开，且不暴露Secret或收藏详情 | `API,NEG` | `EV-API,EV-NEG` | `NOT_RUN` |
| F21.09 | API Credential不会出现在URL、日志、HTML或浏览器localStorage | `UI,API,NEG,AUDIT` | `EV-UI,EV-API,EV-NEG,EV-AUDIT` | `NOT_RUN` |
| F21.10 | Credential轮换使旧Session/Credential revision失效且不暴露Secret | `UI,API,RECOVERY,NEG` | `EV-UI,EV-API,EV-REC,EV-NEG` | `NOT_RUN` |
| F21.11 | Advanced Diagnostics只读，不能修改Domain Fact或执行Event | `UI,API,NEG,AUDIT` | `EV-UI,EV-API,EV-NEG,EV-AUDIT` | `NOT_RUN` |
| F21.12 | 显式Clean Initialization在已授权空目标中精确建立177张clean表 | `API,FS,NEG` | `EV-API,EV-FS,EV-NEG` | `NOT_RUN` |
| F21.13 | Verified Backup记录并验证冻结Database/Package Identity | `API,FS,NEG` | `EV-API,EV-FS,EV-NEG` | `NOT_RUN` |
| F21.14 | Restore使用atomic swap/rollback，失败时保留原有效实例 | `API,FS,RECOVERY,NEG` | `EV-API,EV-FS,EV-REC,EV-NEG` | `NOT_RUN` |
| F21.15 | 关闭/刷新浏览器不会取消durable长操作 | `UI,API,E2E,RECOVERY` | `EV-UI,EV-API,EV-ACT,EV-REC` | `NOT_RUN` |

## 5. Product持有的P14场景包

这些场景包定义最低限度的端到端测试设计。P14执行线程可以把一个场景包拆成多个程序化Case，
也可以让同一份结果覆盖多个Feature，但不得删除已规定的用户旅程、业务结果或Evidence。

| 场景包 | 用户旅程与样本 | 必经检查点 | 主要Feature覆盖 |
| --- | --- | --- | --- |
| `P14-J01` | 使用一次性Root完成首次启动与配置 | Clean Init → Admin登录 → Shelf/Field/Workspace → 直连Routing → 推荐Template → 自动化Readiness → 浏览器/服务重启 | F01, F02.01–F02.11, F03.01–F03.08, F19.01–F19.06, F20.01–F20.04, F21.07–F21.15 |
| `P14-J02` | 有有效Related NFO、无Rating的直连Movie；Field与Shelf Target刻意使用同一目录 | 发现 → Triage → NFO优先Metadata → no-rating Spec → 合规直通或有界Workspace产物 → Acceptance → Off-load → On-deck → 收藏详情 → 重新观察时不重复采购Finished Goods | F02.13–F02.14, F05, F06, F07.01–F07.08, F07.11, F11.01, F11.09–F11.12, F13 |
| `P14-J03` | 使用真实TMDB与Rating的不完整/异常Movie | NFO缺口 → TMDB补齐 → Rating解析 → 媒体/空间决策 → 真实Remux/Transcode → Conformance → On-deck；保留4K/全长样本证明分辨率、音频和大小，并以sub-4K反例证明普通Scale不能满足4K | F07, F11.01–F11.15, F12.01–F12.05, F14.01, F18.01 |
| `P14-J04` | 至少两个Shelf规则、包含一个未解析样本的分拣Field | Draft → Preview → Publish → 首个命中Routing → unknown/unmatched → 一次性Shelf决策 → Routing revision变化不移动已有Own | F04, F05.05, F05.17 |
| `P14-J05` | 2–5个Episode文件及Related Materials构成的Season | Season Identity → 首批无重叠Episode交付 → 后续独立Episode交付 → 扩充同一Shelf Entry → 逐集Metadata/HEVC/空间 → 两次交付间重启 | F08, F12.06–F12.10, F13.02, F20.10 |
| `P14-J06` | JAV现代样本与旧格式/容器边界样本 | 真实JAV Provider → 必需Metadata/Artifact → 现代合规输入no-op → 旧格式Remux/Transcode → 验证HEVC/Matroska/`.mkv`/2 GiB | F09, F11.01–F11.06, F18.04 |
| `P14-J07` | 代表性Western Adult样本 | 内部Identity → 抽帧/分析/Normalize → 标题/NFO/海报 → 媒体规范化 → 验证1 GiB → 不伪造Provider Identity | F10, F11.01–F11.06, X01 |
| `P14-J08` | 使用复制的异常样本验证失败、Frozen与恢复 | Provider/Worker/文件系统中断 → 有界Retry → 进程重启 → Frozen → 用户Discard → Workspace回收 → 源文件保留并可重新进入Procurement | F02.12, F02.17, F05.11–F05.14, F06.05–F06.07, F20.10 |
| `P14-J09` | Collection Assurance、确定性修复与不可修复Attention | 展示Artifact缺失/损坏、Placement Gap、Reality不可访问 → 立即检查 → 可确定时安全修复 → 复验 → 否则Attention → Incident聚合 | F03.09–F03.10, F15 |
| `P14-J10` | 在一次性Shelf中验证重复项与破坏性Exit | Duplicate Detect → 用户保留单项/全部/白名单 → 不可变Scope → 授权前取消 → 单项与批量授权 → 高量级升级确认 → 崩溃/重启后销毁 → 最后引用Related清理 | F16, F20.08, X08–X09 |
| `P14-J11` | Field与Shelf注销 | 在途影响Preview → 注销Field但保留文件/责任 → Shelf注销强警告 → 收藏事实结束 → 精确释放Control → 物理文件不变且历史保留 | F02.15–F02.18, F03.11–F03.13, F13.12 |
| `P14-J12` | Perception与People | On-deck前后Rating/Watched → no-rating与更强Identity解析 → 直接注册Person → 有效/零人脸/多人脸Reference → NFO强/弱Candidate → 接受/忽略/Merge | F14, F17, X03–X05 |
| `P14-J13` | 可选外部Acquisition | 已配置MoviePilot搜索 → 确定性选择Candidate → Acquisition Observe/Stability/Identity/Package Verification → 单成员Workspace Import → Product链路；包含中断与Replay | F11.14, F18.03 |
| `P14-J14` | 运行、Provider与资源 | 真实连接测试、Secret掩码、CPU/GPU Probe、默认/火力全开时段、Overview/Projection、Credential轮换、Backup/Restore/Tamper/Rollback；不启动或测试Worker | F18, F19, F21, X10, X14 |
| `P14-J15` | 产品表面与架构负向审计 | 复制系统Template形成User Template并验证Draft/Preview/Revision；枚举Admin Route/UI与Runtime依赖图；尝试所有禁止输入/动作 | F06.08, F11.16, F12.11–F12.16, F17.09, F19.14, F21.11, X01–X14 |

### 5.1 必须覆盖的环境

| 环境/能力 | Release要求 |
| --- | --- |
| 本地Windows + 当前浏览器 | 必须覆盖全部Admin Web、本地文件系统、CPU FFmpeg及不适合Docker的旅程 |
| Linux/Docker | 必须通过Clean Init/Readiness、至少`J01`、一条完整真实媒体Formation/On-deck旅程、重启恢复、一条Aftercare路径和一条一次性Off-deck路径 |
| 真实TMDB | Movie/Series Beta主张的必需条件；缺失时不能完整验收Movie/Series |
| 真实JAV Provider | JAV Beta主张的必需条件；缺失时不能完整验收JAV |
| Western内部分析 | Western Adult Beta主张的必需条件 |
| MoviePilot | 对最终用户是可选Integration；为了使全矩阵最终`PASS`，P14必须配置一套真实可用服务并通过`J13` |
| Douban | 对最终用户是可选Perception来源；为了使F14.09/F18.02最终`PASS`，P14必须配置真实可用来源 |
| Emby | 对最终用户是可选Provider；为了使F18.05/F18.11/F18.12最终`PASS`，P14必须配置真实服务，同时验证ShelfDeck不拥有或配置Emby Library |
| GPU加速 | CPU路径始终必测；P14还必须使用当前可用GPU完成真实Probe与短编码，证明可用性判断 |
| Remote Worker | 不属于本次ShelfDeck Service Beta验收范围；P14不得启动、配置或依赖Worker，F18.06/F19.09固定为`NOT_APPLICABLE` |
| 生产NAS/Canary | P14禁止使用；必须等待用户后续明确授权 |

### 5.1.1 已知Beta实施遗留

| 遗留ID | 状态 | 影响Feature / 场景 | 关闭目标 |
| --- | --- | --- | --- |
| `BETA-IMPL-01` | `OPEN / P14_BLOCKING` | F10.04、F17.05–F17.09、F17.12；`P14-J07`、`P14-J12` | 把已由SSOT定义的`shared.face.embedding.compute@1`、`shared.face.cluster.compute@1`、`shared.face.reference.match@1`接入clean Helix Runtime，完成Reference Image单人脸校验与Western人脸Evidence两条真实链路 |

`BETA-IMPL-01`不是新的Business Domain、External Provider、Integration或独立部署服务。人脸推理属于
Helix Execution Foundation内置的Owner-neutral算法能力，并由唯一Composition Root装配；用户不配置
Face URL、API Key、进程地址或独立服务。它不得恢复Mirex的Python/FastAPI sidecar、`19110`端口、旧People
Store写入、旧Reference Face公开API或base64/embedding热Payload。

实施采用ShelfDeck现有Node.js技术栈：

1. 使用`onnxruntime-node`在Node.js进程内执行版本化ONNX模型，使用现有`sharp`完成图片解码、缩放、裁剪和
   5-point alignment；推理可以放入`worker_threads`，但不形成独立服务、独立部署单元或第二套Runtime。
2. 人脸检测与Embedding模型使用许可可随产品分发的版本化Model Pack；Beta基线优先评估
   OpenCV Zoo YuNet（Face Detection）+ SFace（Face Recognition），不得继续把Mirex自动下载的
   InsightFace `buffalo_l`作为可发布Beta默认模型。
3. Model Pack由Execution Foundation现有Artifact/配置边界下的内部model loader按
   `modelRef + version + SHA-256 + license manifest`加载，保存在ShelfDeck data root下的模型缓存；不新增
   Model Registry业务组件或关系表。模型可以由安装包携带或由ShelfDeck首次使用时自动取得，但不是用户配置的
   Provider。模型缺失、摘要错误或加载失败必须形成明确Capability不可用结果，不得静默换模型。
4. `shared.face.embedding.compute@1`从正式`ArtifactHandle`读取图片，把向量集合写入受管Artifact并只返回
   `FaceEmbeddingSetHandle`；`cluster`同样传Handle；`reference.match`只读取冻结的
   `PersonReferenceProjection`并产生Evidence。不得把向量数组塞回Workflow热Payload。
5. Reference Image链固定为
   `reference_asset.import → embedding.compute(single_reference_face) → exactly-one-face verify →
   reference_fact.commit`；零脸、多脸、模型或Artifact fence错误均不得形成部分Reference Fact。
6. Western链固定为
   `frames.extract → embedding.compute → cluster.compute → reference.match → Libra Media-Cast Evidence`；
   Shared Face Runtime不得注册Person，也不得提交或改写Media-Cast Fact。

允许复用的Mirex资产仅限：SCRFD/ArcFace时期已经验证过的预处理、5-point alignment、NMS、向量归一化、
cosine similarity、聚类规则、模型缓存及故障反例的算法知识。Python服务、HTTP协议、supervisor、旧端口、
旧配置和跨Owner写入全部不迁移。若旧算法无法直接适配YuNet/SFace输出，应按clean Capability重新实现，
而不是保留双技术栈或兼容路径。

关闭`BETA-IMPL-01`必须同时满足：

- Windows与Linux/Docker均不安装或启动Python/FastAPI人脸服务，且不存在可访问的独立Face HTTP端点；
- 单脸Reference Image成功，零脸和多脸稳定失败；进程在import、推理、Artifact写入和commit各边界崩溃后
  均无部分Fact且可恢复；
- Western短切片完成真实抽帧、Embedding、聚类和Reference匹配；伪造Model/Artifact/Handle摘要稳定拒绝；
- Model Pack固定来源、版本、SHA-256和许可清单，模型缓存重启可复用，摘要损坏时拒绝运行；
- Architecture dependency audit证明Shared Face Runtime不写People/Libra Store，不建立隐藏Provider、
  独立服务或旧Runtime fallback；
- 受影响Feature由P14取得真实`EV-MEDIA/EV-FS/EV-FACT/EV-NEG/EV-REC/EV-AUDIT`后才能标记`PASS`。

### 5.2 样本层级的使用

- 当断言不涉及时长或绝对字节数时，`functional_slice`适用于所有有界Formation、Metadata、Workspace、
  文件系统Effect、Routing、UI、Crash、Replay和Idempotency旅程。
- F07.09、F08.10、F09.09、F10.09、F11.06–F11.08及F12.01–F12.10的代表性物理执行必须使用`full_length`。
- F12的所有数值在不可变Spec/Decision层完整验证；物理执行可复用J03–J06中的代表性边界样本，
  不要求重复执行十次全长Transcode。
- 如果stream-copy切片改变了要验证的Container/Stream语义，它不能证明相应边界；必须使用保留的全长父样本，
  或明确报告Residual Risk。

## 6. Beta排除项与负向验收

| 排除项 | 必须得到的负向结果 | 验证方式 | Evidence | Status |
| --- | --- | --- | --- | --- |
| X01 Homemade | 不暴露`homemade` Content Profile、样本、规则或常规UI旅程 | `UI,API,NEG,AUDIT` | `EV-UI,EV-API,EV-NEG,EV-AUDIT` | `NOT_RUN` |
| X02 AI Upscale | 不存在AI Upscale Integration、Capability、设置或借此通过验收的4K路径 | `UI,API,NEG,AUDIT` | `EV-UI,EV-API,EV-NEG,EV-AUDIT` | `NOT_RUN` |
| X03 在线搜索Person图片 | People UI只提供本地Reference Image上传，不提供网络图片搜索 | `UI,API,NEG,AUDIT` | `EV-UI,EV-API,EV-NEG,EV-AUDIT` | `NOT_RUN` |
| X04 多用户/RBAC | 产品只有一个Admin Owner，不提供家庭成员、只读或Shelf角色模型 | `UI,API,NEG,AUDIT` | `EV-UI,EV-API,EV-NEG,EV-AUDIT` | `NOT_RUN` |
| X05 Shelf Standard中的Person Preference | Template Schema/UI拒绝Person Preference条件 | `UI,API,NEG` | `EV-UI,EV-API,EV-NEG` | `NOT_RUN` |
| X06 手动控制生产手段 | 不向用户暴露FFmpeg参数、Bitrate、Flow、Gate、Capability或Task控制 | `UI,API,NEG,AUDIT` | `EV-UI,EV-API,EV-NEG,EV-AUDIT` | `NOT_RUN` |
| X07 业务Pause | 不存在暂停Field/Shelf/Run/System、零容量模式或清空队列命令 | `UI,API,NEG,AUDIT` | `EV-UI,EV-API,EV-NEG,EV-AUDIT` | `NOT_RUN` |
| X08 自动Off-deck授权 | 任何Policy/Automation路径都不能在缺少用户明确动作时签发破坏性Authorization | `E2E,NEG,AUDIT` | `EV-FACT,EV-NEG,EV-AUDIT` | `NOT_RUN` |
| X09 自动选择重复项赢家 | 系统不推荐也不自动选择应保留的重复版本 | `UI,API,NEG,AUDIT` | `EV-UI,EV-API,EV-NEG,EV-AUDIT` | `NOT_RUN` |
| X10 Emby Library配置 | ShelfDeck不创建/修改Emby Library，也不要求Library Mapping | `UI,API,PROVIDER,NEG,AUDIT` | `EV-UI,EV-API,EV-PROVIDER,EV-NEG,EV-AUDIT` | `NOT_RUN` |
| X11 旧架构兼容 | 不存在可达的Kairox/Mirex dual-read/write/run、fallback或compatibility入口 | `API,NEG,AUDIT` | `EV-API,EV-NEG,EV-AUDIT` | `NOT_RUN` |
| X12 media-desktop | Electron Desktop不属于本次ShelfDeck Service Beta；P14不构建、不启动、不测试，后续可在Service完成后重建 | `AUDIT` | `EV-AUDIT` | `NOT_RUN` |
| X13 生产部署 | P14不执行NAS部署、Canary或任何生产变更 | `FS,NEG,AUDIT` | `EV-FS,EV-NEG,EV-AUDIT` | `NOT_RUN` |
| X14 media-worker | Worker视为不存在；P14不构建、不启动、不配置、不调用，ShelfDeck Service的Beta结果不得依赖Worker可用性 | `API,E2E,NEG,AUDIT` | `EV-API,EV-NEG,EV-AUDIT` | `NOT_RUN` |

## 7. P14执行协议

1. 测试线程复制冻结矩阵，只更新`Status`、Evidence链接、已测Commit/环境与Residual Risk，
   不得改写已确认业务结果或必需验证方式。
2. 对Formation、Metadata、Workspace、文件Effect、Restart、Replay和Idempotency，默认使用`functional_slice`。
3. 绝对max-size、质量保留、真实吞吐/资源使用、长时Timeout/Recovery和空间预算Evidence必须使用`full_length`。
4. 缺少Credential或可用服务时，真实Provider条目保持`CONDITIONAL`或`NOT_RUN`；Mock只能补充，不能替代`PROVIDER`。
5. UI Feature必须具备公开Facade/API结果，并在指定时附浏览器交互或Visual Evidence。
6. 一个场景可以证明多条Feature，但每一行必须反向链接到精确Evidence。
7. P14只能修复测试Harness、Fixture与一次性Environment，不修改产品实现。
8. 产品实现缺陷以有界Defect Packet返回Architecture / Product，由既有P2–P13实现线程修复；
   修复Commit经边界复核后再交P14复测。
9. 真正涉及Domain/Owner/Handoff或用户可见语义的矛盾返回Architecture / Product；
   只有改变产品意图时才提交用户决策。
10. P14关闭时分别报告Feature与排除项的总数及各Status数量。
11. 本轮目标要求最终`BLOCKED=0`、`CONDITIONAL=0`、`NOT_RUN=0`、`NOT_APPLICABLE=0`；否则不得建议Beta Release Candidate。

## 8. 独立Product验收

P14完成首轮执行后，Architecture / Product独立执行：

1. 核对全部271条Feature与`X01`–`X14`均存在；
2. 质疑Evidence证明的究竟是用户可见结果，还是仅证明内部机制运行；
3. 抽查重放关键Formation、On-deck、Recovery、Aftercare及破坏性Exit Evidence；
4. 依据规定样本层级检查Movie、Season、JAV和Western Adult覆盖；
5. 验证UI、API、Projection与物理现实相互一致；
6. 逐项审阅`CONDITIONAL`、`BLOCKED`、`NOT_RUN`与Residual Risk；
7. 向用户提交最终Beta Release Candidate建议。
