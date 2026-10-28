# 当前 Phase 4：BUFFALO-VIDEO-IDENTIFICATION

更新：2026-10-29。状态：已按用户最新优先级激活，当前为详细设计/资格准备，尚未新增本Phase代码或生产操作。Phase 1有限技术资格已Exit，固定提交125229556及[Evidence](evidence/BUFFALO_CATALOGUE_FEASIBILITY_20261029.md)可复验。唯一[Master Plan](../CURRENT_PLAN.md)顺序为1→4→5→2→3→6；不改阶段编号、不创建第二个活动包。

## 本轮优先Outcome

先完成真实视频识别，再立即接Phase 5人物复用/自动建档和出演确认。共同终点是“真实影片→可靠选定一位演员→完整人物→正式出演→生产→Arca唯一Commit”，演员/NFO/海报一致。不能仅凭图片姓名、一个聚类或中间Choice就称整项核心功能完成。

本Phase交付视频读取/抽样/特征/分组/目录和本地Reference检索及Libra单演员选择资格，不写People Person，不提前接自动注册；后者由Phase 5完成并真实入藏验证。真实演员准确性、自动归属和人工兜底分别验收，不能用Phase 1技术一致性代替。

## 已确定合同与Owner

- Linux Docker内置能力，无Worker、独立Sense/Stash/Python服务；Mirex不作为设计/实现来源。方法基于固定Sense 2及Phase 1已资格的Node实现。
- 全部模型计算统一buffalo_l；主目录检索与自建Reference备用用同一特征体系，不保留SFace备用，不混用原128维特征。
- 一部影片一位演员；A/B均可靠识别时可选其中一位，不扩展多演员关系。频次是抽样覆盖，不能直接解释为主演或女优性别；不使用视觉性别预测。
- Libra拥有冻结的影片/材料/采样策略及单演员决定；共享计算只给技术分组/特征/候选；People拥有Person/Reference准备与发布；Arca拥有正式入藏和库存纠错。外来目录不是People Registry，内部personId保持。
- 物理读取只经当前Owner的Read Handle及源身份校验；不整片上传/复制，不增加任意视频URL服务。Frame/Embedding/Cluster/代表图使用现有Workspace/Artifact/Effect及取消围栏，不能把帧字节塞进业务Result。

## 首先冻结的设计与待定项

下列数字/筛选细节仍是提议，按实际视频与用户决定冻结后才进入正式策略；不能把本包激活当作已经确认：

| 项目 | 提议/要求 | 冻结前需要的证据或决定 |
| --- | --- | --- |
| 有界抽样 | 首批约20个跨时间点，必要时补最多20个未采点；输入前seek，不随片长线性扫描，短片去重。 | 实际视频中抽样足够性、失败与部分完成语义、读取量/时限/并发/空间；新Sampling/Model Ref及typed输入闭合，禁止旧Run兼容分支。 |
| 分组和代表脸 | 复用已生成512维特征，确定性分组；按独立时间区段计数，重复截图不加票；每组少量清晰/多角度代表脸。 | 同人不同角度、相似不同人、A+B同框、近邻burst与片头重复、组污染负例；不能靠相同候选姓名合并未知脸。 |
| 名字与选择 | 全库检索后按人物资料/资格和覆盖选一位；身份歧义与多个已确认女优均可分开。 | 男优更常出镜、姓名候选相近、目录gender缺失/冲突的明确处置。Phase 1已证明目录超过一半缺gender，不能假定字段齐全或用TPDB反复试名替代决定。 |
| 坐标/代表图 | 原帧、校正画布、脸框、代表图及embedding必须连续绑定；提供People可验证的单脸原始来源。 | Phase 1旋转框属于校正画布；正式提取须验证变换/裁剪Artifact，不能用原帧坐标直接套用。 |
| 缓存与资源 | 复用模型/只读索引及同一资格图像结果，绑定模型/数据generation；沿Runtime既有Permit和停止屏障，不能组件私藏队列。 | Phase 1仅证明单图隔离进程；真实视频/整机共载、冷/热、mmap与RSS口径、超时/取消/停止及回收实测后确定预算。 |

## 实施与资格工作项

| 工作项 | 范围 | 验收门槛 |
| --- | --- | --- |
| BUFFALO-VIDEO-CONTRACT | 先对照SSOT及现有正式Frame/Embedding/Cluster/Analysis Basis，冻结技术输入输出、策略版本、坐标/来源、资源及失败语义。 | 不跨Owner，不暗中确定未决业务规则；现有Source/Workspace/Model/Artifact/Spec/digest/fence保护不弱化。 |
| BUFFALO-VIDEO-PIPELINE | 将已资格的模型/目录方法接入真实受控抽帧与分组、补采/代表图和进度，保持结果可恢复。 | 独立真实视频有界执行，零整片上传/全片扫描退化；失败/取消/预算耗尽不伪装无脸或无匹配。 |
| BUFFALO-SINGLE-ACTOR | Libra根据真实候选和已确认策略产生单演员识别依据，本地Reference备用亦用buffalo_l。 | 女优A/B、男优占主导、模糊/侧脸、无脸、库无匹配、歧义、缺性别分别验证；无合格结果进入原人工路径，人工先行不被迟到自动结果覆盖。 |
| BUFFALO-RESOURCE-AND-DATA | 有版本模型/目录、缓存/暂存清理、任务上限及停止/重启/迟到结果门禁。 | 实际Linux视频冷/热/1080/4K/SMB及与正常工作共载的CPU/内存/字节/延迟；更新不能混读generation或重判已有演员。4K识别验证不扩展为转码吞吐修复。 |
| BUFFALO-VIDEO-EXIT | 固定源码/配置/数据/样本，完整正反例与适用UI验证，反向审计及冻结包。 | 以真实视频证据退出，Phase 1原图和静态双人拼图不代替；随后立即接Phase 5，不切回Phase 2。 |

## Phase 5接续准备（仅依赖接口，不提前实施）

Phase 4应提供绑定材料/帧/模型/目录/策略的识别候选及代表图来源。Phase 5由People唯一复用或TPDB补充/截图兜底建档，再由Libra消费完整Person/Reference快照确认出演；保留原人工建档/影片选择、并发幂等和人工作主。TPDB ID不作为人物主键或建档必需条件，不循环匹配新Reference来证明刚才姓名。模型/Reference正式更新、旧Evidence只读保留和推荐认领退役责任与入藏旅程都在Phase 5闭合。

## 保护、授权和当前事实

Phase 2已有修复、Phase 3未提交Run接续文件和既有资格均保留，暂不继续其实现、不记完成。原Phase 2待开始包冻结在[重排检查点](evidence/ROUND_REPLAN_BASELINE_20261029.md)，不构成另一个活动计划。

仅自用NAS，不对外分发模型/数据。当前不部署、重试、取消、Reset、改库/人物/Reference或媒体，不启停生产/原Sense服务，不恢复自动观察。必要隔离测试按精确目录、只读输入、容量/资源预检及任务专属进程执行；SSH使用tools/nas-ssh-config.js，凭据不输出。

当前只完成优先级与执行包调整；没有新增视频资格或自动建档/出演结果。Phase 4首项是合同及真实视频验收准备，未决选择策略依SSOT先确认；Phase 6最终整合/镜像/完整架构及具体版本UI/生产门禁保持。
