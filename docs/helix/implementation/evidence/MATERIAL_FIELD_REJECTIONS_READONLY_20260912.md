# 文件来源 8 个拒绝媒体包：生产只读根因调查

调查日期：2026-09-12；除明确标记 Z 的 UTC 时间外，以下时间均为北京时间。范围为用户拆出的文件来源拒绝计数调查。仅新增本地调查摘要；没有修改业务代码/UI/生产配置或数据，没有重试接收、扫描、Reset、部署、重启或媒体写操作。

## 结论

“8”是电影 Field 当前保留的 8 条 rejected Candidate Delivery 的数量。数据库记录与公开 Projection 一致，没有重复累计同一 Offer，也没有把 8 条仍等待的 Offer 错减掉。8 条材料验证结果均为 candidate_material_unavailable；原包指定的八条路径现均 ENOENT。

但不能据此判断只是历史提示：**其中 6 部的现存正片被历史恢复留下的过期 Eligibility 排除，尚未生成后续包；另外 2 部的另一份现存材料已有 open 包，在 822 的等待队列中。当前没有证据表明这 8 部已恢复为 Shelf Entry。**

拒绝旧的不可用材料是正确的 Intake 保护。应修复的是历史恢复后未完成的 Procurement 资格重算，并让计数能表达历史拒绝与当前可行动影响的区别；不应放宽 Libra Intake 验证或将旧 Offer 改成 accepted。

## 当前生产与计数口径

- 生产：`http://192.168.12.230:18080`，health=ok，generation=helix-clean-v3。
- 镜像：`markmahoro/shelfdeck:helix-beta-20260911-c10e516e64`；Image ID `sha256:fd03632b156ff535c84be0e853ee384dc98bea1fba41bf59eee4c8c2687a1b57`；StartedAt=2026-09-11T15:47:29.758910825Z。
- Field：`movie-field-0ac6fa81-eec0-4bcd-9903-aaf2e8e526d4`，电影文件来源，root=/media/Film。
- 00:20:56 GET /v1/admin/material-fields 与 00:27:07 GET /v1/admin/material-fields/:fieldId 均 200；00:27:50 SQLite 再核：**956 generated = 126 accepted + 822 open/waiting + 8 rejected**，与用户扫描快照无变化。
- 15 个 Procurement Run 均 sealed。所有保留包的发布时间范围为 2026-08-28 23:03:41.641 +08:00 至 2026-09-07 18:06:36.609 +08:00。

生产 field-procurement-status-query.js:204–228 按 field_id 取全部 Candidate，再按 Candidate ID 分批取全部 Delivery，直接数 state=accepted/rejected；waiting=Candidate 行数减两个终态数。没有日期窗口、当前 Observation、当前材料可用性、Subject 或 Shelf Entry 条件；单位是包/交付，不是去重影片。

严格说它是“当前保留记录中的历史拒绝终态数”，不是应用启动以来或永久累计的拒绝尝试次数。历史 Reset 曾将终态 Delivery 重开并删除对应 Intake 记录，因此不能从当前 8 反推出历史只拒绝过 8 次。

四份根因相关生产文件的 SHA256 已与 git c10e516e64 逐字节比对相等：Field Status Query、Intake Capability Ports、Procurement Automation、Formation Reset。没有用较旧工作树代码假定生产实现。

## 八个包及后续状态

下表包 ID 统一加前缀 candidate-package- 即为完整 ID。影片标签来自 immutable Package 的 display_identity/IdentityClaim；现存影片另以对应 NFO 的 title、TMDB ID 和精确材料证据交叉核对，不通过模糊文件名判断拒绝原因。

