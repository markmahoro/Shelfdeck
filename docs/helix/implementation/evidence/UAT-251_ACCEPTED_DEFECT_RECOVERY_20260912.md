# UAT-251 已接受瑕疵误识别与维护恢复

2026-09-12 用户确认实施。保持UAT-251开放，不新增重复事项。

## 问题与范围

生产286fe56f1e只读快照（22:59–23:02北京时间）：122收藏，103健康，9项自动体积维护（1 active、8 queued），10 attention。19项全部保留有效v1瑕疵授权，无手动修复意图。17项当前Finding与授权代码匹配；2项为旧media_strategy_unavailable结论。原始Libra冻结Spec与Arca错误重建要求的独立比对证明：旧代码遗漏评分分支，19项对应接受判断false；精确冻结要求下true。数据库检查不等于重新完成实际媒体检查。

## 实施合同

- 不改变Owner或Handoff。Libra通过现有ProductDeliveryPort增加有界历史Requirements读取，输入精确Package ID/digest集合，输出已发布AcceptanceRequirementSnapshot及来源；Arca只从自己的On-deck Commit/Custody取来源引用，禁止跨域SQL或依据当前评分重算历史。
- GET仅只读；单条与批量投影共用同一核验，缺证明确失败，不无条件豁免。
- 自动维护在准入、继续执行前核验已接受差距；手动意图保持独立。已经Commit者继续正式收尾；未Commit误触发者通过Work cancellation/drain及Case终结释放责任，不删除历史。
- 旧笼统Finding须重新做真实健康Assessment，不把其直接改名为已接受瑕疵。新缺失、损坏与未授权变化保留。
- 用户确认上述9项误建任务正式收尾及19项重查；不授权任意Reset/直接SQL、删改原媒体或其他任务。部署由既定负责人整合发布。

## 验证

- Windows 全架构校验 helix-architecture-verify.js：239 文件通过，原全套1819测试（1810通过、9跳过）；后增执行端转码拦截测试，专属6项再次通过。p15状态机15项、公开端口5项、Web care-workbench11项及Web production build通过。
- 全量回归最初仅2项因SSOT source map摘要未同步失败；通过标准materializer同步后全套通过，没有弱化校验。
- 生产一致只读副本940,773,376 bytes，仅保存在任务忽略目录；真实197表Kernel、Arca Store、Libra ProductDeliveryReader及ContextReader核对122项：111 healthy、8 unhealthy、1 repairing、2 attention。自动Case guard精确命中9项；仅模拟正式停止这9项后的投影为17/19 healthy，2项仍须真实Assessment。此模拟不等于生产已终结。
- Windows Node25.9完整评分读取遇到现有P6_PERCEPTION_RECORD_DIGEST_MISMATCH；部署负责人以三个相同冻结Record/Anchor及同源码独立确认：perception-store.js:484的未指定locale排序使Windows默认zh-CN和Linux默认en-US产生不同digest；两边ICU均78.2，交换locale即可互换结果，并非本次Aftercare回归。相同代码在生产Linux只读Database和固定事务内读取122评分成功。上述本地投影注入该公共端口输出，未跳过或改写记录校验。Linux候选镜像全链验收由部署负责人恢复实际Perception端口执行。
- UI负责人确认精确文案“已接受瑕疵，自动维护已终止”；保留unresolved，不展示已修复/成功。Web组件测试覆盖；生产实际页面验收待部署后完成。
- 未执行生产写入；部署、正式Case收尾、实际重查和原片/历史保护证据待部署负责人追加。UAT-251保持开放。

## 部署后正式执行与范围

1. 部署负责人按既定流程整合提交，fresh一致副本验证完整Host可恢复，备份/checksum/dry-run/apply完成后再进行生产验收。
2. 每项使用既有 POST /v1/admin/care/{shelfEntryId}/actions/check，JSON体为固定且可重放的idempotencyKey。9个未Commit误Case由coordinator.reconcile先走stopCase、cancelProcessWorks/drain，再持久化unresolved和accepted_defect_requires_manual_repair；如返回case_fence_draining等待在途工作结束，用相同key重试。正常后台reconcile也具相同保护。
3. 9项终结后，再以各项固定check key进入真实健康Assessment；其他10项同入口重查。旧media_strategy_unavailable会自动安排确定性deep assessment，不直接改写Finding。正常API检查会沿现有合同处理新真实问题；若线上事实与冻结范围不同，保留新问题并记录。
4. GET /v1/admin/collection及 /v1/admin/care/{shelfEntryId}验证当前结果；检查原Inventory、主片绑定/物理身份和已接受瑕疵仍保留，历史resolved Case不删除；核查误Case新Event未再启动转码。禁止直接SQL、伪造成功或清空历史。

