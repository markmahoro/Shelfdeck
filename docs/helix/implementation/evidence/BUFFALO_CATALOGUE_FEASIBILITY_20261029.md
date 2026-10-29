# Phase 1：buffalo_l 内置目录识别可行性

工作项：BUFFALO-CATALOGUE-FEASIBILITY。日期：2026-10-29（Asia/Shanghai；实验日志为 UTC 2026-10-28）。范围：隔离研究/技术兼容性，不是正式业务接线、人物准确率验收或生产发布。

## 结论

Phase 1 技术门槛 PASS：ShelfDeck 现有 Node/Linux Docker 技术边界内，可以使用与固定 Stash Sense 2 相容的 buffalo_l 检测/特征方法，直接读取官方离线目录，并用同一特征体系匹配自建参考图样本。没有引入独立 Sense/Stash/Python 服务，没有复用 Mirex 实现，没有把 SFace 特征转成512维或保留双模型执行分支。

完整首跑失败和修正过程保留。当前代码仅在 `media-service/scripts/qualification/buffalo/`；正式 Composition Root、People/Libra/Arca 业务、API/UI、模型安装/Reference重建均未接线。生产仍使用原镜像，不能称生产已切换 buffalo_l。

用户已确认仅自用 NAS，不对外分发模型或数据。技术资格不扩大模型/数据的使用或分发权利；本阶段不产生包含权重/数据库的发布镜像。正式安装/资源/使用条件与完整发布仍由后续阶段核对。

## 固定输入、环境与门槛

| 项目 | 固定值 |
| --- | --- |
| 方法依据 | Sense 2 0.48.1，commit `7a690aa80c390a69d64934c6201076ae05f94e59`；实际 embeddings/matching，不参考 Mirex |
| 模型 | `det_10g.onnx` 16,923,827 bytes，SHA `5838f7fe053675b1c7a08b633df49e7af5495cee0493c7dcf6697200b85b5b91`；`w600k_r50.onnx` 174,383,860 bytes，SHA `4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43` |
| 数据 | 官方 full 2026.10.09，7个manifest成员首次与最终SHA全部匹配；没有修改或重新训练目录 |
| Node Linux镜像 | `sha256:fd51005f74c069031e0e0c2fbd32fbb282ffcf61f87e1e141f5b71438a0dbf5d`，Node20.20.2 / ONNX1.30.0 / sharp0.35.2 / better-sqlite3 12.11.1 |
| Node检索 | `usearch@2.25.3`，支持Node>=20；精确依赖lock与原生预构建保存在私有实验包。直接view原索引，没有格式转换。 |
| 对照镜像 | `sha256:42f90b994c4bf47004b8cd83b62d0c4697753aeefbc3134afa5309b1506afed0`；只运行CLI oracle，不启动其HTTP服务 |
| 对照依赖 | InsightFace0.7.3、ONNX1.31.0、OpenCV4.11.0.86、numpy1.26.4、Python USearch2.23.0、Pillow12.3.0、scikit-image0.26.0 |
| 预先冻结策略 | `parity-policy.json`：640检测、512维、100近邻、最多5结果、距离0.6；框差≤2px、向量cosine≥0.999、候选距离差≤0.003且有序候选身份完全一致。原始策略digest由oracle和Node入口逐字节对照。 |
| Node资源门槛 | 1 CPU、2GiB cgroup、无额外swap、PID128、只读rootfs、无网络/宿主端口、受控tmpfs；操作≤60s、停止≤5s、主循环/控制探针≤250ms |

实验目录是 `/vol1/1000/docker/shelfdeck-buffalo-qualification-20261029`，按 fnOS skill 完成只读 preflight 和精确根/权限/空间验证后建立。模型和整个外来数据库挂只读，未复制第二套完整目录；业务库、来源/收藏目录、Docker socket和凭据均未挂入。全部实验为任务专属一次性容器，结束即删除，没有常驻进程。

