# 全站网络代理与 JAV 一键连接 — 2026-10-18

状态：本地实现、适用Windows验证及12a4b4030具体版本UI审核完成；未部署、未修改生产配置。基线 `73edb3ac1`，独立分支 `codex/global-proxy-workspace-audit`。
工作项 `GLOBAL-NETWORK-POLICY`；用户确认全站统一代理、JAV列表/一键测试启用、不提供逐站覆盖、明确错误原因。
生产 Workspace 只读调查独立见 [UAT-322](UAT-322_WORKSPACE_RESIDUE_AUDIT_20261018.md)。

## 设计与实现

用户在系统设置首个「网络代理」卡片设置一次；已有 TMDB 代理仅预填待保存草稿，不以 GET 写配置。
TMDB 卡片只保留语言和凭据。JAV 展示八站适用范围、启用数量、逐站结果及一键操作；失败后保留成功站，支持重试和独立停用。
网络设置读取/保存失败可原位重试；错误不回显远端正文。显式私网 IP/loopback 的 MoviePilot/Emby 保持直连。

Platform policy 复用既有 platform_integrations 行和 Admin Integration 路由，拥有独立 CAS/idempotency/Receipt；无 schema migration。
全部产品 Integration 的 Composition 注入统一 transport，Provider 内部传入的 dispatcher 不可覆盖它。
`node:net` 仅用于 Integration 传输层的纯 IP 分类，已加入该 package 的标准库依赖清单，不引入跨域权限。
JAV当前Handle取实际全站route digest；测试后改变route则拒绝旧Proof，Observation返回前复验Handle，不为旧Libra添加续接路径。

## 验证记录

- 专项 network policy + JAV runtime：22/22 PASS；真实SQLite持久化/重建、CAS、幂等、显式关闭代理、旧Proof/Handle拒绝、逐站覆盖无效。
- TMDB与H1其他Provider受影响组合：此前组合55 PASS/1失败；唯一失败为新增测试误传未定义fixture transport，后修为正确fake.fetchImpl，专项已复验；最终受影响Provider组合56/56 PASS；另增真实Admin HTTP网络设置鉴权/GET纯读/保存/敏感地址错误1/1 PASS。
  首轮两项旧错误DTO断言按新增安全stage/status更新后已通过；不是忽略失败。
- Web：192/192 PASS；构建通过。宽1920/窄390实际Playwright：2/2 PASS，覆盖唯一代理输入、非法地址、键盘保存、单站403、7/8部分成功、重试8/8、无横向溢出。
  最终反馈语义色及reload清除旧结果变更后已重新构建并完成宽窄2/2复验。截图位于ignored `.codex/jav-browser/`。
- Service整轮首跑636 pass/29 skip/2 fail：两个失败均为本worktree缺tools/node_modules/ssh2；连接现有依赖后整轮复验647 pass/29既有skip/0 fail（676 tests）。
- Package boundary/forbidden semantics/manifest/P2 baseline全部PASS；SSOT修订后曾明确拒绝sourceDocumentDigest漂移，按标准materializer更新source-map来源digest并复验，未改合同内容/计数/aggregate。合同计数121 Capability/104 Result family/210 tables/51 canonical transactions/149 routes不变。
- Linux实际候选验证与生产发布尚未完成；具体版本UI审核见下方最终结论。不把Windows或网络只读探测冒充Linux/生产资格。

## 发布边界

当前只完成本地代码；用户本轮没有授权发布、生产网络配置写入、停机、Reset或删除Workspace。
全站policy初次启用必须显式保存现有代理值，恢复供给前核验；已有未完成JAV的route fence随policy变化可能失效，不添加兼容/续接。
本基线含原UAT-318未发布性能代码，不能直接视作可发布精确生产候选；后续整合需单独确定精确输入与资格。
跨层改动按Engineering Playbook §12.3须交具体版本UI负责人审核；本地浏览器结果不是该审核结论。

用户已于本轮明确允许发送具体版本给既有UI负责人审核；仅审核，不授权部署或清理。

## UI负责人首轮审查与修正

首轮明确审查6e0ed6147冻结资产：暂不通过。三个问题为：初次读取失败误报未配置/0已启用；新增代理校验/错误/成功与JAV读取错误缺统一语义样式；代理常驻说明及JAV横线不符合既定卡片规则。负责人补查宽窄6项通过/2项失败，部分成功、重试、明确错误、敏感正文不回显、键盘与停用通过。

本任务随后修复：网络loading/ready/failed及JAV未知状态独立建模，重新读取时清旧计数；恢复后才显示真实启用数量。
代理字段校验/错误/成功使用form-error/form-notice，状态使用integration-state语义配色；删除新增常驻说明，JAV八站改用既有ui-card样式。
Web194/194、构建及宽窄Playwright4/4通过（新增读取失败→重新读取恢复）。实际查看新宽屏部分失败及窄屏/读取失败截图；无生产操作。
重新冻结资产：index-tHnP8hEx.js SHA256 550c64c9418eeb0f72cb06f542a0bfee26db325dcf6845280b599f7added842a；
index-CJdUcY3I.css SHA256 3985683645dcfdfe58b7501901cd4d552d8bfecc88ca8f12440d7833f0c83864。
下一步仅复核本轮修正，不将首轮失败追记为通过。

## 第二轮复核与独立读取修正

3aac01450的三项显示修正经负责人确认；额外独立性检查仍拒绝：全站设置成功、仅TMDB 503时，Promise.all仍把网络卡判为读取失败并禁用保存。首轮10项通过、2项新失败，未追认为通过。
随后将全站设置与可选TMDB草稿解耦：已有全站policy时不读TMDB；首次配置的可选草稿失败只给可操作反馈，不禁用全站编辑/保存。generation围栏防止晚到草稿覆盖用户编辑、保存、重读或卸载后的状态。
新增三项Web回归（已配置全站独立于TMDB、可选草稿失败不阻断、晚到草稿不覆盖编辑）及宽窄真实浏览器独立失败旅程。
最终Web197/197、构建、宽窄Playwright6/6通过，等待新具体版本复核。Backend最终Provider组合58/58通过，新增覆盖真实网络设置Admin API鉴权/只读GET/安全错误，以及Cover403与Page503安全stage/status；UI资产绑定另见下述冻结记录。Service647/29的整轮基线未因最后安全DTO补充重复运行，最后变化由58项相关组合覆盖。

## 最终UI审核结论

用户任命的UI负责人任务 `01a0912a-0086-74e2-88ab-536c59d3862a` 于本轮最终复核通过 **12a4b4030**，
turn `01a14cd3-3f9c-7d82-9bf1-a56fcfc73fdf`：宽窄屏20/20检查通过，无剩余本次UI阻断项。
全站设置独立于TMDB、可选草稿失败手填、晚到草稿不覆盖编辑/保存/重读、批量连接与部分失败重试、反馈样式及卡片均通过。
最终冻结JS `index-VYacCH4j.js` SHA256 `dcdd2596c392c71b5881c3374d9a1fdadce7bc2b36f212a9f0a0bc796a55aaad`；
CSS `index-CJdUcY3I.css` SHA256 `3985683645dcfdfe58b7501901cd4d552d8bfecc88ca8f12440d7833f0c83864`。
前两轮不通过及失败证据保留，不能回写为旧版通过；本结论不代表生产验收或Linux实际候选资格。
本任务末次只读复核生产仍 `markmahoro/shelfdeck:bfd97f36a`、RestartCount0、health ok/normalSupplyAllowed=true；没有部署、配置写入或清理文件。
