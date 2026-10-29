# 当前 Phase 4：BUFFALO-VIDEO-IDENTIFICATION

更新：2026-10-29。状态：技术切片和真实视频隔离资格进行中，未开放自动出演或变更生产。Phase 1有限技术资格已Exit，固定提交125229556及[Evidence](evidence/BUFFALO_CATALOGUE_FEASIBILITY_20261029.md)可复验。唯一[Master Plan](../CURRENT_PLAN.md)顺序为1→4→5→2→3→6；不改阶段编号、不创建第二个活动包。

最新检查点：已完成新typed Catalogue Basis、Service内置数值/CPU隔离/目录查询与代表图模块，qualification入口复用正式模块；尚未接通正式Work和Artifact持久化。contract-6 Linux54 PASS/0skip；4组目录有序身份与固定参考一致。contract-3四张代表图（含旋转）可独立检出单脸，记录紧框首败后采用显式1/4留边策略。目录代际冻结manifest及7成员/512维特征空间，实际2,715,402,822 bytes验真；检索与Libra身份资格分开。静态合同/P2从排除原Phase 3未提交文件的源码快照通过，资源共载/正式Host及Phase Exit仍未通过，详见本包[Evidence](evidence/BUFFALO_VIDEO_QUALIFICATION_20261029.md)。

## 本轮优先Outcome

先完成真实视频识别，再立即接Phase 5人物复用/自动建档和出演确认。共同终点是“真实影片→可靠选定一位演员→完整人物→正式出演→生产→Arca唯一Commit”，演员/NFO/海报一致。不能仅凭图片姓名、一个聚类或中间Choice就称整项核心功能完成。

本Phase交付视频读取/抽样/特征/分组/目录和本地Reference检索及Libra单演员选择资格，不写People Person，不提前接自动注册；后者由Phase 5完成并真实入藏验证。真实演员准确性、自动归属和人工兜底分别验收，不能用Phase 1技术一致性代替。

## 已确定合同与Owner

- Linux Docker内置能力，无Worker、独立Sense/Stash/Python服务；Mirex不作为设计/实现来源。方法基于固定Sense 2及Phase 1已资格的Node实现。
- 全部模型计算统一buffalo_l；主目录检索与自建Reference备用用同一特征体系，不保留SFace备用，不混用原128维特征。
- 一部影片一位演员；A/B均可靠识别时可选其中一位，不扩展多演员关系。2026-10-29用户取消性别条件：不预测、不按gender筛选/加减分/分流，缺失或冲突不单独产生人工待决，男性也可被选中；仍按身份可靠性和独立时间覆盖判断，不把频次解释为已证明主演。
- Libra拥有冻结的影片/材料/采样策略及单演员决定；共享计算只给技术分组/特征/候选；People拥有Person/Reference准备与发布；Arca拥有正式入藏和库存纠错。外来目录不是People Registry，内部personId保持。
- 物理读取只经当前Owner的Read Handle及源身份校验；不整片上传/复制，不增加任意视频URL服务。Frame/Embedding/Cluster/代表图使用现有Workspace/Artifact/Effect及取消围栏，不能把帧字节塞进业务Result。

## 首先冻结的设计与待定项

性别条件已按用户决定取消。下列采样/数值细节仍须根据实际视频冻结后才进入正式策略；不能把本包激活当作已经完成资格：

| 项目 | 提议/要求 | 冻结前需要的证据或决定 |
| --- | --- | --- |
| 有界抽样 | 首批约20个跨时间点，必要时补最多20个未采点；输入前seek，不随片长线性扫描，短片去重。 | 实际视频中抽样足够性、失败与部分完成语义、读取量/时限/并发/空间；新Sampling/Model Ref及typed输入闭合，禁止旧Run兼容分支。 |
| 分组和代表脸 | 复用已生成512维特征，确定性分组；按独立时间区段计数，重复截图不加票；每组少量清晰/多角度代表脸。 | 同人不同角度、相似不同人、A+B同框、近邻burst与片头重复、组污染负例；不能靠相同候选姓名合并未知脸。 |
| 名字与选择 | 全库检索后按身份可靠性和独立时间覆盖选一位，不分性别；身份歧义与多个可靠演员分别处理。 | 姓名候选相近、同框不同人、弱匹配与局部重复不能形成虚假资格；gender值变化/缺失/冲突不得改变排序或触发人工。不得用TPDB反复试名替代决定。 |
| 坐标/代表图 | 原帧、校正画布、脸框、代表图及embedding必须连续绑定；提供People可验证的单脸原始来源。 | Phase 1旋转框属于校正画布；正式提取须验证变换/裁剪Artifact，不能用原帧坐标直接套用。 |
| 缓存与资源 | 复用模型/只读索引及同一资格图像结果，绑定模型/数据generation；沿Runtime既有Permit和停止屏障，不能组件私藏队列。 | Phase 1仅证明单图隔离进程；真实视频/整机共载、冷/热、mmap与RSS口径、超时/取消/停止及回收实测后确定预算。 |

## 实施与资格工作项