本机Docker未运行，因此没有把本机逻辑检查当Linux资格。Node和oracle顺序执行，资源不叠加；oracle限额2.5GiB，仅用于对照，其内存/时间不冒充Node产品开销。物理页缓存未清空，所谓加载时间是进程/模型冷加载，不是冷磁盘启动。

## 样本与覆盖

三张输入均来自现有US Adult库的公开参考图片，只读取得且固定原始字节：

| 当前库标注 | 字节数 | SHA256 |
| --- | ---: | --- |
| Skin Diamond | 441,131 | `eb9959967b507a4c20728f3b546aa4ea056ecca2028555f23aec6173d1b861c1` |
| Krissy Lynn | 584,724 | `9227188fb33256877650c16e076810d32973835ba95cdc27b35386c20f3cecf4` |
| Annabel Chong | 133,634 | `3b9f490762b4a14fde82346911495a3f99b646c3625ead28c39cf96eddcd1e9c` |

11个确定性输入：三张原图、各自缩小图、首图35度旋转、首图镜像、前两人拼接、空白、固定种子噪声。9个场景有脸，共10个人脸对照；另外两项是无脸。三张原编码JPEG和一张PNG解码入口另行验证，不用仅比较raw输入掩盖解码差异。

自建参考匹配5组：三张缩小图、镜像、旋转作为查询，对三张原图的同一buffalo特征排序，均选到对应样本。只验证该小样本的特征/排名兼容，没有冻结正式本地匹配阈值。

这些不是独立身份标注集；缩放/镜像/旋转是同一照片的派生，不代表不同拍摄条件下的真实多角度数据。Annabel原图与目录距离极小，存在样本与训练参考重叠的可能。没有测视频、真实库外演员、男演员选择、野外误识率或总体准确率；这些必须由Phase 4/5补齐，不能以技术一致性代替。

旋转场景的框按上游最终校正画布比较，不自动等于原始帧坐标。正式视频截图/建档还须证明原帧、校正变换、脸框及裁剪Artifact的引用连续性；本阶段不生成这类业务Artifact或演员决定。

## 结果

| 检查 | 最终实际结果 |
| --- | --- |
| Linux数学/输入负例 | 5 PASS / 0 FAIL / 0 skip |
| 图像方法/目录对照 | 11场景全部PASS；10个人脸的数量、框、特征和有序身份候选通过预定门槛 |
| 数值最差值 | cosine最小 `0.9998701772883355`；框差最大 `0.9676437377929688px`；候选距离差最大 `0.000704646110534668` |
| 原编码入口 | 3张原编码图片和PNG的特征/首身份检查通过 |
| 本地Reference | 5组查询PASS；各自正确样本均排第一，不代表总体身份准确率 |
| 空槽实际向量 | 5个索引空槽均真实查询；不生成该槽演员，返回明确排除Evidence |
| 排队/取消/停止 | 同时第二次load被BUSY拒绝；预取消、真实执行中取消、迟到结果不接纳、停止后调用拒绝均通过；停止约290ms |
| 超时 | 受控短deadline返回TIMEOUT并完成停止；没有遗留后台执行 |
| 控制面机制 | 同一测试父进程1017次loopback HTTP探针，0错误，最慢111.654ms；主循环最大延迟93.013ms。只证明本进程的计算隔离机制，不冒充完整Host或业务health。 |
| 补充负例 | 8 PASS：非零向量确无阈值内候选、128维错误模型、NaN、零向量、非法deadline、超大编码图、同大小错误模型SHA、错误目录generation均按预期处理 |

预处理逐层对照：4个场景的OpenCV缩放字节完全一致；旋转展开画布40,936,860字节完全一致。对齐原图0差异，另两项仅8字节/1字节相差1，属于浮点变换量化差异；最终特征和排序仍通过原定门槛，没有修改阈值。

