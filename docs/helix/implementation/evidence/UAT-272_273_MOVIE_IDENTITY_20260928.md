# UAT-272/273 影片身份修复证据

基线：生产1281d4dd76。用户明确授权两项修复，并指定同单元格按钮、TMDB ID浮窗预览。UI负责人已协调设计；部署由指定部署负责人统一进行。

只读现场：金都(2019)，Subject b4593d48e7da305d9e427a50e90da034528e4a58（libra-subject前缀），Run d03e057049d6d2b6a52a9d5146e42b6734a30b10996bd038af31258ce40f5e18。NFO无身份，Provider结果not_found/provider_no_match、候选0。独立查询query=金都/year=2019返回639445；主上映2020-06-11，HK首映2019-11-17。生产函数回放2019→0、2020/null→1；历史原始HTTP结果未保存，当前复现与历史持久结果区分。

用户任务：原下拉同单元格打开“手动选取影片身份”，输入ID后查询，预览片名/原名/年份/ID及海报，确认后正式核验；零候选也能进入。取消不写入，提交中防重复/关闭，过期Run要求重新打开，错误就地显示。九列表格结构和其他操作保留。

范围：Libra身份关联及Selection应用，TMDB协议证据，Admin facade/route，Formation局部UI；无跨Owner写入、无生产修改、无Reset、无架构所有权调整。验证结果待补；尚未发布或UAT关闭。


## 本地实现与验证

- UAT-272：TMDB详情请求包含release_dates；Adapter只返回有界上映年份证据，不作领域判定。Libra以精确片名/别名及任一有效上映年份核验，唯一一致才resolve；同名但年份仍不一致返回conflicting候选，异名不接受，多候选保持ambiguous。证据摘要包含Provider返回的主上映年/上映年份集合，不改正式主上映年。
- UAT-273：新增authenticated GET预览、135总路由/134 Admin路由；Run前置检查、纯数字正ID范围校验、404查无Movie、精确响应ID核验、固定图片域URL和DTO白名单。全fixture表快照证明预览前后无写入。正式选择继续保存immutable Intent及Receipt并经过exact验证，失败重试保持同一幂等键。身份观察的技术成功不再把not_found/ambiguous/conflicting显示为步骤完成。
- 后端身份/Formation Projection/API定向45项通过；追加ID边界后身份定向12项再次通过。
- TMDB集成/route/身份/状态定向31项通过，覆盖Provider首映年份、exact查询404、Secret masking/配置revision等已有负向。路由数增加引起的4项旧库存断言已同步，最终完整架构240文件PASS（原完整测试集1856项，9项既有skip）；Owner/import、语义、manifest、SSOT映射全部通过。
- 此worktree绝对路径较长，原架构脚本的240个绝对路径参数超过Windows进程参数上限。最终使用同一脚本和同一240文件，只在进程启动前把位于cwd内的参数转换为相对路径；无测试删减、无门禁修改。日志为本地ignored `media-service/.identity-architecture-final.log`，顶层ok=true。
- Web全量25文件/113项通过；UI负责人两处精简（零候选隐藏无作用下拉/确认；查询忙态只保留一处可见反馈）后局部18项再次通过，build通过。
- Playwright：1920×1080与390×844各1条完整旅程通过。零候选入口、非空候选原下拉、预览加载/错误/成功、取消零POST、焦点返回、Enter查询和正式确认都通过；9个列头宽度在新增按钮隐藏/显示对照中完全一致。迟到响应、改ID作废预览、同键提交重试、状态漂移及提交中关闭/ESC保护由交互单测覆盖。
- UI负责人于2026-09-28复查最终list/loading/with-candidates截图、代码与diff后给出本地UI放行；不等于生产验收。截图在本地ignored `.codex/identity-browser/identity/identity-selection-manual--18929-rom-an-empty-candidate-cell-{desktop,narrow}/`，含list/empty/loading/preview/error/with-candidates.png；可由`npx playwright test -c identity-playwright.config.ts`重建。

## 交付与未完成

用户已告知Docker Desktop恢复，Server 29.4.1已核实。交部署负责人从提交构建、Linux适用回归、标准发布和生产只读预览/界面复核。当前没有改写金都历史not_found，没有代用户提交影片选择，没有Reset或媒体文件操作。用户可在发布后输入639445预览并正式确认；新观察路径由上述自动年份核验修复覆盖。两个UAT仍保持开放，生产部署和业务验收后分别关闭。
