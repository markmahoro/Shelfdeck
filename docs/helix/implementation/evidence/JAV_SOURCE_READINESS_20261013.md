# JAV 来源真实可用性与准备证据

日期：2026-10-13（Asia/Shanghai）。工作项：JAV-SOURCE / JAV-CONTRACT / JAV-IDENTITY-RECOVERY。ShelfDeck代码审计基线`da23711dd`，Reference冻结`c4cfe61188234dd24c75b53b42b054327fef3e58`。来源叶子探针、文档/引用及独立来源基础子合同本地实现/测试，不是完整Adapter、正式Host、媒体加工、UI或入藏资格。

## 用户决定与此次判定

- 首版按类型选有序来源，**单站title+可用cover成功，失败换站**；日期/片商/分类/演员等选填，不阻断。不跨站拼字段，也不为填满选填项继续查备用站。
- JAV321不强制，参考Yuukiy/JavSP，多分段不做。studio可保留FC2 seller / GETCHU-GYUTTO circle的角色与来源。
- 用户最新简化为Libra首次正式确认后锁定番号，不支持执行途中改号；未确认时仍允许在工作区交互区反复补填、查询、预览和选定。取消未实现的核对等待门禁，已入藏Arca纠正范围保持。
- 用户进一步确认首版含已上架后保留视频的身份纠正，由Arca拥有；不借Aftercare改Canonical Identity。当前用户旅程及typed门禁在唯一[Phase](../CURRENT_PHASE.md)；上位合同在[SSOT](../../TOP_DOWN_ARCHITECTURE_CONFIRMATION.md)末尾。
- 来源title+cover不能代替稳定番号/唯一影片身份；搜索回显、canonical回填、错号/截断、HTTP200或只有可解码图片都不能独立确权。本文只记录实际探针Evidence，最终Adapter必须重验同站主内容及图片关联。

## 方法与网络范围

只读Reference源码、未运行外部应用、安装其依赖或复制执行器。探针使用service已安装的undici/cheerio/sharp，HTML最大2 MiB、图片16 MiB、HTTP hard timeout、逐跳host边界及32 Mi-pixel实际解码；无视频/媒体下载。页面按UTF-8或EUC-JP解码；原HTML/图片及JSON保留在ignored `.codex/jav-source-20261013/`，不进入Repo、日志或产品Fact。

用户授权使用代理`http://192.168.12.230:7890`，未更改该服务或NAS。基础四份图片通过NAS代理，备用/grammar图片在明确的独立直连探针通过；多份相同URL在NAS有connect timeout而直连成功，不能宣称全站down。产品必须声明/freeze route，不能把这些对照探针变成Executor内自动绕过代理。

声明的图片host逐项验证：c0.jdbstatic.com、contents-thumbnail2.fc2.com、dl.getchu.com、gyutto.com/image.gyutto.com、666.9989641.xyz、pics.dmm.co.jp、www.caribbeancom.com、image01-www.heydouga.com。Gyutto图片301到其image子域后HTTPS200；没有TLS绕过。HEYDOUGA封面为WebP，Probe实际解码/派生JPEG，不能以.jpg命名原WebP字节。

本机127.0.0.1:7890并非可用代理：只读观察到Windows portproxy指向自身、出现reset/timeout及大量TIME_WAIT，停止使用，未更改配置。该组失败不用于判定站点。NAS proxy证明多个来源可访问，也不能证明每个来源/出口地区均合格。

## 来源矩阵