| 影片 | Shelf Entry | 待终结Case（快照） | 后续 |
| --- | --- | --- | --- |
| 大风杀 | `2b34cd71a1040cce1427827ab09a88b0aa15ee8dcd9fdc24d1a629684808d159` | 无 | 精确已接受瑕疵，重查验证 |
| 黑匣子 | `50b4f763ac9e79108f44c7d19f84e877858ed579739c48094f6adc35c85fc1fc` | 无 | 精确已接受瑕疵，重查验证 |
| 守望者 | `2eb08381b9a6b92ed0a139635a5c31b24d4d1984187fb734cbc7d1e63b08b4bc` | `arca-care-db853f3adf6ea00dba44ae7439670a8b86b088eb` | 精确已接受瑕疵，重查验证 |
| 角斗士2 | `0ac9b83b4af863b20faba87839f5c3524a06cac93952fa6382e4f45e6618b0d2` | `arca-care-c73b14209bd642f44989fa85929e469d3001e94c` | 精确已接受瑕疵，重查验证 |
| 超脱 | `b08dc319efe4ae762701dd1f990c1f1cd66aeeae92fbc18037ed70fac38e578b` | 无 | 精确已接受瑕疵，重查验证 |
| 这个杀手不太冷 | `e032ddcbcceb3ff3b245f251f323791372268940b056f23352e3df7a2e4d2d51` | `arca-care-7cbfa046e3fd95b1e4858a8f40b588a3d3b2e841` | 精确已接受瑕疵，重查验证 |
| Black Widow | `eb3c9431ff78196e83e05643601a18902d551f31efc677486c626d784628126a` | `arca-care-751492a261dc1bd0fe574a9649dfd42f99ddbabb` | 精确已接受瑕疵，重查验证 |
| 美国队长 | `21cb4d40d855ccd50e3f72f69b511b6a1c0fa1809b8228e7b429864c99d59388` | `arca-care-8c592d807fde2f6aff22b775533eb0f65e2e4257` | 精确已接受瑕疵，重查验证 |
| 无可奈何 | `834f1ba751d4c5d699b2370eccd29a5fdca05f19c6a98d1ef741a32d6585c433` | 无 | 精确已接受瑕疵，重查验证 |
| 速度与激情：特别行动 | `4e5ab37996d88e87142f12563045d8aa9febb53e1ff63eaf7a69260975bf8441` | 无 | 旧笼统结论，真实重查 |
| 霍比特人3：五军之战 | `64031e840aff6ebebaa4c592a6ef0033e8fe4f236fd3097d378bb964b907318f` | 无 | 旧笼统结论，真实重查 |
| 阿姆斯特丹 | `14db9643fb87916c37ba0344bc03b9b9af3918cc9a3be8b401f1689f3e17e495` | `arca-care-5b01f82f6f4070e356bc40b9293dabff79baf792` | 精确已接受瑕疵，重查验证 |
| 浪客剑心：京都大火篇 | `d853df7969580eb92012d5f5d87fc0c1a02f9a2e41a76f62861ae6fcf36f9d37` | 无 | 精确已接受瑕疵，重查验证 |
| 哥斯拉-1.0 | `4e251672bf3aae5edbccdd57395a7a8c322bc29583c868b750e3eec71e66384c` | `arca-care-ddc792dcc673ee5cda1e240a5234f00fa902752f` | 精确已接受瑕疵，重查验证 |
| 不能说的秘密 | `192e8156148e09e4e6da8ce49c25e4308285c11c1580b88a7e78bf5c0af3f3ef` | 无 | 精确已接受瑕疵，重查验证 |
| 从21世纪安全撤离 | `a166fc7f35281a269a3462e40baa75a94609171d9e86f1576f32c05a94c60d25` | 无 | 精确已接受瑕疵，重查验证 |
| 唐人街探案3 | `e03a4eb97259a356deee3dc55eb3b4a209645dfffd2e5534694576fbdd1c1d26` | 无 | 精确已接受瑕疵，重查验证 |
| 养蜂人 | `f318297a2e229127ba56cdf2779d052b7a96cbe2ab1e3b67aa3e3094c9250bdc` | `arca-care-ba53d35e12874aea71559ef4d57ccf0dc585139d` | 精确已接受瑕疵，重查验证 |
| 拆弹部队 | `c475f05c6be85d2ce31d37cb17e57bee61c2d4d5710e2d83565e7494b3bfde53` | `arca-care-e21469ca587407343c72ea93f65404a861fcfae9` | 精确已接受瑕疵，重查验证 |

