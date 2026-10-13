# OPS：安全停机与用户Formation Reset

2026-10-13。所属唯一Phase：OPS-CONTRACT / OPS-RUNTIME / OPS-RESET / OPS-SURFACE。用户确认开发两项能力及Reset默认“全部未完成整理，确认前显示清单”；本轮仅开发与本地隔离验证，未执行生产停机、Reset或媒体重处理。

## 合同与实现

- SSOT §10.1.6及§9.7.3注册运行控制与5个Admin端点。使用原Foundation供给/派发/Owner/Outbox生命周期，没有新增业务Owner、资源管理体系或单任务Pause。
- stop先持久化stopped意图，关闭业务写与新后台派发，等待既有Event、Recovery、Owner收口、Outbox delivery及已经受理的异步Admin业务命令。在线停机没有60秒硬超时；信号退出仍有原60秒checkpoint预算。HTTP、鉴权、只读管理查询继续可用；重启保留停机意图，明确resume通过Recovery Gate后才恢复供给与业务写。
- Reset只在停稳后提供服务端清单；actor-bound幂等键、previewDigest及confirmed=true冻结确认，不允许客户端传路径/SQL/Subject范围。独立Operator worker复用既有typed Reset闭包；主业务runtime不import raw Operator SQL。
- 用户范围为active Subject的active/suspended/frozen Run、尚未建立Run的Subject及pre-Subject Intake token。已结束Run/history、正式收藏、配置与来源文件保护；清理闭包交叠已结束历史、已有Commit、范围外引用、未知文件Effect或不能归属的孤儿责任时阻塞，不扩大删除或谎报成功。文件来源扫描、已入藏维护、Off-deck及外部下载不在此范围。
- 先备份数据库、内部伴随文件及选定工作区，SHA256、source drift、integrity/FK、容量、symlink与注册Workspace可达性检查完成后，再次检查冻结清单并持久化pendingReset；随后才执行精确删除。备份存于dataDir/operator-backups，与清理工作区分离。Linux同步文件及目录元数据；Windows使用原子文件替换及文件flush。
- 成功刷新受影响读模型、保留备份并保持stopped。备份失败不会开始清理；清理中断留下备份引用和error，禁止自动Resume，须由Operator检查；不自动猜测回滚，不开放恢复出厂或灾难恢复HTTP入口。

## Windows本地证据

已运行，不按加总当成互不重复测试：

- Foundation/真实Node Host/route/entrypoint等第一批：66 pass、2既有skip。第二批Formation/overview/Owner cursor/边界guard/运行控制：61 pass。后续改动的受影响项再验。
- 既有Reset工具、用户Reset及H1路由/集成回归一批57 pass；用户入口额外补历史交叠/孤儿阻塞测试。
- 全Web Vitest：29文件、150 pass；TS/Vite构建通过。
- Playwright desktop 1440×900及narrow 390×844：4 pass。覆盖正常运行→停机等待→停稳→只读预检→列表/后果/checkbox确认→Reset结果→明确恢复；失败重新核对、阻塞与取消；键盘Space/Escape、焦点恢复、无横向溢出及dialog Axe零违规。API受控fixtures用于状态覆盖，不冒充生产链路；真实Node HTTP生命周期由service测试独立验证。
- 浏览器截图/轨迹：ignored `.codex/ops-runtime-20261013/browser/`。截图人工检查后发现侧栏仍写“正常运行”；已修正为读取同一Runtime Operational Projection，并重跑全Web及4项浏览器走查通过。

## 待完成与适用边界

具体代码SHA、Linux精确镜像测试、打包审查与跨层UI负责人结论待补。本轮未做生产升级/停机/Reset、NAS真实媒体上的长时FFmpeg停稳或断电演练；没有宣称避免所有NAS磁盘/SMB事故。停机不能解决服务外部下载器持续写盘、目录失联或已有语义缺陷，只为升级提供停止新工作、等待收口和保留停机意图的正式边界。

## 81be4df6e平台验证与UI审核补项

代码81be4df6e4f1db3fc3f0fc0e9f39796cbe6a723f标准build-image.js构建通过：tar562239488 bytes/SHA256 82cf1232229c6bd698d59b9163ed9a5b3e28d31e19f9adae3b6fe8f0e734ecbe，Docker manifest sha256:e89135b7046ca20e64a0ea900e69a4d840360627c90c2fd2514719dcc7fe8e58，config sha256:fe6b7465f1d8fb6ace432f6e590a9c73a2a01cf129fa32791dc8f2ad0545261a。Linux/amd64 Node20.20.2精确镜像80项全部通过；临时容器--rm，/transcode与/tmp隔离tmpfs，不挂载生产媒体。Windows包清单包含两项clean adapter及两项Operator worker脚本、既有Reset工具，未构建Electron或Windows完整分发包，客户端接口未改。

