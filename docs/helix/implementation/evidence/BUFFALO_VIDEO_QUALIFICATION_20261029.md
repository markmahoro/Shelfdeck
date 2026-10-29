# BUFFALO-VIDEO-IDENTIFICATION：首轮视频技术证据

日期：2026-10-29（Asia/Shanghai）。这是当前Phase 4的Evidence，不是第二个活动计划。主路线仍为Phase 1→4→5→2→3→6。

后续用户决定（2026-10-29）：取消所有性别筛选和分流，可靠候选不分男女；性别缺失/冲突也不单独要求人工。下文“性别规则待确认”和FEMALE-only提议属于首轮时点记录，已被本决定取代。男性得到更低距离仅是观察，不再构成排除理由；多帧身份可靠性、资源及正式接线仍须验证。原始报告与首跑失败保持不变。

## 结论与边界

三部现有真实影片各20帧首采完成，共60帧、84个人脸检测；固定buffalo_l/官方目录可在ShelfDeck现有Node/Linux Docker边界内处理视频帧。双女演员影片得到与保留原片名相符的Valentina Nappi和Cherry Kiss候选；另一影片的Layla Price候选，其目录别名明确包含原片名的Laela Pryce。它们是有来源的候选一致性证据，不是独立标注集准确率。

**Phase 4尚未Exit。** 正式Runtime仍使用旧模型，本次没有接自动出演、People注册、Reference发布或Arca Commit。自动演员性别规则仍待用户确认；三部首采不能证明所有影片/主演选择正确。第一部的保留原片名指向Tia Tanaka，现有收藏演员为Skin Diamond，新目录首候选主要是Tina Fire/May Thai，缺独立真值，保持未决，不把其中任何一个当正确答案，也没有改旧收藏。

## 固定方法与实现

- 模型/数据/依赖沿用Phase 1：Sense commit `7a690aa80c390a69d64934c6201076ae05f94e59`，目录2026.10.09，SCRFD det_10g + w600k_r50，Node20.20.2 / ORT1.30.0 / sharp0.35.2 / better-sqlite3 12.11.1 / USearch2.25.3。两个模型及七个目录成员最终SHA与Phase 1一致。
- `video-evidence.js`是实验技术模型：5%–95%区间的20个首采点及最多20个不重复补采点；本次真实影片仅执行首采。确定性最近质心分组增加同框排斥、组内成对距离约束及近似等距歧义分离，防止桥接污染；不同阈值并非单调得到更少组。阈值0.35/0.45/0.55/0.6是首次真实视频前固定的比较网格，未选为正式自动出演阈值。
- 时间区段及重复编码图去重，不将补采或重复截图直接加票。每组最多三张不同图像/时间区段的代表脸；按预先生成的特征和目录查询结果汇总候选。明确目录链接形成技术身份，姓名相同不合并。gender缺失/冲突原样保留，没有视觉性别预测或人物Merge。
- 上游`face_config.py`明确注明部分距离阈值沿旧模型保留、尚未为buffalo_l重新校准。因此目录返回距离、代表数和覆盖不叫概率或准确率，不能直接继承为ShelfDeck业务自动确认规则。
- Service既有`clean-us-adult-frame-extractor`新增显式、有界、唯一有序采样点及流式sink，旧`extract`仍是原20帧策略；`-ss`在`-i`之前，输入解码线程为1；保留原Source指纹/时间校验、Owner范围和FFmpeg停止注册。取消或sink失败直接失败，不返回部分成功。
- 原图SHA、校正画布RGB像素SHA、原尺寸/画布尺寸/旋转角与人脸框连续记录。框属于校正画布；不能拿它直接裁剪原帧。新`frameEvidence`沿原已资格的模型计算，没有换通道、放宽Phase 1阈值或保留SFace执行备用。
- 视频脚本从精确三条只读Arca Inventory记录及现场stat构造隔离Fixture的Physical Handle/Execution Context，复用Service文件校验；这**不是**生产Owner新签发的Read Handle、正式Work/Permit或Artifact/Effect旅程，不能称正式Host接线已通过。

## Linux运行结果

镜像`sha256:fd51005f74c069031e0e0c2fbd32fbb282ffcf61f87e1e141f5b71438a0dbf5d`。真实视频容器为1 CPU、2GiB内存与相同memory-swap上限、128 PIDs，network none、read-only root、UID1000:GID1001、无宿主端口。只读挂载精确三部影片、源码、模型/目录和Fixture；唯一可写实验目录为`/vol1/1000/docker/shelfdeck-buffalo-qualification-20261029/video-phase4`。没有挂载生产库到推理容器、Docker socket或凭据，没有整片复制/上传。

| 样本 | 已入藏Entry前缀 | 实际视频 | 首采/检测 | 校正帧 | 抽帧+识别耗时 |
| --- | --- | --- | --- | --- | --- |
| 0 | af16e70e… | HEVC / 1920×1080 / 1759.339s | 20 / 28 | 6 | 288.808s |
| 1 | 55e556c6… | HEVC / 1280×720 / 2800.764s | 20 / 21 | 2 | 158.088s |
| 2 | 1c447b83… | HEVC / 1920×1080 / 1753.965s | 20 / 35 | 9 | 285.983s |

