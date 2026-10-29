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
