# Series 混合候选终检与交付

日期：2026-10-08。关联唯一 CURRENT_PHASE 的逐成员生产/混合成品工作项；不关闭完整 Series 节点，不新增 UAT 编号。

## 实现

- Coordinator 按冻结 Primary 调度成员 Remux/Transcode Work，Working 引用使用该成员 Episode Claims。候选来源由精确 Work identity、Source Handle、Workspace Handle、Probe、Verification 和 Selection 重建。
- 完整候选集合产生既有 workspace_media_production Work，身份绑定候选摘要，依赖覆盖每个来源 Work；逐成员重新执行正式 Verify/Select，空间依据替换为所有实际成品。任何缺失、重复、跨成员或改写证据拒绝交付。
- 多 part 单成员中间验证仅剩 max_size_exceeded 且自身满足保守成员预算时，保留为终检候选；不修改其失败 Verification/未选中 Selection。完整集合必须重新实测验收。
- Staging、Conformance、Promotion、Shelf Acceptance read set 消费完整最终集合，保留每个加工文件的原 Probe 与实际输出 Probe；逐源绑定实际最终 Material Key 和 carried_forward/replaced_and_settled 结算。
- All-Direct 保留原完整 Direct Work；Movie 单成品路径保留。修正精简 Movie 恢复快照不含 spec 时的读取假设。
- SSOT §5.5.8/PBF-15 的既有 Owner/加工合同补充实施连续性；不新增 Capability、Result family、DDL 或业务 Owner。

## 验证与边界

- Windows Node 25.9，成员生产/终检专项最终 100 项通过，含完整集合身份、N:M part 候选、错误 Result/Probe/Selection、禁止单成员成品冒充完整交付。
- 隔离正式 Host：两集 Direct+Remux 从 Field 到唯一 Season On-deck Commit 通过（37.7 秒），检查完整 Manifest/Claims、双成员终检、源与成品读取身份、逐源 Offload Context disposition/最终 Material Key/settlement expectation、正式 Inventory/NFO、授权源结算。Provider/Probe/Playback 为受控 fixture；Remux Effect 使用正式 Workspace materializeMedia/Fence/Receipt，但 produce 仅复制测试字节，**不作为真实 FFmpeg 验证**。
- 原共享文件 bounded Direct 隔离 Host 回归通过（35.7 秒）。Movie UAT-131 Product Delivery 恢复专项通过；首次全架构仅该精简快照读取失败，修复后复验。
- 全架构最终2,130项：2,121通过、9既有skip、0失败（99.6秒）。架构边界、语义 Guard、P2 与 git diff --check 通过；P2 aggregate 保持 `87ed61befce92924d00c73719e3a6fe4f6745419438ca14f250e706bb89028f7`。
- 本轮未跑真实 Series FFmpeg Host、Linux、浏览器或 NAS；逐成员 Transcode 的 Coordinator 分支已接通但尚无完整 Host 转码证据。逐成员外部寻源/耗尽恢复、N:M 实际加工、Related/运营及 UI 等仍属 Phase 未完成项。

原始日志位于仓库外 `E:/my_project/helix-git-consolidation-20261008/series-final-*.txt`，不提交 runtime/数据库/测试媒体。代码按本次验证提交推送 main；无生产部署或数据修改。