- 全程740.791s，模型/目录加载4.548s（页缓存已热，不能称物理冷启动）。单帧推理0.848–31.985s，中位9.289s；含无脸与多次旋转校正，不能外推固定每片时延。只读媒体为现有fnOS挂载，不以此代替SMB故障/恢复资格。
- 父进程loopback HTTP探针7273次、0错误、最慢92.896ms；这是实验进程控制面响应，不能替代完整Host/业务health或正常工作共载资格。关闭内部计算槽240.197ms；没有独立计算服务、Worker域或私藏业务队列。
- 采样RSS峰值1,993,089,024B；cgroup memory.peak为2,147,487,744B，memory.events max=4348、oom/oom_kill=0。**触及2GiB内存上限，内存/文件缓存/并发预算仍需正式分析，不能据无OOM宣布内存资格完成。** RSS与cgroup口径不同，不相加，也不能当作显存需求。
- 双女演员样本中，Valentina Nappi有15张脸的首候选、Cherry Kiss有8张；男演员候选最低距离0.276，小于女性最低距离0.344。直接取全片单脸最佳距离会选中男演员，故性别与多帧资格必须由Libra明确决定。该统计不证明所有逐脸候选为真，也没有自动选演员。

## 验证与首跑保留

1. source-1实际Linux：原数学及新增逻辑共15 PASS / 0 skip；视频Fixture将Inventory的TEXT `fingerprint_version`与整数直接比较，Source围栏拒绝，0部进入推理。原日志/失败报告保留。只修实验输入的显式版本转换，未知版本继续拒绝，没有修改生产或放宽内容/物理身份判断。
2. source-2实际Linux：三部首采完成，原15项同样通过；读取前后inode/size/mtimeNs/ctimeNs/中段指纹一致，所有源输入只读。
3. checks-1：11 PASS / 0 skip，包含真实Linux FFmpeg流式输出、采样数组冻结、取消后不接纳部分成功、停止态FFmpeg拒绝、范围外时间、来源改变拒绝及分组负例。
4. checks-2首跑：新测试文件挂在只读源码父目录中不存在的路径，OCI容器创建失败，没有运行测试；保留`checks-2.log`。改为挂载完整独立测试目录，不改产品、断言或门槛。
5. checks-2b：最新13 PASS / 0 skip / 0 fail。新增显式目录链接/同名不合并，以及真实生成3840×2160 H.264→1280×720单帧/来源保护。**4K样本是良性合成解码Fixture，不是4K演员识别、HDR/HEVC或整机共载资格。**
6. 新视频Evidence路径与固定Sense oracle的三张原PNG及35°旋转PNG对照4例全部通过：原数值/有序候选门槛保持；新校正画布像素SHA、尺寸可由原PNG及变换信息重建，原图尺寸保持。没有因新增坐标元数据改变特征空间。
7. 最新分组代码在Linux对三部已完成Evidence的12组阈值网格重放，成员、代表脸、覆盖及完整候选逐项完全一致。source-2后增加的同一帧来源矛盾拒绝负例不改变这三部有效输入。
8. 本机旧Frame/Analysis定向反馈7 PASS / 2真实模型环境skip；最终含数学/新边界/旧逻辑组合为27项、23 PASS / 4环境skip。只作快速回归，不能称其他平台交付或Linux旧模型旅程通过。未跑完整Service/Web/Architecture/最终镜像/UI Gate，未改用户界面。

## 保护与可复验产物

三条当前Inventory行与初始导出完全相同；三条收藏API的身份、演员、Inventory/Deck版本、状态及媒体大小无变化。全库逐行保护不在本次范围，不能据此宣称全部历史重验。生产container ID/image/StartedAt保持Phase 1基线，Restart0/OOM=false；旧Sense实验容器仍exited，本任务运行容器已退出。两个模型/七目录成员SHA保持，未启停/部署/Reset/重试生产，未重新创建观察自动化。

NAS产物根为上面的`video-phase4`；本机ignored副本为`E:/my_project/emby_third_party-helix/.codex/buffalo-video-phase4-20261029`。原帧、向量、完整生产Projection/Inventory不入Git。

| 产物 | 字节 | SHA256 |
| --- | --- | --- |
| source-1.tar.gz（首跑失败） | 3516846 | 703d0939a7d2bb2ad37b572acd5ccac175ef668df2ea41a388d93efba1e48f06 |
| source-2.tar.gz（实际视频） | 3516959 | 8e29b3edb2c00276a27215aeb6d917c607c0f3c90c9782820f3c6cda9607956e |
| checks-2.tar.gz | 6705 | 16bfdf6a99e9a4b3a605a0e23bcd6f2a91bfb9667d3bbd42b84d420d89af2cfe |
| metadata-2.tar.gz（最新图片/分组代码） | 27104 | fdb3877e34a8a12da26325fb36911167addb2fcf94c91dda663ba4ba2c37d01c |
| run-2/video-report.json | 1144868 | 12e59a68240d38595ad1455fda6db22baaff6e1857ae9d2c87515cade1972dc7 |
| video-image-parity.json | 1399 | 125ee3dd8a7d638fb668f01179183f1940fe13425c2e164efa662b71a4a2e977 |
| current-code-replay.log | 59 | 8f355d1b1cd8746be0a2420820a6597995dcc2486e81eddaba66f87374402048 |
| final-protection.log | 1523 | ee09720c2506fa2947411b3069ac4f878d90a4073a3fe4e0ad643ef429d04330 |

## 首轮开放门槛（历史时点）

待确认FEMALE-only自动候选、明确MALE排除、未知/冲突/其他标记转原人工流程的业务规则；本次没有擅自确定。还需正式typed Basis/目录与模型generation/Artifact/Effect/Runtime Permit接线、补采与代表单脸图片发布、真值充分的独立视频/无匹配/人工作主、物理冷启动/真实4K/资源共载及重启恢复。之后才能退出Phase 4并进入Phase 5人物完整发布和唯一Commit，不能由本Evidence提前宣布核心功能完成。

## 用户取消性别条件后的验证

