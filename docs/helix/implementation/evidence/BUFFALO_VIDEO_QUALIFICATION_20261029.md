# BUFFALO-VIDEO-IDENTIFICATION：首轮视频技术证据

日期：2026-10-29（Asia/Shanghai）。这是当前Phase 4的Evidence，不是第二个活动计划。主路线仍为Phase 1→4→5→2→3→6。

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

## 开放门槛

待确认FEMALE-only自动候选、明确MALE排除、未知/冲突/其他标记转原人工流程的业务规则；本次没有擅自确定。还需正式typed Basis/目录与模型generation/Artifact/Effect/Runtime Permit接线、补采与代表单脸图片发布、真值充分的独立视频/无匹配/人工作主、物理冷启动/真实4K/资源共载及重启恢复。之后才能退出Phase 4并进入Phase 5人物完整发布和唯一Commit，不能由本Evidence提前宣布核心功能完成。