| 类别/来源 | 实际结果 | 新标准下的结论 |
| --- | --- | --- |
| JavDB/IPX-177 | 搜索一条exact，详情匿名200，主品番/标题与封面800×538解码通过 | 单站叶子成功样本 |
| JavDB/MIDV-001 | 搜索两条exact，两个不同resource均详情200 | ambiguous负例，禁止首条自动成功；初次同样本文件名覆盖了一份HTML，摘要仍各自记录，后续Probe改为URL hash独立命名 |
| JavMenu/IPX-177 | 主番号、标题、声明370×337封面解码通过 | 同站备用样本，不拼JavDB字段；Reference旧selector不适配当前布局 |
| FC2/FC2-718323 | 官方article canonical与主description iframe/thumbnail绑定718323，title及1280×720图片通过 | 单站成功；seller等选填，不需要跨站补片商 |
| JavMenu/FC2-718323 | 主品番/title、声明图片解码为200×200 JPEG | 可解码不等于人工确认真实封面/适用性；不作为替代官方全资格。不存在测试asset返回403，不证明该200×200一定占位 |
| JavMenu/082713-417 | 主番号/title及884×505封面通过 | 单站成功；缺studio/genre不再是失败 |
| Caribbeancom/082713-417 | 主Movie JSON的movie_id精确对应，h1/title、player声明cover800×450通过 | 独立官方单站样本；评论中的2013-08-27不是发行日期，原提取误判已纠正；不靠日期号推发行日 |
| MUGEN/IBW/T28 | JavMenu的MKD-S148、IBW-398Z、T28-557主品番/title与图片通过 | 缺studio/部分genre在新标准下不阻断；只证明这些实际编号 |
| RED/SKY/EX/K | RED030、SKY066、EX0010、K1095主品番/title与图片通过 | RED-030/SKY-066/EX-0010使用封闭系列别名；不能全局去横杠。EX0001仍无主资料 |
| HEYDOUGA/JavMenu | 查询4030-2113但主品番只返HEYDOUGA-4030 | identity_mismatch；canonical full URL不能补造缺失第三段 |
| HEYDOUGA官方 | 主player sample scope与canonical均4030/2113，h1/title及声明960×540 WebP通过 | 官方完整三段单站样本；不请求sample视频 |
| N | 新增JavMenu/N1230：主品番/title及820×462封面解码/裁剪通过；N0001无cover，N0002无主资料 | 新样本单站叶子成功；NASreset、独立直连成功，route不能隐式切换。JavDB搜索一条exact /v/OpeD8，详情connect timeout，备用未通过 |
| 259LUXU | 新增AvWiki/259LUXU-1022：主厂家品番/MGS品番/canonical/product link一致，title及840×472封面通过；593直连仍404，JavMenu旧两号无主资料，MGStage区域403 | 新样本单站叶子成功；NAS相同页HTTP200但无主资料/图片，不把壳页当成功，不把主站区域失败当声明CDN图片失败 |
| T38 | T38前缀搜索发现25条精确grammar记录；T38-071/072匿名JavDB主品番/title及各自1000×673声明封面解码/派生通过 | 两份新增单站叶子成功；旧T38-001无exact负例保持；JavMenu072=429，071无主品番/title/cover，备用未通过 |
| CID/FANZA | 新官方ipx00177/ssis00698两URL在NAS均200但同一28723-byte壳页、无主身份/title/cover；独立直连connect timeout；已读取页面声明的公开content-page脚本但未运行它 | 旧parser不兼容；JS存在不等于已读产品详情，不猜API/番号/地区或login原因。CID→真实番号桥接仍缺资格 |
| CID/JavMenu | hjmo00214重定向HJMO-00214；新增ipx00177重定向IPX-00177，均无合格主影片/card fields/cover | 不因URL“归一”声明强映射。JavDB的ipx00177 NAS挑战，直连有完整站点导航却无候选/映射；通用challenge-platform字串初判为挑战已纠正，不提升身份资格 |
| DL.Getchu | GETCHU-4052694主item identity/video type/title/560×420 cover通过；4016932现404 | 前者单站成功，旧样本失效不是全站不可用 |
| Gyutto | GYUTTO-242158主item/video/title/560×420图片通过 | HTTPS有效；circle资料可选保留角色 |
| JAV321 | 多次direct/NAS POST/GET timeout | 不再必选；保留source_unavailable，未证明永久不可用 |
| 其他候选 | JavDB FC2/日期详情login；FC2PPVDB/JavLibrary/Airav挑战；Avsox script shell；JavBus driver verify；镜像证书/reset失败 | 用户无JavDB Cookie，未登录/绕挑战/关TLS；这些不列为合格备用站 |

JavDB补充搜索MKD-S148、IBW-398Z、T28-557各一条exact，但详情timeout/挑战；搜索成功不等于备用资料成功。Caribbeancom历史JSON endpoint经www HTTPS返回404、旧b域timeout/HTTP downgrade，未取得可用JSON，不以已知旧API存在升级资格。

## 字节与派生结果

下表所有摘要为SHA-256。page digest对应实际原始响应，cover digest对应声明图片原始字节，poster对应忽略AI/水印、EXIF归一、右侧高宽比1.42裁剪的实际输出。新SSOT冻结整数71/50规格；这些尺寸的探针裁剪与整数规则一致，但探针不是正式Renderer contract测试。没有人工逐图审阅，不宣称像素内容真实性或全站覆盖。

