# Series节点1：逐Primary源媒体探测

日期：2026-10-01。代码提交：`51d8ab8d018321f6c754eb88c4f7313c8e90e6ed`。本文件是实施Evidence，不是另一个活动计划；工作项与DoR在[唯一Phase](../CURRENT_PHASE.md)。

## 结果及边界

实际隔离Host已从Field执行到Routing、Spec、Series身份、逐集Metadata、Workspace Artifact、原生Fact，继续完成2/24个物理Primary各自的Source Probe Work。不存在Foundation Work/Result/Identity种子注入；Provider、源媒体Probe和海报字节仍是隔离fixture，不能等同真实Series媒体验收。

这一批只完成源媒体观察。`libra.product_media.verify`、逐Primary选择/Remux/Transcode、完整Product Package组装、Handoff B与Arca Commit尚未贯通；节点1继续开放。原有Direct Planner把整个Run交给单文件Source Scope，Package assembler要求恰好一个Primary，仍是接续实施缺口；不能通过放宽stream_file的单文件约束或取第一份Probe隐藏它们。

## 合同及实现

- 沿用SSOT §3.4.4–§3.4.6、§8.6.7和PBF-20的冻结Run/Manifest及物理成员合同；没有Owner、Handoff、副作用权限或Capability Schema变化，不新增SSOT业务决定。
- `ProductionSourceScopeResolver`从正式Libra Reader复验同一execution basis、Run Manifest、Spec与完整成员快照。Series按materialKey的UTF-8顺序重建Primary集合，保持每个成员的完整Claim Set；共文件和多part不按Episode展开重复Probe。
- Source Planner为每个物理Primary声明独立`shared.material.media.probe@1` Event，Plan owner binding冻结`materialKey`与完整Reader member JCS digest。Projection必须命中同一成员及Binding，拒绝缺失、foreign、额外参数或旧digest；每次Projection只签发本Event的一份物理Handle。
- Source Result reconstruction经既有Work Result Reader读取持久Probe，核验完整Evidence payload digest，并按完整Read Handle JCS digest建立精确覆盖。Coordinator拒绝缺失、重复、foreign和失败Result；显式`not_media`保留为对应成员的业务观察，不伪装技术失败。
- Movie保持原Source Event ID、单Event、空member parameters与原盘title/topology；`ProductionSourceScopeReference`的stream_file/ISO恰好一个源文件约束未放宽。Libra只读正式来源，未产生正式收藏或写源效果。

## 验证

环境：Windows、Node v25.9.0、任务隔离worktree。Shell先设置`NODE_PATH`到主Service已安装依赖；未创建junction，未更改锁文件。下列路径相对仓库根目录。

13文件批次：100通过、0失败、0跳过，约25.5秒。

```powershell
node --test `
  media-service/test/helix-architecture/series-source-media.test.js `
  media-service/test/helix-architecture/series-routing-run.test.js `
  media-service/test/helix-architecture/p9-media-production-contracts.test.js `
  media-service/test/helix-architecture/p9-media-production-routing.test.js `
  media-service/test/helix-architecture/p9-media-production-capability-registrations.test.js `
  media-service/test/helix-architecture/p9-libra-run-coordinator-boundary.test.js `
  media-service/test/helix-architecture/p9-product-conformance.test.js `
  media-service/test/helix-architecture/p9-uat131-product-delivery-recovery.test.js `
  media-service/test/helix-architecture/p7-bdmv-topology-scope.test.js `
  media-service/test/helix-architecture/p7-bdmv-triage.test.js `
  media-service/test/helix-architecture/p14-pbf20-episode-claims.test.js `
  media-service/test/helix-architecture/p14-series-run-layout.test.js `
  media-service/test/helix-architecture/p14-series-run-lifecycle-continuity.test.js
```

最终追加Movie单源Result conservation检查，`series-source-media.test.js`专项22通过、0失败/跳过，约91ms；与上述批次重叠，不相加。此后没有代码变化。既有UAT测试文件名保留历史身份，不为开发分配新UAT。

另3文件：25通过、0失败、2跳过，约7秒。

```powershell
node --test `
  media-service/test/helix-routing-decision-e2e.test.js `
  media-service/test/clean-media-probe-runtime.test.js `
  media-service/test/clean-media-production-effect-port.test.js
```

两项跳过：FFprobe crash测试在Windows显式skip；live BDAV HEVC TrueHD prefix缺少对应BDMV fixture。其余包括原盘/ISO只读提取与清理、stream-file Remux、实际FFmpeg fixture、CPU two-pass、进程取消/超时和Movie Routing/Spec/Run回归。不能以此宣称完整Movie A–I或Linux资格。

P2 baseline `validateP2ContractBaseline`返回`ok:true,findings:[]`；`git diff --check`通过，Coordinator边界测试通过。初次Host增强检查误用了不存在的成员表名而失败，修正为正式`libra_run_material_members`后通过，未修改生产Schema或弱化成员Oracle。

## 实际Host Oracle

- 本批2/24集均恰好一个Season Subject及一个Run，冻结Spec Episode keys与Run claims精确覆盖；保持既有Metadata、NFO、来源Result/Plan bindings检查。
- Source Work为succeeded；恰好2/24个Probe Result、相同数量的不同完整sourceHandleDigest，Probe Evidence及Foundation bindingResultDigest逐项重算通过，Source Event没有failure_code。
- Source Plan参数中的materialKey集合与正式Run Primary集合逐项相同，member digest与正式Reader完整快照相同。
- Host fixture在Source Work终结边界停止，后续单源Direct/Package缺口不属于本批PASS。没有断言整个Run成功，也没有把后续Stage失败作为Source成功或完整交付Evidence。
- Shelf Entry仍为0，Target为空，源字节保持；临时Host/SQLite均关闭，fixture目录由test cleanup回收。

## 保留事项

下一段在Libra内补逐Primary媒体验证、选择与加工，再组成精确Product Material Manifest和完整Conformance/Package。逐Episode空间要求及N:M空间归属仍按所属节点核对合同，不能拿物理Probe计数证明逐Episode计量完成。`buildMediaRequirement`当前integer GiB检查与已定义Series 0.75/1.5 GiB规则需在空间接线时修正；不能在此批改为Season总量验收。

没有Series页面或用户可见文案变更，未宣称UI负责人PASS；未执行Series真实媒体、浏览器/键盘/窄屏、Desktop、Linux/Docker、生产部署、生产数据操作或Reset。主工作区原有5个modified文件及1个untracked Evidence保持。没有增加兼容、迁移、fallback或修复旧条目代码。