用户明确取消性别判断，SSOT及唯一Phase已同步；FEMALE-only提议与上述性别待确认门槛退役，不再请求用户选择。外来gender字段可保留原始Evidence，但不参与资格、排序或人工分流；本地Reference备用也遵循相同规则。既有报告不改写，男性较低距离现在只是正常候选事实，不能据此说算法选错性别。

新增Libra私有`us-adult-catalogue-assessment.js`只形成候选评估，不写任何Owner Store，不产生Person、ActorChoice、Cast或Work。它按显式完整、带digest的实验策略验证代表图/区段独立性、候选身份差距与一致性，按跨时间覆盖优先稳定选一个候选；不同可靠演员并存不当作同一人的身份歧义。原输入错误、单图重复票、组内身份矛盾、同框多脸同UID仍分别拒绝或保留未决。已有演员选择及人工优先权未改，正式typed Observation/自动出演接线仍开放。

- assessment-1实际Linux 10 PASS / 0 skip；补齐姓名/UID/观测总数、帧key规范及覆盖上界后，最新assessment-2同样10 PASS / 0 skip / 0 fail。包括男性可被选中，任意gender/缺失/冲突不改变完整评估，输入乱序不变，强身份矛盾/同框非代表成员不被掩盖，冻结策略漂移、错误来源与超长姓名拒绝，结果不可变。
- 对三部旧Evidence的12组网格，各做五种gender变化重放，共60次；评估连digest都保持一致。全部评估在隔离容器完成，不挂生产库/媒体/模型，不访问外网。没有重跑媒体推理或修改原报告。
- 实验策略显式取最大距离0.5、不同身份差距0.05、至少2个独立代表区段、至少3个覆盖区段；**这些是Fixture数值，不是经过准确率验收的生产默认值**，模型不提供隐式默认策略。12组中若干证据不足，另若干返回Tina Fire、Layla Price、Valentina Nappi或Cherry Kiss内部候选；第一部真值仍未决，不能把`qualified_candidate`当作已证明正确身份、已建档或已确认出演。
- 运行镜像仍为首轮相同固定SHA，0.5CPU/256MiB、network none、read-only root、无宿主端口；任务容器结束。生产container/image/StartedAt/Restart0/OOM=false保持，原Sense仍exited；未部署或改变生产责任。

| 新增产物 | 字节 | SHA256 |
| --- | --- | --- |
| assessment-1.tar.gz | 5688 | f0d51003e912e261ee2c778a29fc8104e120cac9f61079fb2fe6df2a50ddbb37 |
| assessment-2.tar.gz（最新模型/测试） | 5831 | d7e15a13a35b121eeef86fea1f8b51e42735a95988d580499173afc26fbaf797 |
| assessment-2/actor-assessment.json | 5613 | 1e4a654d68b777cd8d716969e222d6e4904641c40dec00441fb9a162574e59d2 |
| assessment-2.log | 3438 | 40eb70a1dc984de0497486fc2646095398aff492cf1331d76b4b9c038ae36495 |

目录/策略/Artifact与正式Work接线、补采、代表图、准确率与资源/恢复资格仍按唯一Phase推进；本段不是Phase Exit，也不继承为完整Host或具体版本UI验收。

## 2026-10-29：正式合同和内置CPU模块切片

本次将已资格的数值/图片/分组实现迁入Service，qualification wrappers复用这些实现；正式Runtime composition未改，原128维链尚未切换。新增`FaceCatalogueGeneration`和`UsAdultCatalogueAnalysisBasis`，新Basis绑定当前Run/唯一Primary及成功Probe、512维Model Ref、数据代际、显式检索/采样/分组/代表图/Libra身份策略及资源预算。主目录路不冻结People全库，不产生Person、ActorChoice或Cast。USearch固定2.25.3及既有相同完整性，已进入Service依赖lock；不把模型/第三方数据库装入对外镜像。

目录验证逐块校验manifest与七成员SHA/大小，拒绝链接、替换、读取中变化、超时和取消；查询前后核对同一代际文件身份。代际必须独立目录发布，不原地覆盖。内置CPU线程只接受一个操作，第二个请求立即busy；超时/取消结束线程并拒绝迟到结果，没有私有业务队列或独立服务。正式Work/Permit仍须后续接线，不能从此推导已完成Runtime资源准入。

Frame Evidence Artifact payload把原编码SHA、校正画布像素SHA/尺寸/旋转、五点/512维特征和精确脸序号连续绑定。代表图按同一画布留1/4脸框边距，PNG输出记录渲染policy/裁剪/帧/脸/特征proof；裁剪包含另一检测脸中心或剩余脸太小时明确失败。图像和向量留在技术Artifact payload，未加入业务Result或写入生产Workspace。

### 结果与适用范围

- `contract-1`：实际Linux37 PASS/0skip；迁移后的数值/图片代码对固定Sense的三原图及一旋转图再次通过，原始比对门槛未变。
- `contract-3`：实际Linux48 PASS/0skip；四张代表图各重新检出1脸。图片向量与oracle的最小cosine为0.9998701773；裁剪后与原检测特征cosine为0.9584–0.9901，这是技术连续性测量，不是身份准确率。模型加载2.177s，四图/裁剪/复检总57.660s、停止69ms。仅模型/图片进程，1CPU/1.5GiB，不包含目录索引共载。
- 正式目录代际为`280b5425debb95ec95d1cf89efa5e34428ce7643316b1a690157696038643485`；manifest+7成员共2,715,402,822 bytes，实际逐项验真约6.2–8.1s。预期SHA来自Phase 1冻结manifest，未把当前文件现算SHA直接当可信发布。
- 最新`contract-6`：实际Linux54 PASS/0skip；正式CPU目录适配器以固定代际加载并查询四组参考特征，有序UID完全一致、最大调整距离差1.1920929e-7；加载9.920s、含查询总10.779s、停止102ms。1CPU/1GiB，仅目录/元数据，无图片模型推理；不能与上条拼成完整共载资格。
- 独立暂存源码导出排除了原Phase 3未提交文件。静态合同/P2无finding，计数138 Capability/117 Result family/243表/65事务/152 Domain input，聚合摘要`1257303c07c1498bc30748827dc8e36b20874283170f64ace5002473a56b9c27`。相关逻辑/合同测试60 PASS/1 Linux-only skip，该分组线程场景已有上述Linux覆盖；这不是完整架构或最终镜像资格。新增SSOT两行引起Source Map及其下游行号/digest机械传播，未增加表/事务或DDL。

