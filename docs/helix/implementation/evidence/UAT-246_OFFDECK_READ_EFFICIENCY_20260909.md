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
