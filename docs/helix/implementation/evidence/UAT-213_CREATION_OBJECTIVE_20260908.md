# UAT-213：维护创建目标快照

2026-09-08，基础创建快照与原Target Binding已随696b122da4部署；下述早期“未部署”均为当时快照。23:40新增非媒体目标展示尚未发布，未验收关闭。

- Arca创建CareRequirement时冻结有效要求的规范JSON及digest、Inventory/Standard/Placement revision、Decision Fact Set digest及已知正片总字节。使用原有Case原子持久化，不增表、不倒填旧Case。
- 执行与显示的finding枚举排除target/basis/source元参数，防止目标JSON被解释成新问题。旧Case缺快照明确未知。页面显示保存的体积/编码/封装目标，不重算当前Policy。
- 定向16项PASS：含真实Coordinator建单请求、序列化后Policy变化、历史未知、超限/缺失/篡改拒绝。全量216个architecture fixture文件及dependency/semantic/manifests/contracts Gate PASS。首次失败来自测试上下文未提供Standard，补足实际输入后通过。
- Web现有50项PASS；新增目标展示回归后care-workbench 6项PASS。页面不会同时声称有目标与未保存上限。Web build已通过；最终整合后仍需重跑编译及真实浏览器验收。
- 尚未完成：生产新Case持久化与策略变化全链路验收；Placement具体路径/非媒体要求的可读目标完整性继续核对。251新增修复意图合同仍未实现。不能把以上局部实施等同本项关闭。


## Target迁移实际链路补齐

真实H264链路在目标目录改变后发现原Settlement错用当前Shelf root/mount revision校验旧源。Arca新增不可变Shelf Target Binding记录：创建保存当时tuple；修订在current head CAS事务保存旧、新tuple，失败整体回滚。仅保存实际事实，不回填历史流程或改写旧Case。Aftercare从Case原Inventory/Material Receipt选定旧源，再按同Shelf/endpoint/mountScopeId最多100条候选读取唯一覆盖路径的Binding；匹配不唯一、缺失、摘要损坏和越界拒绝。Handle construction和Effect前复核使用该原Binding，并保留原、新Target根目录，仍逐成员验证Approval/Physical Identity/最终成品及未知成员。

源绑定表不是当前Target，不创建新业务Owner或迁移Flow；SSOT与派生物已同步，当前189 tables、113 Capability、99 Result family、45 Canonical Transactions。标准升级只建立空表，现有Shelf Entry、Inventory revision及在飞Run原样保留；不在启动时猜测来源。未来Target行政修订可在CAS内记录其确切prior head。

本地33项迁移/Settlement回归通过；222文件架构全门禁通过。真实隔离媒体两项合并101.3s通过：UAT-215后台收尾/重启，完整人物记录→NFO/海报修复→Target迁移→收尾→重启→失败保留→Off-deck。后续再补不可变Binding条数重启断言及缺证不重试回归；完整Service复验运行中。仍需生产与用户可读Placement目标展示验收，不关闭213。

最终本地复验：Service串行529项中510 PASS/19环境SKIP/0 FAIL；所跳过的隔离媒体长链另行运行69.8s PASS，含Binding创建1条/迁移2条/重启仍2条断言；UAT-215独立媒体链也已PASS。24项Settlement/负向复验通过。当前仍未部署。

创建目标展示补验：新Case另存完整Target/Placement规则JSON与摘要，旧Case缺证保持未知。14定向及222文件门禁PASS，Web59/build PASS；Edge详情显示创建时根目录/文件夹和命名规则，390px页面与366px对话框无横向溢出，视口恢复。真实媒体维护链70.1s PASS。仍待统一部署验收。


## 23:40 实际创建目标不可变与非媒体目标显示

真实 one-movie Host 链路新增逐字节断言：前两次 NFO/海报维护的完整 CareRequirement JSON 在后续 Target 修订、第三次迁移维护及 Host 重启后均不变；两旧 Case 保留原目录/revision 1，新迁移 Case 保存新目录/revision 2。GET care 精确 Case 投影也保留旧目标。链路 70.97 秒 PASS，无跳过。

用该真实 GET 返回体在本地 Admin Web 展示，发现页面只显示 `videoCodec any/container any`，遗漏 NFO/海报及人物资料要求。已改为展示保存快照内的具体媒体约束、必需资料和资料字段，去除不限制的 any/none，去重 metadata/inventory 的重复资料要求；不读取当前 Policy 倒填。65 项 Web 测试及 Web build PASS，Edge 页面已显示 NFO、海报与演员/导演等实际创建目标。

基础快照和 Binding 当前已部署；此次 UI 修正未包含在 d24f13b3db 候选，必须重新绑定提交构建后再做生产浏览器验收。旧生产 Case 缺历史证据仍明确未知，不为验收新建生产故障或修改影片。本项尚未关闭；251未决的修复意图仍单独开放。

原始本地材料：`.codex/uat213-real-objective-chain.log`、`.codex/uat213-real-case-projection.json`（真实隔离 Host DTO）、`.codex/uat213-objective-web.log`、`.codex/uat213-objective-build.log`。未修改生产数据。