## 联合部署验证与收尾阻塞

2026-09-12 16:04Z（北京时间9月13日00:04）由部署负责人追加。正式源`e7c84dd536b8c2b9a1bac103f037ed9422225f92`已fast-forward整合；独立干净发布树构建`markmahoro/shelfdeck:helix-beta-20260912-e7c84dd536`。标准build/upload完成，tar SHA256 `513e039e29fa3f04cd7db66d5950076331a607de6e3d9d670dd7d3d8b1038fdc`，NAS Config ID `sha256:9bf0d71a20240ce0ccd067a8bb8f835759b4188f740e25c0b8e2f2069d7efb86`。仅加载候选，**生产仍286，未apply，未执行生产Case收尾或检查**。

- 精确候选Linux：专属6、状态机15、公开端口5，共26/26通过。15:53Z候选容器对生产DB只读，使用真实Perception公共端口和Foundation WorkResultReader，122批量及19详情的originalRequirements/CareBasis完全一致，guard精确命中9 Case，无评分注入。
- 15:48:41Z fresh完整一致副本：`/vol1/1000/docker/shelfdeck/test-runs/aftercare-release-20260912/data`，45文件manifest digest `12fba691a3e2c9f4c3df0d27e6d713d5dc97e3715cce180f4f8a01e4bd343abf`，122收藏，971 Delivery=138 accepted/824 open/9 rejected，integrity ok/FK0。
- 候选完整Host：生产媒体/Workspace只读、网络none、独立data；ready/normalSupplyAllowed、60s观察、正式close及8保护表全行摘要保持均通过。只读挂载导致其他Libra工作EROFS/ENOENT，已识别；新增`ARCA_AFTERCARE_MANUAL_DEFECT_INTENT_REQUIRED`拦截被真实执行轨触发，不按无错误全链报告。旧286在候选运行后的同格式副本启动/观察/关闭也通过，8保护表不变。切回候选使用同一fallback数据，并调用真实session/actions/check，仍在本节时点运行。
- 完整生产备份：`/vol1/1000/docker/shelfdeck/backups/unified-helix-beta-20260912-e7c84dd536`，45文件，原件及复制件aggregate digest `1a1c14458287881de9a7e27c524a1110d774dfc09449e76b5aacda7f3a44e278`，SQLite/FK正常，compose/Secret保留；15:59:55Z完成。标准deploy dry run通过，等待业务收尾门禁。
- 生产只读保护基线：122 Entry、19指定Entry的141个当前Inventory文件均可读取，采样指纹/size/inode/mtime已记录，无物理错误；所有旧Case、Assessment、Inventory事实和执行尝试已导出到ignored Evidence，生产没有变更。

正式接口副本截至16:04Z：8/9误Case为`unresolved / accepted_defect_requires_manual_repair`。最后《拆弹部队》仍`case_fence_draining`，Work `arca-care-work-5628687565aa0fa423f510aa443450605d8d8dbc`为running，Event `care-transcode-0171e951386bd80307` executing，Attempt `event-attempt-d67fcdb0-a894-4713-8e80-6ea90fd0d56c` executing，Effect `cab0c91289510f34bc5e536a7aaa669f76778aa55bfba37440971025dcd7bece`为reconcile_required；后继media.verify已cancelled。Host反复出现manual-intent-required，疑似执行前拦截同时挡住已有Effect的只读reconcile证明，已交原开发任务核验，尚不把假设写成最终根因。

其余检查已提交真实Work，例《大风杀》`arca-care-work-6db9979fd16115b5a4cf9ad48eef2d254fd6104e`的custody/conformance/presentation三个观察均succeeded，但assessment.commit waiting_for_resource；新Assessment尚未成立。不能仅凭17项旧投影已healthy宣称19部重查完成，也不能把被占用资源直接删掉放行。

本时点决定：暂停生产apply，保留8成功终结及未决Effect现场；补修既有Owner正式reconcile/cancel/drain后再验，不Reset、不手改Effect/资源/历史摘要。原始文件位于集成区ignored `.codex/unified-release-20260912/aftercare-*`；活动切回副本为NAS `aftercare-release-20260912/aftercare-fallback/data`，容器`shelfdeck-uat261-aftercare-cutback`，不得在其运行时并发写入。生产locale未改变，Perception跨语言排序问题继续单独记录。