| 编号 / 独立来源 | 解码尺寸与原格式 | page SHA256 | cover SHA256 | derived poster SHA256 |
| --- | --- | --- | --- | --- |
| IPX-177 / javdb | 800×538 jpeg | 1d51036027f1d905c063071ac464670634b4ff3a53751e70846ed081e9795cda | 70d5edb1819ba5aebff8ef1a07970178ca06ccf28c1baadb7a4afd282716ee4b | 45e0a31b1526cb3c4d0a61bd3baea10f9677c5e9a0a119e15cbd7780e28e3f9e |
| FC2-718323 / fc2 | 1280×720 jpeg | a6de1b94d4b829a7a723fc581db18ecca039d6218c8d3d52b037e80a3443fe1e | 783d518b1262ebe65b5341c4cacaa7b49fb5f2259a0f99c60a6f60787f29db63 | dcda16d7c0d973af0a39d688e57f2230ea4a5ba7ec05f033b91d8d2a5566d9d2 |
| GETCHU-4052694 / dl_getchu | 560×420 jpeg | f3b979729b1b568eba54cdb8b0b9e82ad0536564671ced1222f662eae53d1c49 | 19dab70a85e8e31948414bd120ed5c9743c0c54a1076145a7928173a982378fe | 682b5e2edfb6c692dda4a8d907dd8783afc7a4dacd171788de8fa5914c2120a9 |
| GYUTTO-242158 / gyutto | 560×420 jpeg | cb8898352c484f33f6470d6bb0ac5f94873a82b2e15d5392c92164e14e5ba6e8 | c6d5f1bd87cb3b75e42a95516bec85acf762818aa9d5f00886fa354c9ac93506 | caba4e1a9dabb0dc98998fd90965135529ef54cfc95c8099f867235bd039dc7b |
| FC2-718323 / javmenu-fc2 | 200×200 jpeg | 10610079c1b44518d138d0888e2848b9cf301f3fe68792e88e9bee1e4f82dde0 | 238a87f3b3700152bfdc9fdc60aec25e7c3cacc78ec140e9a4c8a25bc8010f33 | 95ed6a72496c5f27a6dc61809d8c5cfd1ee16d8ab30a3c0fe6e011255d3a1ecc |
| IPX-177 / javmenu-normal | 370×337 jpeg | 8cd7c78f705b69c5e05061e95a4c4225dc410d1cb9f70515856e56df40d28674 | 2680e57990ff2768b533e2261728c5e5455cc02e4b8d488a3adc74fc49fcd5ca | d8238dd53ab8ac416fb208db599a24a3c2d21b377885bca97e99667eebf1a81d |
| 082713-417 / javmenu-date | 884×505 jpeg | 047a92d1bcdf60344571992cd04f80e490913992f11a5db461e091cb8c4a4ae8 | 81f3c3fcd03e10ef69f70ad02e21996eb33f7f0c7bdd1862f853f62794bed970 | d61859994523da7543bb3c9eae4eba67af1bc5dcf0a6c0bccb6db1f39b766a4e |
| 082713-417 / caribbean-page | 800×450 jpeg | 3faf821db9b2d6baa00dd4694339cb77018aa1733f3fdc5cd19751633b17b4b1 | 44572adcaca0405c7de1cf62a051ab2c5cdac638f20333bc14a8b139dfd5734c | a61f8c0e3682d85035da2616642daf72f22659b666db7a7d879d67144b6166b9 |
| MKD-S148 / javmenu-grammar-MKD-S148 | 884×505 jpeg | b0b32e92fe97cd0c7d8d2e8bf36be4b92f84539f5a14486d522bda58bd559ec3 | d010c46bbdb3b95b9fe87dbc56eedea24f223fc6428f2cdf96d25904a8c891ee | 524c0e9a3be379cb3a0766ddafd0e8674a98d7dd7e0660de46f260da1746ee5f |
| IBW-398Z / javmenu-grammar-IBW-398Z | 800×538 jpeg | 76c43f9ab572a54198cad1dc699e82cee9e73e98668fc0cea876340c9a7c4f56 | 9ebe79f3c00ad50505dcb0a2881b70212ec710185ac1709e3f3e4580ba7d2a0a | c95ecf3fcb5934eb1da189bee015c1cfbb10cf384056d1a43e198feb4413253f |
| RED030 / javmenu-grammar-RED030 | 800×638 jpeg | 7141086a86ff04c32b1fec453fd596b7b51ea1359848bf420b97e93854628886 | 6b1a83b7ad72f97b67a1538ac6f88a33774aa5650f7101be49fd52efcca7e7e6 | 3a170e772ecd0b747e59a5c4befa8a1c655fd6ff29bad623d8d6e7144e82d151 |
| SKY066 / javmenu-grammar-SKY066 | 884×505 jpeg | 10c352d6fbad8717114f6a1239d387ba0b41dec39913f8fed147b864a16872a0 | 498a763683d1e07a5a6860069a2213340888b244c6398e38ea988e395284063d | e6b0d8a3f2c7ab1d5ad998d5b175bab571b2e032e00976ed510323b7cff76b99 |
| K1095 / javmenu-grammar-K1095 | 820×462 jpeg | 1bd8ff52bfb12af46cec2041b0df9a893d031cd31c10a122ea368e1b593823b1 | bdb309ad75fa8ca095c7373f3497e887f93df81eead6f3e58fe0ab61a923aadd | cae37f2f7095703413e192da28bf136ebcce36d483b7bbf6fa58611050be3519 |
| T28-557 / javmenu-grammar-T28-557 | 800×538 jpeg | 604c6ce4bc39b5746297a7de59a765d4fcdf3e7349f00171f4ea355c3cf711ac | deae1a42c24cbd986e10802179780c9c75287083968834e9ff808f2e006f93ee | c1ae0f49241e35f0f259cf2d91064d10c07e44be5598f1ced77ed49fbfa7ac70 |
| HEYDOUGA-4030-2113 / heydouga | 960×540 webp | 9763b8ce6c1decd1dfe2a303221038ba61c46d9c270e44f295ebe1bca1542326 | 8038ad1fdeb3fd720fe3a90779deaeca3930a52116fbb05e444425038b18de0b | b8bd35c65219eebcd634efa56a68d7e9e725a458908d118e89403aa6d9411646 |
| EX0010 / javmenu-alternate | 820×462 jpeg | 6982b11dee687609650553405e20d95445092359b10ef7769a790d42cba04d09 | 7763b9e1405e995f8c43ef0ac61f51e00a0552d38b2f26f1c3b340e65e2d837f | f156d7cf44613cdd8f84e7621303762e7aa0bd29383ad939046eae7bc04c87eb |
| N1230 / javmenu-n | 820×462 jpeg | cb8ea46fa69c66dc54b98db71675842f2dafe78f24eaa79c70894f9066e61a18 | 10c396111b8784a7157f4406a2c8231d4a710123929c14719b7bb6800820589a | 800b8f4c39f5febed83b8f9db5b5a61e1a5794f9a12bd6a1c75ab7b52f1cae05 |
| 259LUXU-1022 / avwiki | 840×472 jpeg | 2f4e001ebcf4be823af8646df1a5c4d6cf42b922a29c28fe502c8bcce3294244 | 33890a8e01035eab3dfbc75c461a5dbeef77cd1a3a33d6b1a9f0292f58b5b0e4 | 6c97d75e4b45a1e0d37d5264a26fc79c90cda0ec628de8ad61cc93062a1dd7c1 |
| T38-072 / javdb | 1000×673 jpeg | d2bf555bd126aec83e481c0d5a737bf915d6c84f4769188d16acce00a8abe163 | 785c9682d10dfb13a790af492e5e7109c74a925394f10528fb8e5842af71a7bb | 053bb9a6dec8e1ca60b3f7fdba9b9e12a4f16a07723e02948ddf8ee44c7e0195 |
| T38-071 / javdb | 1000×673 jpeg | f679975c54b54c48f1546b167a45fc21f402f036eab70021540d8ec462ae1835 | 407e0044941ce9d3ab17b60712decdaf01dc06ee5aa552708dffaefc9882e47b | 76c034b93b4101ddcefcd1d24ec7c6f4343a5976a3c7d9098c25a937590c0787 |