### 失败保留

1. 新DTO首轮生成器把精确七成员合同误归为任意typedParameters合同，明确列入精确合同集合后通过；没有放开通用对象约束。新Probe Fixture的`discTopology:null`不合schema，修正Fixture为实际可选字段语义，保留正式Probe/摘要/大小/视频流校验。
2. `contract-2`真实图紧框裁剪复检0脸，断言失败；保持“一张可独立检测的脸”断言，新增显式1/4留边规则后`contract-3`四图通过。没有降低检测门槛或跳过失败图。
3. `contract-4`错误假设索引向量数等于JSON键槽长度，加载拒绝；实际USearch使用稀疏稳定键，五个已声明null槽外还存在未分配键空间。修正为向量数量和键空间各自边界并增加稀疏键正例，越界/缺映射继续拒绝。
4. `contract-5`把外部目录UID与SQLite整型人物主键直接比较，查询拒绝。核对固定目录表结构及上游导出规则后，经`stashbox_ids`端点/外部ID或catalogue源+内部整型ID核对同一人物；真实不一致继续拒绝。不是按同名合并，也未把TPDB ID设为ShelfDeck personId。
5. 独立源码静态首两轮未传播Source Map/Result registry/表合同的出处行号，明确失败；完整机械生成后通过，首跑未记全绿。原Phase 3未提交增量始终保留，没有混入本次资格或提交。

### 固定产物

NAS私有实验根继续为`/vol1/1000/docker/shelfdeck-buffalo-qualification-20261029/video-phase4`，本机副本在同名`.codex/buffalo-video-phase4-20261029`；原始JSON/日志及所有失败文件留档，不提交图片/向量/数据库。对照环境继续为Phase 1固定Linux镜像和Node/ORT/sharp/USearch版本。

| 产物 | 字节 | SHA256 |
| --- | ---: | --- |
| contract-3.tar.gz（代表图复验） | 880890 | d8c23242ede1ae6427f61fc85ccff3fa351802aeba9281e15feaafe5063065e9 |
| contract-3/cpu-evidence-report.json | 5661 | 25ff2265263f18b27d4e8cdfe3c7f41e934d19c8e8f5b04513e1f225ebffffe6 |
| contract-3/catalogue-generation-report.json | 3352 | 9f4c8a5a664eb3a7d3e0a045a706dad083859c2b7f3714fafe1cc2de54bae740 |
| contract-6.tar.gz（最新目录/模块测试） | 884857 | 844243a7437fe9097f6258f6ab704b5b565799ddc1ed88d5e8d6b297990fc4f0 |
| contract-6-tests.log | 12907 | b30bc166a4363bdc99ad9b9ad2f19cae7b5e6964f9971e02135674f2feaeb75d |
| contract-6/formal-catalogue-report.json | 1215 | 4b6f8e16e002b99cfea80d99809c4eb8dfa2b4889eb2b17c1a5f4b1e5d724b36 |
| contract-2/cpu-evidence-report.json（首败） | 329 | 95f126e0419ebe9e94ec0f2c379e34f115e92e9bb53ea279656e3379b85c3fce |
| contract-4/formal-catalogue-report.json（首败） | 239 | 6ef4a66db32889da635c996ab1146449b1f2ba7755bf1105444df326b4c804a6 |
| contract-5/formal-catalogue-report.json（首败） | 559 | 2b1fc4a39ca39f6bc4b06845bbe9d5f2999e6767e31b2335f293371082aebbbe |

最终生产container/image/StartedAt与原基线一致，running/Restart0/OOM=false；Sense仍exited；本任务容器均已退出。2模型/7目录成员最终SHA与Phase 1及首轮记录一致。本次没有挂载生产DB、写People/Reference/收藏/源文件，也没有执行部署/Reset或恢复自动观察；不冒称重新逐行核验全库/全部媒体。

剩余门槛：新Basis Store、正式Work/Capability/Artifact/Effect/Permit及可恢复补采，目录/模型同进程共载和真实Host停止/重启/迟到结果，独立真值充分的视频识别/4K/SMB资格；随后Phase 5人物完整发布、Reference统一更新、单演员出演及唯一Commit。当前切片不是Phase 4 Exit或核心功能完成。

## 2026-10-29 Catalogue Basis 持久化切片

本切片属于演员线程 Phase 4；主整合职责已经由用户移交新线程“ShelfDeck 本轮整合与生产交付”（01a18642-b03d-7ba1-9215-5405de01680e）。本证据不是新活动计划，不改变独立生产补丁优先级。