浏览器直连本地真实clean Host（fresh独立数据、动态端口）完成登录、安全停机、停机收藏GET200、空Reset禁用、关闭进程后重启保留停机、明确恢复及health.normalSupplyAllowed=true；PASS且productionTouched=false。脚本/截图ignored .codex/ops-runtime-20261013/native-browser*，任务服务、浏览器及临时数据均已清理。Windows与Linux该版JS/CSS SHA256相同。

UI负责人对81be初审提出首次Runtime未知时侧栏提前显示正常、另一会话恢复后弹窗确认未失效两项，实施方复核并修正。后端从未开放非stopped Reset旁路；本轮增加UI未知态、运行mode/revision变化使清单确认失效、重新核对及取消旧checkbox确认。受影响Vitest13通过；desktop/narrow Playwright增加首次延迟与跨会话变化，6项通过。旧版150项全Web结果保留，补项最终版全量及UI结论待补；不沿用81be为最终产品资格。新截图ignored .codex/ops-runtime-20261013/browser-v2/。

## 最终候选f65de6370资格

候选代码f65de637048527e1a2522254968f28d65d20996d。全Web29文件152 pass；desktop/narrow六项浏览器测试、TS/Vite通过。标准build-image.js镜像markmahoro/shelfdeck:f65de6370，tar562240000 bytes/SHA256 3338dc08bdba0849e6c1c29e910c788903cec8c63d71a0d519444a1191614e8a；manifest sha256:32eb7cfe730fd0cdf1e413a95b9f2285ee7509646b4df50a62fbda42aad21a76，config sha256:b84a007583cd14a4bdf809cb2de742c492d491845fa3c9953a5dc1f5a7568a8c。最终Linux精确镜像80/80 pass（日志ignored .codex/ops-runtime-20261013/linux-f65de6370.log），Windows真实Node浏览器同一最新版资产再验PASS，服务/浏览器/容器已关闭。

Windows与Linux资产逐字节一致：JS index-CVl_PTf-.js SHA256 313e665a3080e00d335fd655c5abb0ea66731190d3e0acbc59ec488a2775a31a，CSS index-7ohtn-Hr.css SHA256 e16827842f55de18944deb7a2dcc18c48b280333b05f4ff6a43105c5dd74849a。UI负责人在原版本实测确认两项问题并保留证据，已请求f65具体版本复验；最终结论待补。

## UI负责人独立审核：81be问题保留，f65功能复验通过，配色待修

2026-10-13。按Playbook §11.1/§12.3和Beta §7.1审核具体版本，不修改产品、生产或Phase/Status。本负责人冻结81be与f65的git archive，在独立动态端口加载真实编译Web。浏览器API为受控fixture，仅验证呈现及交互；真实Node HTTP测试单独验证生命周期，二者不拼接为真实非空Reset生产链路。

81be实测问题：初始Runtime读请求挂起时，概览卡片显示“正在读取运行状态…”，侧栏提前显示“正常运行”；另一会话恢复运行后，旧清单checkbox和“确认 Reset”仍可提交，后台409明确拒绝；Runtime读取失败时旧确认同样可用，且弹窗内没有读取错误。未发生清理，但用户表面不一致，不追认81be UI通过。冻结目录 `E:/my_project/helix-git-consolidation-20261008/ops-ui-81be4df6e-20261013/`，源码ZIP SHA256 `3ffafb3acd2f7997e7bdb1c49d585f17344601cbb6ba0232fe60ec568b7f5f9d`。`reviewer-ops-evidence.json` SHA256 `3abf0fb5f87c013f53d338fe69fd7605b74bc515cf64783b0b06f609ac303d8d`；截图01–03保留三个状态。首轮脚本误期待弹窗内已有读取错误，因此停止；按实际侧栏读错误继续完整复现后v2完成。没有改变产品以通过旧版测试。

f65功能复验结果：

