# 全站网络代理与 JAV 一键连接 — 2026-10-18

状态：本地实现与适用Windows验证完成；待具体版本UI审核，未部署、未修改生产配置。基线 `73edb3ac1`，独立分支 `codex/global-proxy-workspace-audit`。
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
- Linux实际候选验证、生产发布与具体版本UI负责人审核尚未完成；不把Windows或网络只读探测冒充这三项。

## 发布边界

当前只完成本地代码；用户本轮没有授权发布、生产网络配置写入、停机、Reset或删除Workspace。
全站policy初次启用必须显式保存现有代理值，恢复供给前核验；已有未完成JAV的route fence随policy变化可能失效，不添加兼容/续接。
本基线含原UAT-318未发布性能代码，不能直接视作可发布精确生产候选；后续整合需单独确定精确输入与资格。
跨层改动按Engineering Playbook §12.3须交具体版本UI负责人审核；本地浏览器结果不是该审核结论。

用户已于本轮明确允许发送具体版本给既有UI负责人审核；仅审核，不授权部署或清理。
