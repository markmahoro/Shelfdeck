# UAT-246 退出页按需读取与准备轮询

2026-09-09；基线bdde8f6d5。状态：部分本地验证，未发布、未关闭。

## 当前审查

原UX-030明确要求工作台Projection及preparing轻量读取。此前仅将500ms改为3s，未完成全部要求。当前首屏仍读候选、Case、完整当前收藏、完整历史收藏；不能因降频认定246完成。

## 已实施增量

- 创建Review、确认选择、确认高量级、重新申请审阅使用命令返回的Review直接推进界面，不再无条件重读四路工作台。先留着、取消及实际授权影响列表，仍明确刷新列表。
- preparing采用完成后再等3秒的单请求轮询，慢请求不会重叠；关闭、切换或离开当前Review后丢弃旧响应和旧错误，不会重新弹出已关闭审阅。错误仍显式展示，保留3秒后重试。
- 未改变不可逆授权或后端范围验证。

## 验证

- Web定向6项PASS，build PASS。新增模拟慢响应12秒只产生一次进行中读取；关闭后返回数据不重开，随后6秒不再请求；确认动作不增加collection/candidates/cases读取。
- Edge本地18195操作二次确认，正确显示最终确认删除按钮。按服务器真实请求记录差分，仅一条POST /v1/admin/offdeck/reviews/isolated-review/actions/confirm-high-volume，零追加GET；没有点击最终删除。证据 .codex/uat246-confirm-requests.json。

## 剩余实施与关闭条件

1. 在Arca现有事实边界内形成工作台所需摘要及显示身份，去除首屏全量当前/历史Collection DTO拼装。
2. 手动搜索按页、按需取结果；全选仍覆盖全部当前收藏并建立一个batch Review，不把一页冒充全选，不改为常驻整库表。
3. preparing只读取进度摘要，准备完成再取得完整冻结Scope；仍保留最新实际范围核对。
4. 补大收藏量、搜索、全选、准备、取消/重开及错误恢复的真实浏览器操作与请求验证，统一部署后验收。

本轮未发布；原Aftercare调查Evidence未触碰。相关143/139/224/232不因本增量自动关闭。


## 轻量准备视图与UAT-255 GET副作用修正

- GET /offdeck/reviews/:reviewId?view=progress仅按主键读取Review头，返回reviewId/state/createdAtMs三个字段；不取Reservation、Scope或材料。完整GET返回detail，双方均不调用准备推进、取消Aftercare Work或写Review。未知view显式拒绝。
- UI准备期只轮询progress；一旦离开preparing再读取完整最新Scope一次。无虚构百分比；此前慢请求不重叠、关闭后丢弃响应仍保留。
- 独立发现UAT-255：原Admin的review方法绑定advancePreparedReview，GET能触发取消及写状态。现行SSOT GET无副作用已明确，后台Owner准备器此前已存在，修正没有迁移Owner或增加新调度器。
- 16项后端测试PASS，覆盖progress仅一条find_review读取、GET不调用取消/协调、坏view拒绝、范围与材料安全；7项Web测试及build PASS，验证preparing仅小头读取、准备成功只补取一次完整Scope、此后停止轮询。
- 真实Host十部媒体链21.84秒PASS：读取progress响应严格只有三个字段；在隔离数据库恢复一个合法preparing检查点后重启，仅通过Session启动Host、直接只读DB等待open，不调用Review GET推进；随后二次授权、十部退出、范围外保护及再次重启快照验证全部通过。检查点为明确隔离注入，不宣称真实进程崩溃测试。
- .codex/uat255-unit.log、.codex/uat255-real-background.log。派生P2基线仍通过，API路径未新增；SSOT补充query及只读语义。
- UAT-255待统一发布/生产只读验收；246剩余首屏工作台摘要、按需分页搜索及全选完整性/真实大规模浏览器验证。两项均未关闭。


## 2026-09-09 部署后独立验收：UAT-255关闭

