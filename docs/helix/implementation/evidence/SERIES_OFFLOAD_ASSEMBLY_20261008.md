# Series外部替换Offload装配

日期：2026-10-08；基线 `56bc05a8bcbe7a5709dfaea76fb2242fab83cd1c`，当前Phase多目标交接工作项，落实用户已确认的SSOT §3.2.6/§8.6.21。

Promotion沿完整终检候选的externalReplacement读取范围，重用完整候选空间校验，按当前冻结Run重新计算每个范围和source-to-all-final映射。只在校验通过后按基数生成finalProductMaterialKey或完整finalProductMaterialKeys，源成员仍由snapshot.members逐一装配原物理身份、Binding和Control；不会以外部Workspace投影伪造原Run Binding。范围外Direct/内部加工继续使用其原选择。

30项范围、外部Work/Import/候选和既有Promotion存储专项通过，增强候选fixture验证共文件+part对应全部新文件、范围外不生成外部映射、单一共享成品使用scalar、缺目标/改写映射拒绝。多目标验证为正式consumer后的真实纯函数接线与存储回归，不是完整外部Promotion Host证明。

P2完整基线通过，包边界454文件/1434依赖、语义2073文件通过。日志目录 `E:/my_project/helix-git-consolidation-20261008/`：`series-offload-assembly-regression.log`、`series-offload-assembly-host.log`、`series-offload-assembly-contracts.log`。

待完成：外部Workspace的Shelf Acceptance Read Set、Arca全部目标验证与一次源结算、Coordinator及外部失败媒体后处理、真实外部Host；Linux/UI/生产副本升级与发布门禁继续。未部署NAS，尚不声明外部端到端或Series可部署。

普通两集Direct/Remux正式隔离Host完成上架，36.6秒通过；验证此次装配改动没有破坏已有内部混合路径。