| 工作项 | 范围 | 验收门槛 |
| --- | --- | --- |
| BUFFALO-VIDEO-CONTRACT | 先对照SSOT及现有正式Frame/Embedding/Cluster/Analysis Basis，冻结技术输入输出、策略版本、坐标/来源、资源及失败语义。 | 不跨Owner，不暗中确定未决业务规则；现有Source/Workspace/Model/Artifact/Spec/digest/fence保护不弱化。 |
| BUFFALO-VIDEO-PIPELINE | 将已资格的模型/目录方法接入真实受控抽帧与分组、补采/代表图和进度，保持结果可恢复。 | 独立真实视频有界执行，零整片上传/全片扫描退化；失败/取消/预算耗尽不伪装无脸或无匹配。 |
| BUFFALO-SINGLE-ACTOR | Libra根据真实候选和已确认策略产生单演员识别依据，本地Reference备用亦用buffalo_l。 | 多演员A/B、男性覆盖更多、gender任意/缺失/冲突不影响资格、模糊/侧脸、无脸、库无匹配、身份歧义分别验证；无合格结果进入原人工路径，人工先行不被迟到自动结果覆盖。 |
| BUFFALO-RESOURCE-AND-DATA | 有版本模型/目录、缓存/暂存清理、任务上限及停止/重启/迟到结果门禁。 | 实际Linux视频冷/热/1080/4K/SMB及与正常工作共载的CPU/内存/字节/延迟；更新不能混读generation或重判已有演员。4K识别验证不扩展为转码吞吐修复。 |
| BUFFALO-VIDEO-EXIT | 固定源码/配置/数据/样本，完整正反例与适用UI验证，反向审计及冻结包。 | 以真实视频证据退出，Phase 1原图和静态双人拼图不代替；随后立即接Phase 5，不切回Phase 2。 |

## Phase 5接续准备（仅依赖接口，不提前实施）

Phase 4应提供绑定材料/帧/模型/目录/策略的识别候选及代表图来源。Phase 5由People唯一复用或TPDB补充/截图兜底建档，再由Libra消费完整Person/Reference快照确认出演；保留原人工建档/影片选择、并发幂等和人工作主。TPDB ID不作为人物主键或建档必需条件，不循环匹配新Reference来证明刚才姓名。模型/Reference正式更新、旧Evidence只读保留和推荐认领退役责任与入藏旅程都在Phase 5闭合。

## 保护、授权和当前事实

Phase 2已有修复、Phase 3未提交Run接续文件和既有资格均保留，暂不继续其实现、不记完成。原Phase 2待开始包冻结在[重排检查点](evidence/ROUND_REPLAN_BASELINE_20261029.md)，不构成另一个活动计划。

仅自用NAS，不对外分发模型/数据。当前不部署、重试、取消、Reset、改库/人物/Reference或媒体，不启停生产/原Sense服务，不恢复自动观察。必要隔离测试按精确目录、只读输入、容量/资源预检及任务专属进程执行；SSH使用tools/nas-ssh-config.js，凭据不输出。

2026-10-29技术切片：已增加有界20+20抽样提议、带同框排斥/组内距离保护的质心分组、时间区段去重、最多三张代表脸及显式目录链接身份汇总；姓名相同不合并，gender冲突保留。Service既有Read Handle/Source校验下增加显式采样点与流式sink，旧正式20帧入口保持原策略；输入前seek并限制解码线程，取消或失败不返回部分成功。模型/目录和新视频Evidence仍是qualification代码，正式Runtime依然为旧模型，不能称已经切换或完成Phase 4。

实际Linux首轮数学/边界15项、最终补充13项（含真实FFmpeg取消/来源改变/停止屏障、4K良性合成解码与目录身份链接）通过；三部影片只读首采共60帧/84检测完成，新代码12组分组网格逐项重放一致，新视频Evidence路径对固定Sense的3原图/1旋转图数值及有序身份对照通过。双女演员样本同时得到与原片名相符的两位女性候选和距离更低的男性候选，不能直接取单脸最高分；另一部目录别名覆盖原片名。第一部片名/旧演员/新候选互相不一致，缺独立真值保留未决，不宣称准确率。1CPU每部首采158–289s，父HTTP探针7273次/0错误/最慢93ms；cgroup触及2GiB上限、max事件4348、无OOM，资源资格仍待。详见[首轮视频Evidence](evidence/BUFFALO_VIDEO_QUALIFICATION_20261029.md)。

首次Inventory TEXT版本比较失败和新增测试挂载被只读父目录拒绝均保留；输入转换及隔离挂载修正后复验，不放宽身份/产品断言。三条Inventory/收藏保护字段及2模型/7目录SHA保持，生产容器身份/StartedAt不变，全部本任务容器已退出。2026-10-29用户明确否决FEMALE-only提议，取消全部性别筛选和分流；该项已定，不再等待确认。当前不能开放自动出演的剩余原因是正式执行链/资源/识别资格尚未完成。原来的常规单图资格不被这里的小样本替代或扩张。

尚缺正式typed Basis/策略/Artifact与资源接线、补采、真值充分的独立视频识别和4K/冷启动/完整停止恢复资格；Phase 5人物发布和唯一Commit未开始。Phase 6最终整合/镜像/完整架构及具体版本UI/生产门禁保持；本次没有增加CUDA、生产处置或自动观察。

上段为首轮检查点：typed Catalogue Basis与显式策略现已新增，后续缺口为其Store/正式Work/Artifact/Runtime Permit接线、20+20补采与恢复及业务/资源资格；不能因纯模块已迁入Service就提前开启自动人物处理。原128维正式链尚未切换，Phase 5仍需统一Reference及本地备用，不允许新增SFace运行备用或未入藏旧Run兼容。

取消性别条件后的增量：Libra私有`us-adult-catalogue-assessment`按显式冻结的距离/候选差距、独立代表及时间覆盖参数形成候选评估，完全不读取gender作决定；技术候选不等于Person、ActorChoice或Cast。资格不够、无脸、无匹配及身份歧义分开，重复截图不充当独立证据，同一组强身份冲突或同框两脸归同UID不能被高分掩盖。最新assessment-2实际Linux 10 PASS / 0 skip，三部已有Evidence的12组网格与60次gender值/缺失/冲突变更重放全部通过。参数0.5/0.05/2代表区段/3覆盖区段仅为明确的实验Fixture，不是生产校准默认值。私有模型尚未接正式Work/typed Observation，Phase 4仍开放。