每份原图和派生图均进行full decode。对应crop rectangle、byte count、HTTP trail及字段presence/digest在ignored原始探针summary；选填实际标题/演员等不复制进Evidence。来源current response随时间可变，未来执行必须独立查询，不从这份Evidence补造产品Fact。

用户接受未确认身份旅程后的补充轮新增N1230与259LUXU-1022，两份独立来源解析/原图/派生结果均在ignored probe summary；现有字节表共18行。AvWiki按完整主品番、MGS品番、canonical及主文章的精确MGS产品链接绑定，不用外部搜索摘要或CDN文件名单独确权；image.mgstage.com是该页声明CDN，已实测HTTPS200并完整解码。参考旧593样本仍404，不因新号成功改写负例。NAS返回的无h1/图片壳页不作为主内容Evidence，直连结果不扩大为生产代理资格。

## 负例与探针修正

- FC2不存在article返回HTTP200但没有主article/description/thumbnail；不返回“成功”。Getchu无效item返回404。
- 主品番错号、三段截断、两个同号resource、CID URL猜映射、无封面及挑战/登录分别保留，不伪装成technical success。
- 首轮通用captcha字符串检测误判了可用JavDB搜索，改为title/实际gate与DOM结构，不把工具误判写成来源失败。
- Gyutto分散在多个BasicInfo dl的字段首轮漏提取，改为遍历明确dt/dd；image redirect主机另行核验。release/genre现在选填，但parser问题仍不能隐藏。
- JavMenu新class含px-1/px-md-0，Reference exact px-0 selector失效；先绑定带主h1的col及left-wrapper/card，推荐影片列表不参与主身份。HEYDOUGA的品番缺第三段是实际来源问题，未用canonical掩盖。
- 多请求同source/sample初次保存文件覆盖，已用初始URL digest区分后续HTML；未保存的首份HTML不宣称可回放。