| Package 影片标签 | 包 ID 后缀 | 当前保留拒绝时间 | 当前结果 |
| --- | --- | --- | --- |
| 007：大破天幕杀机 (2012) | `8de6570ffe26968bbd2f1653e32c2fabcaed0912` | 2026-09-07 23:31:22 | 另一份现存材料已有 open 包 |
| 老枪 (2024) | `7336a998780a4ec47ec3c2c875f52ca5ac07762d` | 2026-09-07 23:31:25 | 现存正片被过期 Eligibility 排除；无后续包 |
| 绣春刀 (2014) | `f5d1977723d09c1778ddcbeb315c05393bf2bb39` | 2026-09-07 23:31:25 | 现存正片被过期 Eligibility 排除；无后续包 |
| 魔女 (2018).shelfdeck-stage-b0782dfc6713bc90 | `327887370559efc3dd7fa7001e3096d855a353ca` | 2026-09-07 23:31:28 | 另一份现存材料已有 open 包 |
| 静水城 (2021) | `e0d88eccb41bcb1c716c1789d71b3c1dbc7b40f0` | 2026-09-07 23:31:29 | 现存正片被过期 Eligibility 排除；无后续包 |
| 恋恋笔记本 (2004) | `4a413e68f87fb2b84dac4059d813375712ffb0b3` | 2026-09-08 21:17:25 | 现存正片被过期 Eligibility 排除；无后续包 |
| 图雅的婚事 (2006) | `fe684f7dd1cbab433a0e7e1a8b301c8a1e0734a1` | 2026-09-08 21:17:25 | 现存正片被过期 Eligibility 排除；无后续包 |
| 猩球崛起3：终极之战 (2017) | `ac5717c332e8a8dcde8e646e26c14da90884529e` | 2026-09-08 21:17:25 | 现存正片被过期 Eligibility 排除；无后续包 |

全部 8 条都有一对一的 Libra rejected Decision、Handoff A Receipt 和 Procurement closure，primary_rejection_code=candidate_material_unavailable。逐条 Reason 引用的 IntakeMaterialVerification digest 与 fx_event_result_bindings.result_digest 相等，result=failed、verifiedMaterials=[]。0 个重复 Candidate Delivery、0 个同 Offer 多 Decision、0 个拒绝 Receipt/Decision/Package/digest 对应异常。

8 个旧 material_key 各只属于这一个包，没有同一 Physical Material 后续 accepted 的证据；旧 Reservation 均 released/handoff_rejected。旧 Identity 的 Procurement Control 仍为 revision 1，不能把它当作当前另一 inode 文件的 Control。

### 已有另一份包的两部

- **魔女**：被拒绝的是 Package 明确记录的 `魔女 (2018).shelfdeck-stage-b0782dfc6713bc90/魔女 (2018).mkv`，该路径不存在。正式目录现存另一 inode=747431 文件，4,781,860,609 bytes，中段 256 KiB 指纹与旧包一致；是不同 Physical Material，而不是同一材料重复计数。其包 `candidate-package-9e903a5ba2db30fbf181cfe845cfe7ca0544e93b` 自 08-28 发布，当前 open、candidate_delivery，已有 Procurement Control，未建立 Subject。NFO 正式身份为 TMDB 530254。这里没有把带 stage 的命名本身当作写入者或缺陷归因。
- **007：大破天幕杀机**：旧包指向 3,065,369,785-byte 文件；当前是不同 inode 和指纹的 27,506,628,703-byte 文件，不能当作同一 Identity 恢复。当前包 `candidate-package-37079081c924c9169ecd43d9be57116beb9eab3c`，Offer `90451308ed1c8aa7922d70c8c1038d299e42a6f7a28490154f60ac3600c894ee`，09-07 发布，open、candidate_delivery，已有 Procurement Control。NFO 身份 TMDB 37724；历史 PROD-065 Evidence 记录了保留补购成品用于重新采购。未宣称它已完成新的接收或整理。

旧拒绝仍显示而替代材料已排队，说明拒绝数与当前阻塞数不相等。即使未来新包 accepted，旧 rejected 行按照此 Query 仍会被统计；这是读取公式的确定结果。本现场未发生“这八部已上架却仍显示失败”的实证，不把推论写成已发生事实。

### 仍有实际阻塞的六部