Node加载约4.373s；1CPU普通单脸/缩小/镜像场景约5.497–7.746s，旋转13.146s，双人10.645s，空白1.658s，噪声0.929s。RSS采样峰值2,000,232,448 bytes（约1.86GiB）；cgroup峰值1,326,026,752 bytes（约1.24GiB）、oom/oom_kill均0。两种内存口径不同，mmap共享页/缓存归属不能相加或当作改进证据。不是常驻NAS共载资格、吞吐承诺或全冷磁盘时延；Phase 4须在真实视频及整机资源条件重新测量。

## 数据目录审计

SQLite完整integrity为ok。1,076,145个SQLite人脸键全部在索引中且有JSON身份，JSON非空身份亦为1,076,145项。索引额外5键为 `1010466/1010467/1010468/1364463/1364465`，全部满足JSON身份null、yaw null、SQLite无对应人脸行。没有改库补造记录；读取时将其作为明确无身份槽排除并保留Evidence，不把这5项当有效演员或新增故障，也不按硬编码键加入业务兼容例外。其他引用矛盾仍失败。

目录人物gender字段统计：null237,350，FEMALE153,050，MALE49,312，TRANSGENDER_FEMALE6,353，TRANSGENDER_MALE112，NON_BINARY211，INTERSEX4。**超过一半缺性别资料**；不能从“有字段”推导覆盖完整，更不能用脸部外观猜性别。女优选择仍是Phase 4的明确待定规则，不能在本阶段暗中确认为自动建档资格。

## 首跑失败与纠正

1. npm没有与Python一致的USearch2.23.0。最初下载的2.26.5要求Node>=22，不用于现有Node20资格。改固定支持Node20的2.25.3，并实证读取/查询原索引。首次版本探针误用未export的package.json路径失败，修正探针后成功；失败日志保留。
2. 第一轮oracle逐项访问IndexedKeys，内部扫描导致CPU长跑；仅停止本任务一次性容器。改用原库bulk slice，未削减全量审计。第一轮不记PASS，原日志保留。
3. Node首轮普通图通过，旋转及双人边界候选失败。根因是OpenCV uint8缩放分段舍入、PIL最近邻旋转的固定点细节。按上游实际规则纠正；没有放宽cosine/距离/候选一致性门槛。
4. source-2图像对照全通过后，source-3进一步核实PIL旋转逐字节一致，并补实际空槽、Reference、控制HTTP和deadline检查；source-4仅新增补充负例入口，原已资格核心文件不变。保留各轮原始日志/报告，不把最终PASS重写为首跑全绿。

## 工件与复验

| 工件 | 字节数 / SHA256 |
| --- | --- |
| 首批输入/策略 | `input-1.tar.gz`，1,167,427 / `f92b840deb67ab2eb6cd3ddc47754e407bb9764b274b1e115eb8d306639c2fcd` |
| Node依赖包 | `node-deps225.tar.gz`，5,317,072 / `e62c18511e4cd0d2d1d168f6a8b838fe6819a32323fa8e82d85214a176bce0a0` |
| 最终核心资格源码 | `source-3.tar.gz`，19,229 / `07e834cc30329085f07b7df250c85f4d1b6aef43f64c792629f93749b9ab9217` |
| 补充负例源码 | `source-4.tar.gz`，19,772 / `4f9e991d9ada5715a003ff9d1e57c5790cd0ef378d1627cb315110e318fad58d` |
| 最终核心报告 | `node-parity3.json`，17,407 / `c6b3ff8bb91fbf68b716875a416c99a19421e352b19e7f16e3cbe166de546055` |
| 补充负例报告 | `node-negatives.json`，324 / `0053ce88a68095dec33c44d282669936d42ea7d42554264c95a3adbd2ed67214` |
| Python oracle报告 | `reference-2/reference.json`，293,709 / `6a3012722a95bd21bd079bfec8b67dbc21a3f2bb83a69476568e96c544133a69` |
| 最终保护记录 | `final-protection.log`，1,523 / `f93c08d1a1b25d4c5c509fbc2e06934df305ad6ed9de58e0ac3ee303b5fdffe8` |

