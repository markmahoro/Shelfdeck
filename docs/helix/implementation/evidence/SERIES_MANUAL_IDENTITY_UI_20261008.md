# Series 人工身份界面与隔离上架

2026-10-08；当前 Series Phase 节点1/4，基于`9c948e39f`，随实现同提交。沿已确认的Series ID＋冻结Season合同和既有UI负责人Series设计；不声明负责人同版本接受。

## 结果

Formation按正式contentProfile显示影片/剧集身份操作。人工查询对Series发送tmdbSeriesId；预览显示后台返回的正整数Season，不能编辑季或集。确认只携带Series ID、Run/Identity fence和幂等key，不上传Season或Episode范围。错误Movie响应/无效Season拒绝展示可确认预览；既有迟到响应拒绝、输入变更失效、失败重试及过期状态保护保持。列表候选选择按Series ID提交，成功反馈区分Profile。空态改为媒体通用。

身份弹窗窄屏尺寸按可用视口约束，修复96vw加外部padding造成的右侧越界；没有改动Formation表格列数或列宽。

## 证据

- 前端26文件124项通过，新增Series预览/确认、错误类型与Season拒绝、HTTP互斥ID及不提交季/集参数断言。
- Series浏览器1920×1080与390×844均通过：正常Formation入口、输入与取消、失败再查询、预览季数、确认、焦点返回、候选入口；Axe受影响弹窗零违规，表格9列宽度保持。Movie同路径双视口2项回归通过。
- 目视检查窄屏Series预览；修正右侧越界后新增边界断言复验通过。截图位于ignored的`.codex/series-browser/series-identity-Series-man-55d9e-rozen-Season-from-Formation-{desktop,narrow}/preview.png`。
- 新隔离Host：环境`HELIX_SERIES_MANUAL_IDENTITY=1`，测试名结尾`with manual Series identity`。正式Field观察后仅身份搜索返回no-match；从正式Formation HTTP读取待处理Run，经GET预览和POST选择，验证Run basis/Material Manifest未变，随后走原Direct/Remux、Metadata、Arca接纳/结算/Commit断言完成唯一Season Entry上架。36.9秒通过；真实SQLite/Host/HTTP，Provider及计算沿既有受控fixture，不宣称真实公网TMDB或真实编码端到端。
- TypeScript/Vite构建通过，123 modules。仓库外日志：`E:/my_project/helix-git-consolidation-20261008/series-identity-ui-vitest.log`、`series-manual-identity-full-host.log`。

## 未完成

Formation本批Episode范围投影、Collection逐集旅程和Series命名预览继续；同版本UI负责人验收仍待完成。EpisodeDelivery Requirement摘要缺口按用户要求保留；整体首版部署资格、Linux/Docker、完整升级回退未闭合。未操作NAS。