六部现存正片均可读取，大小及中段 256 KiB 指纹与原包相同，但 inode 不同。它们已被 Field 正式观察，位置已是较短的成品路径。对应当前 Material 数据如下：

| 影片 | 当前 material_key | 当前 inode | bytes |
| --- | --- | ---: | ---: |
| 静水城 (2021) | `1085e323044a7256d8e29eeb468e3b8e10ad9ddd05b576d6e301a41c4ec7b4f1` | 851645 | 8946154253 |
| 猩球崛起3：终极之战 (2017) | `f0b710a7c310bf952d093c202e79943f2586543216d79058c9125aa8cb78a403` | 853762 | 7905243510 |
| 老枪 (2024) | `2d890a8232af15d514d25fbac36ffbb6af6be67ba46743741782f376c45e9328` | 847886 | 14873141271 |
| 恋恋笔记本 (2004) | `a51dcf727bb193457a5a5c175eea60603ba2b171e278ee7c973e8245c7517bec` | 853699 | 4755684875 |
| 图雅的婚事 (2006) | `174d167b5cbbf053f7e457cf0abedc9558b5569673aa904bf62fe61cb2bd8577` | 853716 | 3099966997 |
| 绣春刀 (2014) | `279b4c6b3c57ed1456ba253cd476216f5f4f4a70e9884ef4c475d58097e29521` | 851624 | 4242910007 |

这六条一致：proc_field_materials.eligibility_state=ineligible、reason=outside_procurement_region、control_projection=finished_goods、projection revision=1；Eligibility 最后更新于 09-07 18:06:18–19、terminal Observation revision=1161。现在同一精确 key 的 fx_material_controls 和 revisions 都不存在，Libra 当前 Binding、Procurement Reservation/Candidate、Arca Inventory 引用也不存在。Foundation 对无 Control 行返回 uncontrolled，不是 finished_goods。

因此是**持久化采购资格与当前事实不一致**，不是仍被真正的收藏 Control 正常排除。自动 Run Creator 只选择 eligibility_state=eligible，这六部尚未重新进入包队列，也不包含在 822 个等待接收包里。

NFO 身份交叉核验：老枪 TMDB 1184222、绣春刀 291692、静水城 616651、恋恋笔记本 11036、图雅的婚事 2694、猩球崛起3 281338。图雅包标签为“2006”，现存 NFO year 为“2008”；这是不同来源的年份字段，未用年份推断相同材料或拒绝原因。

公开 Collection 对八个片名查询全部 200/resultCount=0；数据库 Arca canonical identity 对八个 TMDB key 也全部无命中。这里只读核验了是否有当前收藏，不据文件存在宣称已 On-deck。

## 根因链与历史证据

1. 八份旧 Package 都在 08-28 发布。后来若干原片已经由历史整理流程复制/迁出到成品位置，旧 Package 仍冻结原位置与 Physical Identity。
2. 已保存的 09-07 12:02:53Z 备份中，魔女、老枪、007、静水城、绣春刀已经 rejected；恋恋笔记本、图雅、猩球3 为 open。12:45:25Z 和 14:55Z 备份中八条均 open、对应 Intake Decision 已不在。16:33:48Z 备份中前五条再次 rejected，后三条仍 open。当前后三条也在 09-08 21:17:25 成为 rejected。**历史反复重开真实存在，但当前公式没有把多次拒绝叠加到 8 之上。**
3. 现行 Reset 的 rollbackControls（约 1027–1059）删除/回滚精确控制及修订；reopenProcurementHandoffA（1081–1119）重开旧 Delivery/Reservation。该脚本没有同时更新 proc_field_materials Eligibility 或发出其后续重算的精确变更。PROD-065/066 的历史记录明确以新 Observation 重新采购作为后续步骤。
4. 原始备份进一步证明这不是此次调查期间的新漂移：09-07 12:02:53Z 时已有五条现存正片处于“无 Control、Eligibility 仍 finished_goods”；老枪当时尚有 Arca Control，到12:45:25Z 已无 Control，但其 Eligibility 原封不动。以后几个备份与现在均保持相同过期值。
5. 最后一次成功 Observation 为 revision 1089–1161，结束于09-07 18:06。后续 Work `field-observation-work-fabadd31c38e1233d2f485189505a61e548734d1` 只写了1162–1221共60页，completed=0，并因 COOPERATIVE_EXECUTION_DEADLINE_EXCEEDED 失败。当前 Field head仍是未完成的1221，没有后来成功的整轮 Observation 修复这六条资格。
6. reconcileMaterialControlChanges（约914–960）只在当前 head.completed=1时处理 Field；当前事实使该入口跳过。普通成功 Observation 路径会读取 fresh Control 并重算差异，但没有对应成功运行。这说明既有恢复未收口，不能将重复扫描或再次 Reset 当成已经证实的安全修复。