- 初始Runtime未知时，侧栏和运行卡片均保持读取中，Reset禁用。另一会话恢复后，旧checkbox被清除并禁用，确认禁用，弹窗显示停稳前提；重新停稳并提升Revision后仍不能使用旧确认，必须重新核对，新增一次预检GET，checkbox保持未选。整个失效路径没有Reset POST。
- 运行状态读取失败时，弹窗内直接显示错误，旧checkbox与确认禁用；取消后可重试读取。运行卡片不把错误继续画成处理中，也不把旧stopped快照作为当前已确认状态。
- 从正常入口安全停机，显示来自Projection的真实等待3项；侧栏同步“正在安全停机”，未完成前Reset不可用；停稳后恢复/Reset入口可达。Reset确认展示两项具体标题、工作区后果及8条收藏/已结束历史/来源配置保护，必要确认不属于常驻教程。
- 正常Reset提交只含服务端previewDigest、confirmed=true和幂等标识；pending期间卡片和侧栏显示“正在 Reset”，完成后显示清理两项并保持停机，再经明确恢复显示resuming/running。没有百分比或ETA。
- Space勾选、Escape取消和焦点回到原入口通过；实际减少动态效果样式为none。Reset中断/恢复备份Projection显示具体错误，恢复/重新停机入口不出现，Reset不可用；恢复资料按需展开，不常驻展示内部备份编号。0页面异常。
- 最终f65冻结源码两个Web专项文件13通过、TS/Vite通过。独立JS/CSS SHA256与实施方记录的Windows/Linux资产相同。81be冻结源码的运行控制及真实Node HTTP两文件8通过、0跳过；f65服务源码与81be无diff，沿用该结果，没有冒称在f65重复执行服务测试。受控浏览器等待用来覆盖状态，不是生产延迟资格。

已目检主任务desktop/narrow确认与等待截图，及本负责人f65截图01–04。剩余配色缺陷：`App.tsx`把Runtime error与stopping/stopped/resuming/resetting统一标为rail的maintenance；既有CSS没有该分支，默认正常绿色。Reset中断截图中的“运行操作未完成”因此为绿色，违背既有异常/等待语义配色。要求沿用faulted及中性状态样式，不改业务事实或其它页面结构；此项修正前不作最终UI门禁通过结论。

f65冻结目录 `E:/my_project/helix-git-consolidation-20261008/ops-ui-f65de6370-20261013/`；源码ZIP SHA256 `b749321a74b4566af99157f26c1d51d34d97ab192f5e43c53db2d908903d5250`；脚本 `reviewer-ops-ui.cjs` SHA256 `fec895feb7c24b51d7cae3ac98cc8944a4beb787456b239230d2f1caaff7b9a5`；最终 `reviewer-ops-evidence.json` SHA256 `e78c4f54ac1cdb17875d2a0f03fdcb5524232928b270ba0f148ab3a9c8ca43df`。隔离浏览器与HTTP服务已关闭。

本负责人未复跑完整152项、Linux80项、真实Node浏览器或长时FFmpeg停稳；这些保持实施方独立证据归属。本轮没有NAS停机、Reset、升级、真实来源副作用或断电演练，也不覆盖UAT-318响应性能。界面准确反馈不能代替实际Effect收口、备份/删除闭包证明或生产授权。

### UI配色补项

负责人确认f65功能路径复验通过后，发现Reset中断的侧栏继承绿色正常色。实施改为error使用既有faulted错误色，停机/恢复/Reset过程使用既有中性色；新增desktop/narrow真实computed color、中断无Resume/无重新停机、恢复资料默认折叠检查。此补项仅UI呈现，不改变停机或Reset语义；新具体版本验收及精确镜像身份待补。

### UI负责人最终接受：0bcaf5a11

2026-10-13，UI负责人接受 `0bcaf5a1128c2aebb38c8507df5c75f7c565a250` 的安全停机、恢复及用户Formation Reset受影响表面，**本地开发的具体版本UI门禁通过**。沿用f65已通过的完整功能复验；与f65比较，产品仅改变App的Runtime error语义及polish.css的maintenance配色，RuntimeControls、API、Owner Projection和后台执行代码没有diff。81be的初始未知/旧确认问题及f65配色缺陷保留为历史，不追认旧版本通过。

从0bc精确git archive冻结源码独立TypeScript/Vite构建，通过。隔离Chromium分别在1440×900与390×844读取受控Runtime Projection：每个视口覆盖starting/running/stopping/stopped/resuming/resetting/error，14个状态均通过实际DOM kind和computed color核验。运行正常为既有绿色 `rgb(146, 208, 172)`；启动、停机等待、停稳、恢复与Reset为既有中性色 `rgb(190, 201, 212)`；异常为faulted错误色 `rgb(240, 180, 180)`。均保留可读状态，不仅靠颜色；不新增业务状态、解释段落或新的按钮形制。

中断态同时核验卡片/侧栏及具体错误一致，无恢复运行或重新停机入口、Reset不可用；恢复资料默认折叠，展开后可读。使用实际UUID形状的备份编号，两视口展开前后均无页面横向溢出。已目检desktop-error、narrow-stopping等截图，0页面/HTTP fixture异常；只执行GET及本地折叠交互。隔离浏览器和HTTP服务已关闭。主任务八项desktop/narrow路径是实施方的补充证据，没有冒称本负责人重跑了整套或真实非空Reset链路。

