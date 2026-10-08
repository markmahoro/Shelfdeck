# Series外部Host发现与Movie回归修复

日期：2026-10-08；基线 `b37c88fc58431986edfd0dcba1e24260ea39215a`；当前Phase外部寻源及Movie发布回归工作项。

## 本批结果

完整隔离Series Host使用正式集成配置、SQLite/Coordinator/Provider适配器和真实临时文件；Provider网络与Probe受控。E01–E02共文件要求4K时，源观察提前进入Movie单成品路径，未携带Series Scope。修正为Series进入既有逐成员验证/完整Scope路径。Query Capability此前将Scope Work execution basis当作Run basis，导致搜索结果与Selection Criteria摘要不一致；现从Libra正式Reader读取所属Run，拒绝跨Run结果，Work/事件Fence保持。

Series搜索拒绝完整Host通过3.7秒：Search Work成功、候选not_selected、Run冻结、零下载POST、原文件存在、零Shelf Entry。普通两集Direct/Remux完整Host通过36.7秒。

Movie外部回归初跑4项中2项失败：后加工仍循环调用已取消的1..5候选参数，新Scope校验明确拒绝。改为读取唯一正式Import Work，不恢复多候选/重试下载逻辑。修复后真实Transcode和Remux上架分别45.1/38.4秒通过；同批未受此代码分支影响的真实媒体拒绝及native4k上架已分别4.1/39.8秒通过。网络仍受控，不等于真实MoviePilot下载验证。

## 用户决定保留的缺口

完整Series外部获取计划在EpisodeDelivery构造处失败：正式Run Episode Claim没有outputRequirementDigest；该值属于每个Material的正式Requirement。同集多个part可能有不同Requirement，不能从任一原成员取首值，也不能采用仅单元fixture存在的虚构逐集值。2026-10-08向用户提出完整有序Requirement集合摘要方案，用户选择“先保留此缺口，推进其他工作”。因此未修改SSOT或摘要语义；完整外部替换Host用例显式skip并标注原因，不能计为通过。范围/Import单元fixture既有自带字段不能证明正式Host可运行。

复现/后续入口：设置 `HELIX_SERIES_EXTERNAL=1`，执行 `node --test --test-name-pattern="external shared-file" media-service/test/helix-architecture/series-routing-run.test.js`。目前1通过、1合同缺口skip；取得对应合同决定后再启用完整替换用例。完整Provider获取、全Run终检、Promotion、实际Arca多目标审批/源结算/Commit仍未端到端通过。

## 验证与边界

- 外部模型/Scope/consumer/Query专项25项通过；媒体合同/路由/Coordinator边界32项通过。
- P2基线、包边界458文件/1450依赖、语义2077文件通过，diff检查通过。
- 本机Windows隔离运行；未操作NAS、未作生产部署；Linux/UI精确版本验收、内部策略耗尽寻源、Series外部后加工及其他Phase Gate继续。
- 原始日志在 `E:/my_project/helix-git-consolidation-20261008/`：`series-external-host-v2.log`至`v5.log`记录发现；`series-external-search-host.log`、`series-external-host-contracts.log`、`series-external-host-ordinary.log`、`series-query-movie-external-regression.log`、`series-query-movie-postprocess-v2.log`、`series-host-media-regression.log`、`series-host-p2.log`记录本批检查。失败记录保留，不改写为PASS。

## 暂缓决定被新授权替代（2026-10-08）

用户已明确确认按完整原Primary Requirement集合摘要推进，原“先保留”记录仅属历史。SSOT现定义每集摘要为`libra.episode-delivery-requirements@1`、episodeKey及按UTF-8 materialKey排序的正式Requirement集合；原Episode Claim摘要保持。Planner读取正式Run成员，不再依赖单元fixture虚构的逐集Requirement。完整外部Host的skip已去除。

启用后发现两处下游问题：测试Provider把合同字段`seasons`误写成`season`；Libra消费成功Import结果时把Event状态误作Attempt的`completed`，正式Event应为`succeeded`。修正fixture及Consumer，保留所有Scope/摘要/结果重构检查，并新增拒绝错误Event状态的回归。

合同专项Windows58项、Linux35项通过；状态修正后17项Consumer/Scope专项通过。完整外部Host验证仍在运行；尚未把这些局部结果记作端到端通过。变更前服务总测试619项中579通过、13失败、27skip，失败日志保留并待逐项核查。原架构回归运行中发生源码变更，仅作诊断，不计冻结SHA发布Gate。

## 本批端到端复验结果