源码入口/策略/README已入当前工作树，原图、模型、数据库、raw特征、实际响应和运行JSON不入库。NAS实验根保留 `reference-run.log`（中止）、`reference-run2.log`、`reference-2/reference.json`、`slot-audit.json`、`node-parity1/2/3.log/json`、`components-node3.log`、`node-negatives.log/json`、`final-protection.log`；本机对应忽略目录是 `E:/my_project/emby_third_party-helix/.codex/buffalo-phase1-20261029/`。

退出前解出source-3逐文件对照当前资格目录，原11个成员全部字节一致；source-4仅新增`run-negatives.js`，未改变已完成核心资格的方法、策略或执行代码。人物保护报告的SHA为`63194870b23aade0878937785f120f0f36d93aca0dcef0e6e3bef126f448f401`。

另提交`dependencies/package.json`及lock以支持从源码复验：5个依赖版本/integrity与已验证归档一致，并逐一核对npm官方元数据；仅将root依赖约束改为精确版本、resolved URL改为官方registry，不改变任何依赖字节身份或上述11个资格文件。模型/数据仍仅在私有实验目录。

复验使用固定镜像和上述只读挂载合同，oracle在Python对照环境执行，Node核心仅使用既有Service依赖及固定USearch包；源码和依赖归档SHA先验真，运行各自受限CLI，不能直接执行Sense服务默认入口或挂载生产数据。单次实际进程、deadline和资源限制见各轮shell记录；不以本机5项逻辑PASS替代NAS实际Linux结果。

## 来源、使用条件与保护

代码参考来自[固定Sense源码](https://github.com/AnonTester/stash-sense2/tree/7a690aa80c390a69d64934c6201076ae05f94e59)、[OpenCV4.11](https://github.com/opencv/opencv/blob/4.11.0/modules/imgproc/src/resize.cpp)、[Pillow12.3](https://github.com/python-pillow/Pillow/blob/12.3.0/src/libImaging/Geometry.c)及[USearch](https://github.com/unum-cloud/usearch)。Sense代码MIT、USearch Apache-2.0。模型权重的[InsightFace官方条件](https://github.com/deepinsight/insightface#license)限定非商业研究用途，不能解释成随代码MIT；[数据仓库](https://github.com/AnonTester/stash-sense2-data)未见独立分发许可。本阶段是隔离研究资格；用户确认自用、不对外分发，后续不捆绑权重/数据对外发布，仍须保留各自来源/使用条件，不替用户或上游作额外许可承诺。

三名人物完整响应和三张参考图前后SHA均一致。生产ShelfDeck容器ID仍 `1792e7209ca39dcd83eb64d91107803bb7bdf234103a4d5b00d4381bf1d29493`，image仍 `sha256:894a07fd5c178536bebecc4d3dfb3951c9d225d217c62c2c2db2c49f8f4696df`，StartedAt仍2026-10-27T06:15:12.736819591Z、Restart0/OOM=false。原Sense实验容器保持exited/Restart0/OOM=false；本任务无遗留容器。没有部署、Reset、重试、取消、改配置/人物/媒体或重建观察；没有重新逐行核验全部收藏/历史，不据局部保护宣称全库保护检查。

## Exit反向审计与承接

按SSOT/Playbook反查：最小模型/索引/图片与Reference样本、负例和资源/停止结果完整；只产生技术Observation，零业务写入，未提前接视频/People自动化，未恢复旧Runtime；方法/策略/镜像/依赖/源码归档和原始Evidence可复验。该有限技术Phase可Exit，**不等于整轮或US Adult准确率验收完成**。

下一活动包为Phase 2现有故障收口，尚未在本次启动实施。Phase 4仍须真实视频和女优/未知性别选择，Phase 5仍须完整建档/Reference更新/出演/人工竞争，Phase 6仍须完整Linux架构、固定镜像/UI及正式生产资格。既有第三层目标未提交代码保留；没有因为本Phase完成关闭它们或其他历史问题。
