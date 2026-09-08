# UAT-243：来源刷新重复读取分拣策略

2026-09-08 22:54；基线57a1cd325。历史UX-027标记已实现，但当前审查发现RoutingPolicyPanel在每个Field挂载时请求策略，且effect依赖activeShelves数组，来源3秒刷新重建Shelf数组会使全部策略重读并覆盖草稿。不是单纯增加轮询间隔就完整修复。

## 本地修正与验证

策略面板首次展开才挂载编辑器并读取该Field策略；同Field来源/Shelf快照更新不重载策略或覆盖草稿。切换Field卸载旧编辑器，取消迟到响应应用。读取失败时不开放发布控件，用户可明确重新读取；不默认为空策略继续发布。已读策略revision仍由发布命令CAS核验，不绕过冲突。

新增3项Web回归：折叠不读取/刷新及重开保留草稿、失败不发布且手动重试、旧Field迟到响应不覆盖新Field。Web64项及构建通过。

本地Edge真实浏览器访问18192三个来源的扫描fixture：

- 4轮来源读取间隔3061/2989/3002ms，折叠策略请求0。
- 展开来源0，实际HTTP仅1次`/v1/admin/routing/material-fields/field-0`，其他两个来源未读策略。
- 选择收藏架B作为未发布草稿，点击刷新，选择仍为B；策略累计仍1次。
- 扫描完成后自动轮询停止，48秒后的第五次来源请求由实际刷新按钮触发。

网络请求证据来自接收浏览器HTTP的只读fixture日志`.codex/uat243-browser-requests.json`，不是单接口耗时；fixture`.codex/uat243-routing-preview.cjs`拒绝非GET。日志`.codex/uat243-web.log`与`uat243-build.log`。

## 剩余范围

尚未部署，243保持开放。来源列表扫描仍采用既有3秒整表刷新；本批消除Routing逐项放大与草稿覆盖，不声称已经建立新的后端来源Projection。Intake席位读取仍随活动Field逐项请求，需独立核对真实来源规模下的成本及合适有界投影；不得以本地三个来源通过代替生产Network验收。


## 统一发布候选（23:00）

独立干净发布工作区从d24f13b3db构建`helix-beta-20260908-d24f13b3db`，561766912 bytes；tar SHA256 `5e940240c8230666caf6fca5b1074685349865650c129fef9a7fd4b802c29157`。标准upload已上传到NAS项目根且校验一致，标准deploy dry-run已生成，未apply。隔离Linux容器仅挂本地数据库/凭据副本，network none，无生产媒体挂载；12个GET均200，readiness ready，退出0。候选同时包含212等待/终态说明修正及128测试增量。

生产仍696b122da4，FFmpeg正在执行；当前不切换容器。最终apply前必须刷新在飞状态、做新一致备份及标准readiness，不复用旧快照授权部署。日志`.codex/uat-release-d24f13b3db-{build,upload,dry-run,linux}.log`。