历史 docs 的“观察中”“后续重新采购”不能替代当前成功证据。这里将旧材料拒绝、当前文件存在、当前可采购性、真正进入收藏四件事分别验证。

## 缺陷判断与最小修复建议（未实施）

| 项目 | 判断 | 建议 |
| --- | --- | --- |
| Libra 拒绝不可用旧材料 | 符合 SSOT 4.4.3/4.4.6、5.4.1；未见宽泛合同错误导致本组误拒绝的证据 | 保留验证和 immutable Receipt；不要复活原路径或强制 accepted |
| 拒绝计数为8 | 与 Owner rows 一致，没有算术重复 | 作为保留历史交付统计解释；不将它等同“当前有8部电影待修复” |
| 六条现存材料的资格过期 | 已确认的恢复收口缺口，仍影响再次采购 | 为精确受影响 Material Change Set 提供 Procurement-owned、持久可重放的重算/完成证据；从 current Control 和合法 Observation Basis 重建资格，再由正式 Run/Triage 发布新包 |
| Observation失败时后续重算 | 现有入口会跳过当前 Field；本次未调用它 | 保留待重算责任，不能把空处理当作完成；如何取得合法 terminal Basis/完成新 Observation 应遵循现行 Owner 合同，不能放松观察或 Control fence |
| 拒绝可诊断性 | 目前前端只有汇总；Verification 也丢失每个成员原始 errno | 如后续授权产品修复，公开 Projection 提供包、时间、typed reason与有界材料定位；精确错误原因应在原 Owner Evidence 中保存，不能由 UI猜测 |

应补的验收：历史恢复撤去 Control 后六条资格与当前事实一致；材料存在但旧路径消失时旧包保持拒绝、新包走新身份；服务重启/失败 Observation 不丢重算责任；同 Offer 重放不增计数、不创建重复 Subject；另一包已等待或成功时能区分历史拒绝与当前影响。此调查没有运行写入性 fixture 或任何恢复动作。

范围提醒：SQL 按视频扩展名发现同类“outside_procurement_region但无 Control”记录共7条，其中上述6条已完成物理/包/接收链核对；另1条位置标签为“人生密密缝”，不属于这8个拒绝包，本次没有核实其电影恢复链，不将其直接计为第7部已确认受阻影片。其余非视频聚合也不能折算成电影数量。

## 证据边界

- 主库使用 better-sqlite3 readonly/fileMustExist/query_only，关键关系在只读事务中取快照；备份使用 Python SQLite mode=ro/immutable。无数据库全量导出或主库写事务。
- 只对精确八个已知目录做有界文件列举、stat、NFO读取和八份现存视频的中段256KiB指纹；因第一次输出序列化失败，只读取证脚本重跑一次，逻辑视频读取合计约4MiB。没有递归扫描媒体库，没有重跑产品观察，也没有整片校验/FFprobe。
- 同大小、中段指纹一致且 inode不同，是符合项目指纹合同的内容连续性证据，不是全字节一致证明。
- 原始 IntakeMaterialVerification 只保留通用 candidate_material_unavailable，未保留每个文件历史底层errno；当前八条原路径 ENOENT、历史迁移/Reset及备份能证明旧资料已过期，不能据此声称记录了当时每次系统调用的ENOENT或确定所有外部写入者。
- 未将这8项归因为最近镜像新回归，也未把source当前可读等同整个整理链已恢复。
- SSH与API凭据只从既有受保护配置在进程内读取，未输出或写入证据。原工作区与集成区未提交修改保持原状。