- 新 Libra-owned `libra_us_adult_catalogue_bases` 每Run一份32KiB不可变Basis，独立于People Reference页面；真实UnitOfWork在首次冻结时核对active Run、精确state revision、execution basis、正式identity Fact与同Run active Workspace。相同值重放；冲突值拒绝；插入中断回滚。
- 历史读取和冻结幂等重放不授予执行资格。`readForExecution`每次重核active Run、execution basis、identity、Workspace；取消后拒绝迟到执行；priority-only revision前进不重写Basis。
- 两个独立SQLite连接/CPU测试线程实际并发竞争：同值汇合为一行，异值仅一个成功，其余明确冲突。测试线程不是产品Worker或独立调度服务。
- Fresh Reset真实保留库复制：Arca依赖闭包选择的精确Run连同Basis保留；没有收藏依赖的任务Basis从在线副本清除，源库不变，FK/integrity通过。未把整个Subject的所有旧Run当保留根。
- 当前Schema244表/66事务；DDL SHA256 `294bb8243aca2857729f70fa07fbc59b69efad5da5854a5db528386e19179bc6`，P2 digest `b848201c2518224a06b1c4e4dd46928f0345d26e8aef1403fdfbfc8779a5e5fe`。32KiB JSON限定由SSOT/生成器/validator/DDL共同承认，未放宽为无上限JSON。
- Schema分类检查同时发现原243表声明漏四表。按现有SSOT明确分类：未Accepted Offer撤回回执及当前Custom Head为clear，精确Custom Intent/Preview为dependent；不加入Subject级扩张边。未来已Commit custom Spec的opaque精确Intent依赖仍由Phase 3/主整合验证，此处分类不是该生命周期已通过的证明。

验证固定源码为ignored `E:/my_project/emby_third_party-helix/.codex/buffalo-video-phase4-20261029/index-gate-4`，从Git index导出，排除18个原Phase3未提交文件；这些文件的交接SHA全部保持。

| 验证 | 结果与限制 |
| --- | --- |
| 本机原生Store/Reset copy/canonical transaction crash | 223 PASS/0 FAIL/0 skip；含当前66事务通用故障注入，不能代替真实产品旅程。 |
| 独立源码P2/table/transaction静态 | 14 PASS/0 FAIL；P2上述digest及零finding。 |
| 实际本机Linux Docker Store/Reset copy/DDL | 19 PASS/0 FAIL/0 skip，7.590秒；镜像`sha256:afb5fad462130beb66162fff081e96d089adf49ee7e2bb600e9fdac72aea0357`，只借Linux Node/SQLite依赖，不作为产品候选；源码只读、network none、1CPU/768MiB、tmpfs64MiB，无生产挂载、无模型加载。 |
| NAS store-1首轮 | 工具exit1，日志只包含前四项完成且无总计；原因证据不足，不记PASS，也不推断OOM/timeout。原日志SHA `af44f450f4f06ac4765e025407ff894ed7dec03f8a4bd2f1fb94607306250b18`保留。 |

Linux本机日志：同ignored根`store-local-linux-1.log`。NAS源码包`store-1.tar.gz`为5,642,301 bytes，SHA`b2b0ee115eb6a1413a27ffcb4dec3dd4fb0788b042073e30c07da2f5eb9538f8`；其失败不被本机新证据覆盖。最终容器均退出，生产image/StartedAt/Restart0/OOMfalse保持。

首跑问题保留：fixture漏Workspace revision导致FK拒绝；恢复副本fixture漏传标准targetSchema导致regeneration拒绝；validator漏32KiB及新增事务Owner的机械传播被门禁拒绝；固定SourceMap更新后Capability出处摘要未传播也被拒绝，完整生成后通过。没有省略校验或移交业务Owner来过测试。

剩余：正式Work/Capability/Artifact/Effect/Permit和20+20条件补采、模型/索引共载、完整Host取消恢复与视频真值/资源资格；随后Phase 5。当前不具备生产部署或自动演员业务完成资格。


## 2026-10-29 冻结批次 Work、Capability 与 Workspace Artifact 切片

在2f9fc0702持久化基础上新增首采/补采两个独立稳定Work及正式WorkflowPlan，沿现有三项原子Capability依次抽帧、512维embedding、聚类。每Event只产生自己的Artifact，不在一个Effect中偷偷提交三份文件。短片去重后没有补采点则不构造空Work；补采准入仍由后续Owner完整初轮评估决定，本切片的Work构造器不自己启动补采。

- 每批固定点、global ordinal、Sampling Plan、Model、batchDigest与原Basis关联。Nominal Work/Plan及真实runtime形状的basisRefs、abortSignal均依Foundation合同，不另造ExecutionContext字段。
- 向量仅保存一份，closed frameGeometry保留所有采样帧（含无脸）、原图SHA、校正画布、时间/区段、face/vector对应及完整重建摘要。恢复校验不把漏帧、向量缺失、错坐标或跨batch当成成功。重复图像不增加独立区段覆盖。
- 新frame-only Artifact Port沿现有Workspace存储/producer Effect路径，不用空桩实现冒充完整旧引擎。真实SQLite与物理文件测试产生恰好frame/embedding/cluster三份Artifact，幂等重放不再次调用抽帧/CPU、不多建Artifact；no-face批次同样保留完整帧证据。
- 单批累计空间quota明确冻结为floor((maximumWorkspaceBytes-maximumRepresentativeImageBytes)/2)，两批均有限且为一张代表图保留空间。抽帧base64/metadata、实际Frame Artifact、embedding及cluster累计字节分别核验；超额为BUFFALO_FRAME_WORKSPACE_BUDGET_EXCEEDED，不能写成无脸/无匹配。此逻辑不替代实际进程heap/cgroup/控制面资源资格。
- 取消后旧CPU结果不返回成功Outcome；本地测试包括Artifact已生产而Run刚被取消的竞态。正式Runtime的Effect/Permit/恢复调度和完整Host供给仍须接线验证；直接测试调用Capability边界不是已完成Supporting Work旅程。