## 文档/机器检查与未测范围

原Windows准备专项：37项，35 pass、0 fail、2 skip（旧JAV公开纵切）。不因网站title+cover通过取消这两项skip或计入产品功能PASS。

准备初轮SSOT Source Map及P2 contract baseline同步后通过，原P2 aggregate为2da8328724e77634ef8ac8a910b31569234d3896eef02f0fb0547e997dbadf37、findings=0。当时414份既有contract JSON剔除source locator及其派生摘要后与HEAD业务结构一致，5份当前文档本地链接无缺失，git diff --check通过。后续来源基础子合同已改变IntegrationHandle schema与shared registry digest，不能继续把当前全部diff称为trace-only；目录仍113 Capability / 99 Result family / 200 Table / 45 Transaction，source资格/首次Fact/Correction typed闭合仍未完成。

未运行：正式JAV Host/FFmpeg/上架、完整Service/Desktop/Linux镜像、实际Admin页面、Correction/Perception/Effect/crash qualification。没有生产读取/部署/停机/Reset/媒体重处理，没有新UAT、版本名或release tag。

本次用户旅程定稿及两类来源补测后，SSOT source-map check与P2 baseline复验通过、findings0；5份当前文档本地链接、18行SHA256格式及git diff --check通过。机器目录仍未新增JAV/Correction variant，这些检查不能替代节点1 typed传播或功能资格。

继续轮（来源基础子合同）：独立Anchor/Source Snapshot在SSOT冻结后进入本地机器实现，并将anonymous/secret JAV IntegrationHandle闭合分支传播到现有shared registry/schema；未接Provider resolver/运输或正式Fact。T38新增两份解码Evidence，字节表现20行。P2 aggregate更新为5fd2804cb07c64ca3223f5a0255117421b67909e6ba1904a0ed59ca8a77ee83b，结构/count/ref校验通过。初次扩展回归77 pass/1 fail，唯一失败为过期aggregate快照；复查批准的Handle schema及此前source refs变更后更新固定期望，P2三项与dispatcher五项复验通过，既有严格schema/负例断言保留。来源基础9项通过；完整Source qualification Result/Effect及身份事务仍待闭合。

最终Windows专项：9个文件合跑84 tests，84 pass、0 fail、0 skip，27.47秒；涵盖JAV source contracts、shared/domain/result schemas、P2、P4 dispatcher和H1 Provider ports/Secret fences。随后复查Reference发现无Z的IBW可由普通grammar独立识别，将本合同ibw canonical pattern限定为可选Z并保留有/无Z的不同完整号码，9项源合同复验通过；只改变grammar/anchor摘要，不改变IntegrationHandle/P2 schema摘要。该fixture是词法证据，不额外宣称无Z实片来源资格。此纯JS合同切片未运行完整Service/Windows packaging、Linux Docker/desktop或UI；没有新增依赖、Provider运输、生产配置或媒体副作用。原始网络/图片/测试log均ignored，当前可追溯的业务diff是source helper/tests与IntegrationHandle builder/schema/registry、固定P2快照。