## 精确交付与验证索引

- **007：大破天幕杀机 (2012)**
  - Candidate：`candidate-package-8de6570ffe26968bbd2f1653e32c2fabcaed0912`
  - Offer：`8558d1d95cf09f9e83969c7f1aa4558a996983a9276b89a820bfc7cf9857da9c`
  - Decision：`00aa3e7c41b2f3facbcbfe7f0bf6a0ed1ea35679c09264f0c91843b4b1a9dd47`
  - Receipt：`d0edffb53b54c08ad061c3cff5b447ae3d46a325b2e9124bf29e82961081ae45`
  - Verification：`material-verification-7f5760392c51ce2c47e43599cbc2ff0b4d1a9e84`；digest：`7db8301d3d6e1fa91f21595c108e5c06ed413c8b6605294f4946e7ed0aba5f85`

- **老枪 (2024)**
  - Candidate：`candidate-package-7336a998780a4ec47ec3c2c875f52ca5ac07762d`
  - Offer：`e43e5aab5a089b69ad573739ca347d040713288f5963bad614485cebb2b99d3b`
  - Decision：`00e260a8c70083feaaff1e4fe80186586419f984e18cbdd780e91a44bdb0baf8`
  - Receipt：`4baade43efebd7313a49f46eed6edc9d5d02e7b7106b8309e44cafb05684b62f`
  - Verification：`material-verification-2d79503c81717070a7e8df100aa3d5a1150b47b5`；digest：`54871fc25f16c128d380557b838eab41a6b5e0c3780cc5f04be03c951075b54d`

- **绣春刀 (2014)**
  - Candidate：`candidate-package-f5d1977723d09c1778ddcbeb315c05393bf2bb39`
  - Offer：`7a4cdb45430cdce67b3779717a7097a8826214077d475451f66184fb2b5dbcb9`
  - Decision：`03a166e883ae4a3daacfe6f53baddb9d59f151f8874685b01d85dbde305d2226`
  - Receipt：`15b0a99e28e2d98df8bb9520d6c2801bb2925a82137c6b231c8fb891f613b010`
  - Verification：`material-verification-9cc07fdcadcfd51d16af71d33af5a939cd7e3e9a`；digest：`898a7a15faa4518023553ccbc8fe80859557096dd4eb519208c3ba6f877b71a9`

- **魔女 (2018).shelfdeck-stage-b0782dfc6713bc90**
  - Candidate：`candidate-package-327887370559efc3dd7fa7001e3096d855a353ca`
  - Offer：`13827ddcf099d7ae5a2ae7e1083f40ab010aa8d5edc8651a98c8b5165d6ae49f`
  - Decision：`03a4e415dedd69339258f427a842c3ae0826b9e8d541bb61c5ae2683e5de9b97`
  - Receipt：`6feb4bc3bcee055b0e76e52018c1024189e58aea5ece141e7cf86443c838db03`
  - Verification：`material-verification-8730f69874afefc0bfe8153c7a02d81f6b3fc41e`；digest：`b3baa29b8e701372e6d855c5e7761da6ba127e98a6afec6eb781f2b15f23eb9d`

- **静水城 (2021)**
  - Candidate：`candidate-package-e0d88eccb41bcb1c716c1789d71b3c1dbc7b40f0`
  - Offer：`14a4927d84dbb868ed26296480308d8e1188168acb1da17b94cc6452eccc58e0`
  - Decision：`03e127c06dcf371e9281c933347b04aa79b33f6729edc507e0767b6d98ac50a6`
  - Receipt：`353e81d0f9352145a433e32b2cef714e11a49ba6db06f86d083e06e6723dc091`
  - Verification：`material-verification-218c0844be2125ad65ac7b40b29171abe986710d`；digest：`0d05f4102c864ad11ecf50a86dab48bf4b5dc4a3f425a31e9e29b51e33dc0471`

