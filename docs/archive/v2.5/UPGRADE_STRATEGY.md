# ShelfDeck v2.5 Upgrade Strategy

v2.5 的核心策略是：保留 v2 已验证能力，替换 v2 最影响性能和边界清晰度的中枢。

## 1. 为什么不是 v3 全重建

v2 中最贵的资产不是代码结构，而是生产行为细节：

- FFmpeg/FFprobe 参数、设备选择、partial 文件、replace/verify/cleanup。
- MoviePilot 下载、刮削、transfer、staging path 和取消逻辑。
- 成人库 JAV/欧美成人刮削、People、NFO、封面、目录整理。
- delete flow 的路径安全边界。
- task approval gate、pause/resume/cancel/interrupted/startup recovery。
- Admin Web 依赖的一批展示字段和状态语义。

全量重建会把这些细节都变成重新实现成本。v2.5 选择不重造这些能力，而是先把它们纳入更清晰的数据、事件和投影边界。

## 2. v2.5 的目标

### 架构边界

把 v2 中混在一起的概念拆开：

- media item facts
- task current state
- task/event history
- flow execution
- resource scheduling
- projections
- diagnostics
- Admin Web read model

### 性能

优先解决：

- task 列表不应加载全量历史 payload。
- media library 列表不应重复全量计算。
- scheduler 不应每轮做大量无意义 IO。
- space stats、metadata status、optimization status 应走轻量投影或索引。
- Admin Web 页面应读取明确的 list/detail projection。

### Admin Web

基于新模型重整 service Admin Web：

- 媒体库字段语义更清晰。
- task 状态和 flow/event 细节区分清楚。
- 配置页按真实能力边界简化。
- diagnostics 不混入媒体库字段。
- 用户能理解一个 item 是否已经被 ShelfDeck 处理完成。

## 3. 保留 v2 Flow 能力

v2.5 第一阶段不重写这些执行器：

- `transcodeFlowExecutor.js`
- `upgradeFlowExecutor.js`
- `scrapeFlowExecutor.js`
- `deleteFlowExecutor.js`
- `ingestFlowExecutor.js`
- `services/transcodeService.js`
- `services/moviepilotService.js`
- adult library / People / scraper 相关服务

这些模块先通过 adapter 进入新 task/event/projection 模型。

## 4. 新增而非替换

v2.5 优先采用 additive changes：

- 新增 event journal，不立即删除旧 task fields。
- 新增 projection 表或 projection cache，不立即删除旧查询。
- 新增 read model API，不立刻删旧 API。
- 新增 resource view，不立刻重写所有 flow。
- 新 Admin Web 页面可以先读新 projection，旧详情仍可透传 v2 字段。

当新模型稳定后，再逐步切换读取路径和删除旧路径。

## 5. 对 v3 文档的关系

`docs/v3/` 中的业务概念、数据分层和行为保全仍可作为背景参考。

但 v2.5 的实施目标比 v3 更收敛：

- 不做全量重建。
- 不复制 v2 功能。
- 不把 desktop/worker 纳入本轮主动重构。
- 不在第一阶段替换复杂 flow executor。