固定源码为ignored index-gate-8（Git index导出，排除18个Phase3原文件）。实际本机Linux Docker沿固定依赖镜像afb5fad462130beb66162fff081e96d089adf49ee7e2bb600e9fdac72aea0357，network none、源码只读、1CPU/768MiB、tmpfs64MiB：78项，77 PASS、1 skip、0 FAIL，20.812秒。唯一skip是此前旧模型真实图测试未提供显式模型/图片；新切片测试中CPU/FFmpeg使用确定性技术fixture，不据此声明真实buffalo视频质量或原生模型已接进Host。

日志frame-local-linux-4.log SHA256 bc6e5cb51a8cae9d307e29e27ccab28db7798f9b55b59bf21b8188a8a971ce7e。packages、forbidden semantics、manifests、P2四项静态全PASS；P2仍为138/117/244/66，digest b848201c2518224a06b1c4e4dd46928f0345d26e8aef1403fdfbfc8779a5e5fe。这里没有新Capability种类、表或事务；新三Capability Adapter尚未替换正式Host注册。

首跑失败保留：cluster误多声明disk_io被正式Resource Demand拒绝；测试误读Model Ref中不存在的dimension字段；新Workspace fixture误传constructor字段；静态发现Capability反向依赖Planner，现将同一Libra的纯target编译提取到Model，Planner/Capability分别读自己的公开事实；离线技术目录的USearch/只读SQLite依赖漏登记补齐到integrations allowlist，业务Store权限不变；66事务的旧shard locator机械更新，源码face-member措辞去除旧模型术语。所有首败保留，不添加宽泛语义豁免或开放跨Owner查询。

当前未调用NAS模型：主整合正在真实CIFS资格，要求等独立空窗。下一步为跨首采/补采的合并分组、离线检索及完整技术Observation、Libra候选评估，再接People/演员；模型+索引共载、真实CPU/视频/控制面、Host停止恢复和Phase 5均开放。生产与主整合目录未改动，不宣称Phase 4 Exit。


## 2026-10-29 合并补采与目录技术 Observation 切片

新增独立技术 Observer，将首采和补采已验真的embedding Artifact恢复后，按相同冻结参数对全部帧重新分组，再查询每组独立代表特征。不是把两批“赢家”相互投票，亦不在此创建Person或发布出演。

原生和Linux负例以完整真实形状的Frame Evidence和正式CPU分组实现构造：首采两个独立区段为insufficient_evidence，补采第三个区段后合并为同一group/三个代表，Libra既有策略才得到qualified_candidate。单片仍选一位；新技术数据不含gender资格或排名规则。

closed技术Observation保留完整frame/face/vector摘要、group成员、全部代表query的原始100邻居内结果、最多5候选/完整有界别名、Dataset verification proof和整份摘要，最大8MiB。没有截断成“无匹配”；合法但过大的完整Evidence明确BUDGET_EXCEEDED。保留空脸帧，漏帧、漏query、跨batch/目录、错feature和改距离均拒绝。零脸可以形成明确no_faces且不声称查询目录；有真实邻居但无阈值内候选才是no_match，空的无效检索响应/文件变化/迟到CPU回复仍失败。输入仅为受控Workspace的既有特征/帧证据，不读原始视频、无网络或片源搜索。

每批空间配额为后续两份最多8MiB Observation及一张最多10MiB代表图预留空间后等分；该规则进入batchDigest，两批Artifact/两份Observation/代表图的最大空间总和不超过冻结的maximumWorkspaceBytes。不改变整体内存/控制面资格仍开放的事实。

固定index-gate-9实际本机Linux Docker，沿相同1CPU/768MiB隔离条件：57 PASS/0skip/0FAIL，12.082秒；该组覆盖Observation/Artifact/批次/capability、技术分组、目录查询模块/CPU取消及Libra资格策略。目录加载和查询使用确定性技术fixture，不能写成真实数据库/模型共载或身份准确率证明。catalogue-local-linux-1.log SHA256 22a10f1fe608c7aaa84d3814898a605b85ca209226bdcf11a84ba60531bbbf4f。两个合法正交20帧批次+完整大别名响应已真正触发8MiB边界；最初测试草稿只触发向量proof错误、未触及quota，已更换为上述有效输入，不用覆盖不足的PASS冒充容量通过。

下一正式合同增量已经确定：Foundation单Result JSON上限64KiB，不能把8MiB Observation塞入fx_event_result_bindings或放大其上限。目录Observe应为一项workspace_write Capability，单Event生成独立face_catalogue_observation Artifact，Result只回有界typed Handle；新增唯一Artifact/output kind、该Handle和精确completed-batch输入合同，不复用旧western_analysis payload或伪造PersonMatchEvidence。后续先补对应SSOT/生成合同，再接正式调度和恢复，本切片仅技术模块及其Owner投影，还未激活新Capability或Host路径。

NAS按主整合通知保持暂停：SSH/健康超时尚未确认原因，本线程不介入生产；未启动共载测试或新容器。Phase 4/5仍开放。
## 2026-10-29 Actor-local Observation Result codec checkpoint

按用户的新分工，本线程只实施演员链；唯一 SSOT/计划/全局生成物和最终部署由新的整合线程管理。以下是局部可移植实现，不是已激活的新 Capability 或 Phase 4 Exit。