b2978c1512生产已取消审阅完整GET/三字段progress均200，非法view返回400 ARCA_OFFDECK_VIEW_INVALID；01:16至01:19前后持久Review逐字段一致，浏览器打开该旧审阅仍已取消且无授权按钮。16后端/7 Web与21.84秒后台不依赖GET、真实十部退出和再次重启链已通过。生产未创造preparing检查点，该场景由隔离真实Host证明。246首屏性能保持独立开放。

生产身份与发布校验见[发布证据](UAT_RELEASE_B2978C1512_20260909.md)。原始补验保存在`.codex/uat-acceptance-20260909-readonly.json`、`uat-acceptance-20260909-after.json`、`uat255-production-reads.json`及`production-monitor.jsonl`。未运行不相关的全套重复回归。

## 2026-09-09 首屏与按需查询实施

- Arca新增只读Off-deck Entry Query，使用现有Owner Repository DSL，不新增表、Owner、HTTP路径或删除权限。首屏读取开放建议一页、活动/完成Case各一页及Arca摘要/展示身份，移除完整当前/历史Collection DTO。建议、Case历史与搜索均可继续分页；不读取People、视频Probe、海报文件或完整健康详情。
- 全选在单个只读事务捕获全部active Shelf Entry ID，只在用户点击时枚举。前端只展示25条选择预览，但一个Batch Intent携带完整ID集合；搜索文本与分页不缩小全选。冻结Review仍完整核对每个Scope的文件、空间和共享引用保留条件，展示名称按明确ID有界读取。
- 搜索250ms防抖，旧响应/错误不得覆盖新搜索；显式重试成功清除旧错误。准备阶段继续三字段单请求轮询，关闭/取消不会因迟到请求重新打开。
- 17项后端测试PASS，含1005条SQLite事实、1000条完整选择、只水合搜索页、60条建议分页、Case分类/终态排序、坏cursor、旧Inventory排除与历史不可选。10项Web测试及build PASS，含1000 ID单Batch/25选择行、搜索迟到响应/错误重试、取消/二次授权与准备轮询。P2 contract baseline及diff check PASS。
- 真实十部链新增实际Host HTTP检查：workbench、search分页、全部selection ID、按ID display、Case分类查询均200且DTO精简；真实取消、独立高量级确认、十部退出、范围外哨兵与再次重启通过。最终36.71秒PASS，日志`.codex/uat246-real-chain-final.log`。
- 保留首轮失败：原测试仅等待12秒，尚未到30秒Owner兜底检查周期即断言open；诊断复验22.49秒通过，最终测试等待上限覆盖跨轮排空（90秒），只读progress。此处修正测试预算，没有改运行时cadence、虚构准备完成或扩大删除权限。失败及诊断日志保留在`.codex/uat246-real-chain.log`和`uat246-real-chain-diagnostic.log`。
- Edge 18197使用真实新查询代码和隔离1100条SQLite事实（1000当前/100历史）。首屏三路Off-deck读取分别165/81/7599 bytes、2/1/2ms；另有共享页面overview请求。搜索25条→更多50条；保持搜索词全选1000；仅创建一个模拟Review并显示1000个Scope；取消后刷新重开仍已取消且无授权。生产未新建Review。隔离命令仅模拟准备/取消并拒绝最终Authorization；真实媒体执行由前述Host E2E独立证明。
- 浏览器错误500→明确重试200，旧错误清除；退出历史可按页加载。原始请求见`.codex/uat246-browser-first.json`、`uat246-browser-requests.json`。最终部署和生产只读/浏览器验收尚未完成，本条保持开放。


## 2026-09-09 02:12 生产验收关闭

1a3f4254dc标准发布及17项Linux镜像测试通过；生产三路摘要355 bytes、70部完整选择与三页查询一致，真实Edge搜索→全选70→清空0通过，无生产授权。完整备份、镜像身份、真实媒体和浏览器限制见[发布关闭证据](UAT_RELEASE_1A3F4254DC_20260909.md)。UAT-246关闭，此前待发布描述仅是当时记录。