冻结审计目录 `E:/my_project/helix-git-consolidation-20261008/ops-ui-0bcaf5a11-20261013/`：源码ZIP SHA256 `ef43b69c7af5133e871dff4b73cf0eef04f420b82de3a13ad4a4298f4c3afc65`；`reviewer-colors.cjs` SHA256 `044828f7ce8dae9917afc2d567b3739c23510d090031883836df487fde7a5584`；`reviewer-color-evidence.json` SHA256 `7821c4b0534c7822844f7589dc0d121bb1e10396235785d7fbc42fb54c8e74b2`；`reviewer-colors.log`及六张截图。独立Web JS `index-rAg9PJaT.js` SHA256 `4c9b0a7023039e7ac82ae115f18de3f4e51acfe8da8d799a8fb0ec6ec041f523`；CSS `index-BWsa6Lzd.css` SHA256 `a4d47e2cdba83f8c36801f17848e668716793985135c3e95897e2c2382dbe8ea`。

上述接受限于具体版本的UI及已声明本地验证。最终镜像/Linux资格由实施方独立记录；本负责人没有部署、生产停机或Reset，也未把界面fixture当作真实NAS备份、清理或长时媒体收口证明。后续若有用户表面diff，继续按实际变更及Playbook §12.3处理。

## 0bcaf5a11最终镜像与Phase Exit审计

最终产品SHA 0bcaf5a1128c2aebb38c8507df5c75f7c565a250。标准镜像markmahoro/shelfdeck:0bcaf5a11：tar562240000 bytes/SHA256 1141879eda514155d66a029081af8fb041d5c9173ed95b2271ca3d60d0a2a168，manifest sha256:e74efc789bbc5435f364db1f1cf456802f8dd15a0c69712bed54accf4e77a8ab，config sha256:852253ade094cf6122004d50a8602ab9752435b41de107639a152a3eff345064。最终精确镜像的真实HTTP与用户Reset核心包装专项6 pass、32按test-name过滤skip，无失败；日志ignored .codex/ops-runtime-20261013/linux-0bcaf5a11.log。未将过滤skip当作覆盖。其/app/src及/app/scripts共2138文件聚合SHA256 75540a17af222a6fb8f3ddcf3a969205d4305f95d1bc423c685ae84daaab5cf0与f65已验80项镜像逐字节相同，因此继承后台证据，不重跑无变化的全部测试。

最终Windows/Linux资产相同：JS index-rAg9PJaT.js SHA256 4c9b0a7023039e7ac82ae115f18de3f4e51acfe8da8d799a8fb0ec6ec041f523，CSS index-BWsa6Lzd.css SHA256 a4d47e2cdba83f8c36801f17848e668716793985135c3e95897e2c2382dbe8ea。8项desktop/narrow浏览器通过，包含中断恢复门禁及实际语义色；最终颜色补丁只影响呈现，TS/Vite通过。f65的全Web152、真实Node浏览器及后台80证据按无变化范围继承，不追认已失败81be旧UI。

UI负责人任务01a0912a-0086-74e2-88ab-536c59d3862a对0bc明确复验通过：正常绿色，停机/恢复/Reset中性色，异常既有错误色；中断无恢复入口，恢复资料默认折叠；此前两项状态问题与一项配色问题均已修正。负责人具体版本记录见本文“UI负责人最终接受：0bcaf5a11”，commit73547f3a4。

Exit从SSOT §9.7.3/§10.1.6反向审查：停止意图先落盘；新业务写、Event/Recovery/Owner/Outbox供给受既有生命周期约束，当前责任收口；HTTP/认证读在线；restart不重放文件Effect；resume显式并经Recovery；Reset不经业务Repository直删，隔离Operator采用exact typed闭包、已结束/Commit保护、未知Effect及范围外孤儿阻塞、完整备份后再持久标记、失败不假成功/猜测恢复；UI清单/后果确认、真实进度、失效及可达错误路径均有Evidence。没有新增Owner、全局媒体ID、资源管理Store、强制停机或目录恢复自愈。OPS-CONTRACT/RUNTIME/RESET/SURFACE已达到本地开发验收目标。

边界：未部署、未执行生产停机/Reset、未重处理五项媒体；未做NAS长时FFmpeg/断电演练和Electron完整分发构建。外部下载器继续写盘与目录失联、已存在的媒体语义缺陷不会由安全停机自动解决。未来生产升级和真实数据Reset仍分别需要相应精确授权，开发Exit不代替生产验收。