- **恋恋笔记本 (2004)**
  - Candidate：`candidate-package-4a413e68f87fb2b84dac4059d813375712ffb0b3`
  - Offer：`29bf2bf7cc2265104442fde199d47ba96498198f6dcea72106d4aa6992756fbd`
  - Decision：`086b3bea6555d8799e4447eed4943f4b0e58e27254dc0b9b4c92c2c3dbf08ac9`
  - Receipt：`729a16102e324ba8a4ef1a7772a695a3ce71c07a6f06aea449806c3c256e2134`
  - Verification：`material-verification-40e9e088a1f968d0501fb1ace456fc06f047c055`；digest：`92033e9db5c5ad99c4fe63b0fa970e7f56c63e1c3495ee8c8027d714a445bd3c`

- **图雅的婚事 (2006)**
  - Candidate：`candidate-package-fe684f7dd1cbab433a0e7e1a8b301c8a1e0734a1`
  - Offer：`6da66002c748e2dbc839a7dd9b89419815273a6a82f6d1fa6a20cd655b852a42`
  - Decision：`08d77b681c8b922ff41c34d427b8989b872ce791a0e3e834d1b7d87b3e28411b`
  - Receipt：`d88dc3db1a9b3f957e2ec01e2512b9925ca40a6066e18dd8784032990ba529b6`
  - Verification：`material-verification-b378a7b53ed08330dda2a71195735157da23be60`；digest：`2c2b348aa12868201ffad0658f3edfc9a855f8c71e6ab8516c4c2c1866ffdb0a`

- **猩球崛起3：终极之战 (2017)**
  - Candidate：`candidate-package-ac5717c332e8a8dcde8e646e26c14da90884529e`
  - Offer：`3b14336a0cfa8ca88f9f243099980c7d51e84edb8300b8b13a5f65c6ed1de88e`
  - Decision：`093d9ba554b622cec2c8335acd43e8f3386a0752aa4e451a2144242b36e933e4`
  - Receipt：`9c14b2ca4a2aad8251559c2a24ddc5b04dc58acc103d0bf457b09ef0485b0aad`
  - Verification：`material-verification-5f46e613cbc25afde7b21ed84424ec009dc17a34`；digest：`728668bd84ce65b11a99068dd94aa31c4337b691fac471e65bbc75c44132610a`

## 本机原始取证索引

下列定向只读结果存于工作站Temp，未加入仓库；本文件只保存摘要与相关业务ID。需要复核时按时间与镜像身份使用，勿把快照当实时事实。