- 增加完整 Observation 的受控输出 Target 编译、小型 typed Handle 构建及 Libra 完整字节读取/资格评估 codec；Result 不内联目录原始查询。唯一相对路径、完整 Basis/CompletedBatchSet、同 Run/Workspace、模型/目录代际、原始字节与摘要、producer provenance/target、计数都连续核对。
- Artifact 字节只能由正式 Workspace Port 读取后交 codec；纯 codec 不接任意磁盘路径、不发布新文件、不创建 People 或 Cast。本次夹具产生的三个 Frame/Embedding/Cluster 是正式 Port 文件，第四个 Observation Handle 为 proposed fixture；当前 kind 尚未在原分支激活，不能将此称为完整 Event 旅程。
- 固定 index-gate-13 源码，在实际本机 Linux Docker 复验 23 PASS/0skip/0FAIL，21.026秒；同前固定依赖镜像 sha256:afb5fad462130beb66162fff081e96d089adf49ee7e2bb600e9fdac72aea0357，network none、1CPU/768MiB、readonly source/root、tmpfs64MiB。原始 log catalogue-result-local-linux-2.log SHA256 b2c806dd92f2df770f98b212d2bf8cedb9abe9c73a0658b87ee4410cb93cf592。前一轮23项PASS日志独立保留，追加目标路径/provenance负例后重跑，没有用重跑抹去首跑。
- 覆盖完整来源重建、摘要/输入/代际/计数替换、非canonical JSON、改写目标路径或producer、初轮Observer及既有Frame Work回归。CPU/目录仍用确定性fixture，不代表真实模型/索引共载或精确新依赖镜像资格。
- NAS测试仍暂停，等待主整合给出的资源窗口；未操作生产、重新观察、部署或Reset。完整Host接线、补采准入/取消恢复、People自动建档与真正单演员Commit仍开放。

## 2026-10-29 Libra catalogue coordination checkpoint

增加未激活的 Libra Catalogue Coordinator 和目录 Work 构造：正式 Probe 后冻结 Basis，初轮三项来源全部成功才准入目录 Observation；初轮完整 Owner 评估未合格且有剩余唯一时间点时，才准入补采及包含两批全部特征的第二次 Observation。第二次依赖初轮目录 Work 与补采 Frame Work，不把两轮各自选出的姓名投票。短片没有剩余采样点时明确结束目录未解决，不提交空 Work。

Work ID/幂等键绑定完整不可变 Basis/producer Result 集。读取支持 Work 重规划：正式 Foundation status 的 latestAttempt 必须成功，结果必须来自该 Attempt；Capability 内使用真实 ExecutionContext 的 workAttemptId/planId，不能混入旧 Attempt 的成功帧或另一 Plan。重复当前 Result、缺项、摘要/绑定变化均明确拒绝。底层身份摘要和来源 Result 不重新编造。

人工 Actor Choice 在准入前和最终读取后优先；Run/身份/Workspace 被收回、读文件失败、目录 Work 失败保留各自错误，不能当作无候选再加采样。Observation Handle 的8MiB上限在读取 bytes 前验证。输出只为 catalogue_candidate / catalogue_unresolved / pending / failed / manual_choice_present，不创建 People、Cast 或收藏事实，未接现行 Host 注册。

首跑负例暴露一个新缺陷：两批都无脸时，旧聚类payload仅含schema/clusters，两个空数组字节相同，但不同路径/provenance产生同一按内容定位的Artifact ID，正式 Workspace Registry 拒绝不完整重放。没有改 Foundation Artifact ID、归属或放宽 Registry。新 frames-only buffalo 技术 payload 使用 closed shared.buffalo-cluster-set@1，完整包含 sourceEmbeddingDigest/clusterParameterDigest/clusters；恢复须精确命中输入，Workspace quota计算采用实际新payload。原非buffalo入口不被当成备用；本轮新版没有旧payload恢复分支。两批无脸已通过正式三种源 Artifact 落盘及不同Handle/完整重放验证。

验证与限制：

- index-gate-14实际本机Linux Docker，受影响Catalogue/Frame/CPU/原业务Work等19文件共99 PASS/0skip/0FAIL，65.294秒。log catalogue-coordinator-local-linux-1.log SHA256 515f217b5af59f8de88b8ded4d02a24728a507f0103b64fcf7922f7b2ccfc46d。
- 增加短片和读前字节上限负例后，固定index-gate-15实际Linux定向36 PASS/0skip/0FAIL，56.555秒。log catalogue-coordinator-local-linux-2.log SHA256 8b37b0238ba9aa3c470460afffbecc8b9e214705078a1cbf72518c0d06445afd。两组有重叠，不相加声称独立用例数。镜像、readonly/1CPU/768MiB/network none/tmpfs64MiB沿前节相同，不包含新依赖原生共载资格。
- 首轮本机逻辑日志 native-1 因新增夹具未加载实际Probe/result wrapper而失败；native-2 因补采夹具缺少ExecutionContext ownerScope而失败；native-3记录上述真实两批无脸Artifact冲突；三个原日志保留，native-4修复后10项通过。没有放宽正式schema、Root/Owner或停止守卫。随后 Linux 又覆盖新增负例。
- 目录/CPU为确定性fixture；第四份Observation为显式 proposed Handle/内存字节，三种源Artifact使用真实SQLite Registry及Workspace Port。这不是正式Observe Capability/Effect/恢复旅程、真实模型/索引共载、旧Reference切换、People建档或Phase 4 Exit。
- Phase 3原18个未提交文件逐字节保持；共享SSOT/builder/global generated contract未由演员线程改动。等主整合提供正式接线基准后完成新Capability/Artifact/Host旅程；NAS资源窗口继续保持暂停。

## 2026-10-29 Reviewed Observe planner and durable Artifact checkpoint

主整合提供共享合同基准97c4913b96cbe6509c65a2c42ae5ee106905eb17（139/118/244/66）后，另建固定Git index导出的独立catalogue-runtime-integration-2快照，再仅叠加演员接线源文件；不覆盖当前工作区或共享SSOT/生成物。97c的Reset仍fail-closed，不因此获得生产或Reset资格。