- Windows完整外部替换97.67秒、Linux116.86秒通过：E01–E02原共文件经一次下载请求，正式获取/稳定性/身份/Package/Import/逐集验收/Promotion/Arca Commit完成，两个新Primary分别覆盖E001/E002，原Primary登记两个终结目标并按授权结算，Provider文件保留。网络与Probe仍受控、文件及SQLite/正式Host真实；不代表真实MoviePilot服务器或真实外部媒体解码。
- Windows合同及Provider58项、Linux合同35项复验通过；搜索拒绝/策略耗尽/技术失败路由3个Host通过。Movie外部4个Host通过（真实媒体拒绝、Transcode、Remux、native4k）。
- SSOT source map及派生合同按正式生成器刷新，P2/包边界/语义/diff检查通过；派生文件主要反映SSOT定位行号及索引摘要变化，无DDL变更。
- 失败过程日志保留：v1 fixture季字段错误，v2正式Event状态错误；不能把失败运行改记为通过。Linux初次验证同样失败于旧Event状态，v2才通过。
- 日志：外部证据目录`series-delivery-external-host-v3.log`、`series-delivery-external-host-linux-v2.log`、`series-delivery-contracts-final.log`、`series-delivery-contracts-linux-final.log`、`series-delivery-external-failures.log`、`series-delivery-movie-regression.log`、`series-delivery-p2-v4.log`、`series-delivery-guards.log`。
- 此次关闭原EpisodeDelivery合同阻断和基本共文件到分集外部上架验证；外部后加工/恢复、服务13个失败及其他Phase门槛继续。无NAS操作。

## 真实外部媒体基线

2026-10-08在`2a9be056b`上扩展同一正式Host fixture：设置`HELIX_SERIES_EXTERNAL=1`和`HELIX_SERIES_EXTERNAL_REAL=1`，执行名称过滤`with external shared-file replacement`。原共文件为真实1080p媒体，外部两集为FFmpeg生成的3秒3840×2160 HEVC/AAC合成视频；取消Host的媒体Probe与Playback替身，沿正式FFprobe/播放验证/Import/全Run验收/Arca结算执行。最终另经FFprobe检查两个实际Inventory文件的HEVC、3840×2160、AAC及时长，验证不需要Remux/Transcode，Provider文件前后SHA256相同。

Windows111.34秒通过，Linux118.70秒通过（32项仅名称过滤skip）；Scope/Consumer17项回归通过，diff检查通过。日志`series-real-external-host.log`、`series-real-external-host-linux.log`、`series-real-external-contract-regression.log`位于同一仓库外证据目录。Provider网络仍受控，短合成片不代表真实长片质量、真实MoviePilot集成或后加工能力；不改产品代码，无NAS动作。

后加工审查确认当前Series直接终结未达标Import，原成员加工Work不能代表导入Workspace成员。下一实现需绑定精确Import/Handle/Probe/Claims与逐集预算，并用加工后的实际文件重建完整替换映射；现有Movie后加工不得拿原Run成员伪装Series导入源。该缺口保持开放，见当前Phase DoR。


## 外部 Remux 接续与实际终结目标（2026-10-08）

在 `040cfc02e` 上补齐Series外部容器加工。Source来自完整重构的成功Import set，并冻结同Scope的Import Work、Handle/Probe摘要与原Run接受的Episode Claims；加工Work依赖该Import，不伪造原Primary Binding。空间basis包含Scope内全部共文件/part份额。Remux结果按精确Work/Attempt、正式事件状态与结果摘要重建验收和选择；只有完整set合格才附着成品，并用实际Workspace成品重建source-to-all-final映射及全Run终检。

真实Host以3秒4K HEVC/AAC MP4作为外部两集，正式规则要求MKV；两次Remux、零Transcode，最终两集MKV落位，原共文件只结算一次，下载POST仅一次，Provider文件前后SHA256相同。测试逐段核对Remux产物、Package Primary、Stage的sourceMaterialKey与目标physicalIdentity、当前Inventory。SSOT §8的StagedInventoryManifest明确区分Package源标识和Stage后物理标识，不能直接要求Offload目标等于Inventory目标key。

验证：

- Windows真实外部Remux Host112.66秒；Linux Docker/Node20为120.66秒，均通过。
- Windows/Linux各145项范围、原始成员加工、媒体合同专项通过，零失败/skip。
- Movie外部4项通过：拒绝3.67秒、Transcode45.70秒、Remux37.24秒、native4k39.23秒。普通Series Direct/Remux Host36.36秒通过。
- P2、package boundary（461文件/1475依赖/47包）、semantic guard（2080文件）及diff检查通过。
- 首次Host未触发Remux，因为测试规则允许任意扩展名；明确要求MKV后通过。新增直接比较Offload与Inventory key的断言双平台失败，经上述正式合同核对改为完整映射断言后复验通过。首次Linux专项漏挂scripts导致1失败，补齐挂载后145通过。失败日志保留，不作为产品失败或PASS证据删除。

日志位于仓库外 `E:/my_project/helix-git-consolidation-20261008/`，前缀 `series-external-remux-`：最终Host为 `host-mapping.log` / `host-mapping-linux.log`；专项为 `contracts-final.log` / `contracts-linux-v2.log`；回归为 `movie.log` / `internal.log`；检查为 `p2-final.log` / `guards-final.log`。

边界：Provider网络仍受控，短合成媒体不证明真实下载器/长时画质；外部Transcode、进程恢复和最终冻结发布Gate仍开放。没有产品UI变化、无需新增UI接受；未构建发布镜像、未部署或修改NAS。