| 文件 | SHA256 |
| --- | --- |
| [02-rejections.json](C:/Users/markm/AppData/Local/Temp/shelfdeck-rejected-20260912/02-rejections.json) | `c4019a168b28b7070feb343086abe6e0fb1b9d8047eb165c364615ad8a0cf8ef` |
| [03-details.json](C:/Users/markm/AppData/Local/Temp/shelfdeck-rejected-20260912/03-details.json) | `f97652258fbd0a80af3789829f14f4e615a38034dc023ccd1dbd33d85dedf746` |
| [04-public-projection.json](C:/Users/markm/AppData/Local/Temp/shelfdeck-rejected-20260912/04-public-projection.json) | `ea8c6ee8a15da0f2118387afbafa090bd94072d233ea802a68eef1863dd87623` |
| [05-lineage.json](C:/Users/markm/AppData/Local/Temp/shelfdeck-rejected-20260912/05-lineage.json) | `07ca72a7375efbf7a9f27a55c2d7c29b13fa9837701f3e2616283385092ac348` |
| [06-current-materials.json](C:/Users/markm/AppData/Local/Temp/shelfdeck-rejected-20260912/06-current-materials.json) | `88553fa7b28b1047f25f8b339f9be9b771157a6514387f63222edbd1a9f72b16` |
| [07-history.json](C:/Users/markm/AppData/Local/Temp/shelfdeck-rejected-20260912/07-history.json) | `02eb944641df34ade4fca4645fe16e0f778f56a69af1262f79179f62af4ce379` |
| [08-stale-eligibility.json](C:/Users/markm/AppData/Local/Temp/shelfdeck-rejected-20260912/08-stale-eligibility.json) | `d9cb1f10589a69e0d4770a4f1daab606695a03535f3730f07c3fa51f8e6d372f` |
| [09-current-gaps.json](C:/Users/markm/AppData/Local/Temp/shelfdeck-rejected-20260912/09-current-gaps.json) | `5eeddf54ab412e3dea933bb104e5b69923d00cefaf9dc5cc23e96e0e20bb2f50` |
| [10-control-history.json](C:/Users/markm/AppData/Local/Temp/shelfdeck-rejected-20260912/10-control-history.json) | `4dd18ca756acb1dfb74ef8b9f187a86ad3c938ad66d8f79c859e27714f21d8ca` |
| [11-public-search.json](C:/Users/markm/AppData/Local/Temp/shelfdeck-rejected-20260912/11-public-search.json) | `415bc10b484bd885577ae9e373a82c01201be754161b7592a6d52b29096411fa` |
| [12-final-public-projection.json](C:/Users/markm/AppData/Local/Temp/shelfdeck-rejected-20260912/12-final-public-projection.json) | `c7493106017e3e92a8f9144be220df057f7251bba1f8f15472b219a71cfd8faf` |
| [13-release-verification.json](C:/Users/markm/AppData/Local/Temp/shelfdeck-rejected-20260912/13-release-verification.json) | `fed25028f13101e0a74190c3acb550ac4aaeabfe4e879a8794317c3a1b921ea7` |
| [14-last-validation.json](C:/Users/markm/AppData/Local/Temp/shelfdeck-rejected-20260912/14-last-validation.json) | `ab70a3f2d51c6330b5859f5b41c06aa07deb01171f3388447f7f5ac15bb9e220` |

代码复核入口（四份文件与生产 source c10e516e64 的内容一致；SHA见上方索引）：

- [Field计数公式](E:/my_project/emby_third_party-helix-iteration/media-service/src/helix/domains/procurement/application/field-procurement-status-query.js:204)
- [Intake材料验证与拒绝归类](E:/my_project/emby_third_party-helix-iteration/media-service/src/helix/domains/libra/capabilities/intake-capability-ports.js:39)
- [成功Observation后的资格重算](E:/my_project/emby_third_party-helix-iteration/media-service/src/helix/domains/procurement/application/procurement-automation-service.js:829)
- [精确Control变化入口与未完成Observation跳过条件](E:/my_project/emby_third_party-helix-iteration/media-service/src/helix/domains/procurement/application/procurement-automation-service.js:914)
- [Reset控制回滚](E:/my_project/emby_third_party-helix-iteration/media-service/scripts/helix-formation-reset.js:1027)与[旧交付重开](E:/my_project/emby_third_party-helix-iteration/media-service/scripts/helix-formation-reset.js:1081)

架构依据：[当前SSOT](E:/my_project/emby_third_party-helix-iteration/docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md)的4.4/5.4.1/6.3/8.6.18。历史恢复背景：[PROD-065](E:/my_project/emby_third_party-helix-iteration/docs/helix/implementation/evidence/PROD-065_ELEVEN_FORMATIONS_DEEP_AUDIT_20260907.md)、[PROD-066](E:/my_project/emby_third_party-helix-iteration/docs/helix/implementation/evidence/PROD-066_COLLECTION_CLEAN_BASELINE_20260907.md)。它们是 Evidence，不改变SSOT；本次没有新增活动计划或修改已有UAT状态。