- 增加目录Observation单Event Planner/精确Owner projections、Capability registration/语义校验以及受控Artifact发布Adapter。输入为完整冻结Basis/三种成功源Result组成的CompletedBatchSet/唯一输出Target。Libra的资格评估与技术Artifact读取分开，Capability不创建或选择Person。
- 新Observation通过现有Workspace Port真实落盘与Registry登记，typed小Handle完整绑定字节/producer/target。恢复优先验证既有不可变Artifact，不重新计算或查询目录；输入替换、取消后迟到、损坏及丢失均明确失败，没有错误转空候选或旧包兼容分支。
- 增加只对新face_catalogue_observation kind生效的8MiB物理字节边界：materialize、恢复及读取在接受/读取完整bytes前验证；未改变Artifact ID、Owner或Root权限。主分支kind枚举仍由主整合管理，本线程只交相应Root Port实现差异。
- 独立快照沿主整合的真实生成manifest/types，不在测试中放宽现有schema。显式qualification/us-adult-catalogue-observation.test.js验证完整nominal Plan、Owner projections、第四个真实Artifact、同值重放、重命名落盘后/Registry前中断恢复、取消前回执、损坏与超限恢复。此文件需在已包含139/118合同的基准显式运行；原138分支未激活该Capability，不能静默skip或伪装成旧结果。

实际Linux验证：

- 在97c独立快照，目录qualification/原codec/coordinator共18 PASS/0skip/0FAIL，82.284秒；catalogue-observation-port-linux-2.log SHA256 03129b056b149f8e29d79ba6aa7b1b1b400b20a0c76aba1080514b4dbe4cef22。
- 同快照Workspace既有功能/Frame Capability/Frame Engine回归42 PASS/0skip/0FAIL，11.232秒，catalogue-workspace-regression-linux-1.log。四项Package/Semantic/Manifest/P2静态均通过，139 Capability/118 Result/244 table/66 transaction/153 domain/257 refs/0 unresolved。
- 先前reviewed proposal快照的初版16项也独立通过，保留catalogue-observation-port-linux-1.log；之后采用97c并新增恢复负例，没有将两组相加。首次用Windows tar解97c时因遗留中文VBS文件名返回失败，该integration-1目录没有用于任何资格；改为独立GIT_INDEX_FILE+checkout-index成功导出后才运行integration-2，不修改开发index或掩盖失败。
- Linux镜像和隔离限制仍同前；CPU与目录为确定性fixture。当前使用真实Registry/Workspace journal及Runtime-shaped Context，**没有声称已通过实际Foundation Work→Event Runtime/Permit/Supervisor或完整Service Host旅程**。重命名中断为受控异常注入，真实进程退出/停止恢复、模型/索引精确依赖共载、NAS资源资格、People与正式Commit仍待完成。没有使用NAS或生产。

## 2026-10-29 Observe file descriptor read-bound correction

整合审查指出9f1af5e47的stat(size)之后仍用path readFileSync：文件可能在两者间增长/替换，旧大小预检不能证明读取有界。核查后确认没有更强外层独占保证；上节9f的Root读前大小检查因此不能作为最终严格读取资格，主整合暂缓叠加该提交。

新kind专用readArtifactFile用O_RDONLY/O_NOFOLLOW打开同一fd，BigInt fstat确认常规文件与8MiB边界；固定64KiB块readSync，总请求最多MAX+1，读到超限立即失败，finally关闭fd。读取完检查fd与当前path的dev/inode/size及fd前后mtimeNs/ctimeNs；路径更换或读取期间修改明确拒绝。普通Artifact读取、recovery、exactReality和reality观察的该kind均走同一helper；其他kind维持原读法，未扩大其资源范围或改变Owner/Handle/digest/取消规则。

- 97c独立Linux快照上的Observe完整资格与既有Root回归共39 PASS/0skip/0FAIL，64.219秒；catalogue-bounded-read-linux-1.log SHA256 8a362ea45d173518015a7db37633395af3cbe021f74a67d51b8939b4c5a7ec0b。
- 将path替换精确放在recovery第二个size-stat返回后，再完整复验Observe的8项，8 PASS/0skip/0FAIL，63.270秒；catalogue-bounded-read-linux-2.log SHA256 ca84c487e17c2c72ff7d87bed998d2ab2fc48b67deeefad7ea2f1f448c319779。注入包括fd stat后增长到MAX+4096（总请求与返回字节恰MAX+1、零readFileSync）、path size-stat后大文件替换（零完整文件读取）、fd已打开后同字节更换inode（明确拒绝物理关联改变）。原取消、损坏、落盘中断及重放仍通过。
- 独立negative control仅把该Root实现换回9f stat-only原文并补入已审查的kind声明，不动正式源码/有效快照。新三项回归如预期全部FAIL（0PASS/3FAIL/5非目标skip，exit1）：前两项实际触及被spy拦截的无界readFileSync，第三项旧实现没有要求的fd/物理关联拒绝；没有真的无界分配大文件。catalogue-bounded-read-negative-control.log SHA256 fc764dfa64802d8a88b832097ba1c5576a5dfa0a701c1b2ed4794f30d756b4f8。它是证明负例能捕获旧缺陷的失败对照，不是整体测试PASS，也不抹去9f的资格限制。
- 最终补齐结束时path与fd的size/mtimeNs/ctimeNs一致性及path大小上限检查后，Linux完整39项再次39 PASS/0skip/0FAIL，65.388秒；catalogue-bounded-read-linux-3.log SHA256 2677178df942c38f1d860ef23847eef0a8d8542c4d4c7b2d23210e2bc9124fc1。Package/Semantic/Manifest/P2复验均通过，计数及类型引用不变。此前日志与失败对照全部保持，不以最终结果覆盖。

没有NAS、生产或模型共载副作用；完整Runtime/Permit/Service Host及People链仍按前节保持开放。
