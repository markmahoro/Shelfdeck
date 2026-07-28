# P14 JAV Responsibility Closure Checkpoint

状态：**FROZEN — 待 Architecture active review / P14 独立复验**

## Baseline 与范围

- Accepted source baseline：`6074a2b7`。
- P14 JAV Arca Handoff B / Inventory / On-deck evidence：
  `51a744a43ebcddbff89537acfe08d6cb8bfcde96`
  （local tested `231bb40b`）。
- 本checkpoint仅闭合既有JAV纵向最后一段：
  `arca.product.accepted@1 → terminal Libra Run
  → durable Arca Off-load Projection
  → grace/two-cycle audit
  → Workspace cleanup/release`。
- 未进入Western Adult、横向Feature Matrix或新的Provider验收。
  deterministic JAV Provider fixture仍只属于施工证据。

## Owner / Handoff / transaction continuity

- Clean Service只解除此前JAV专用的`responsibilityClosure:null`阶段闸门，
  原样复用Movie/Series已接受的
  `MovieResponsibilityClosureCoordinator`、Run Lifecycle、Inbox、Arca
  Off-load public projection和Workspace Cleanup owner-local contracts。
- `arca.product.accepted@1`只由Libra intended consumer消费；Delivery Receipt、
  Inbox、Run revision、Result、marker和ack保持既有事务/恢复边界。
- fault-after-Run-completion-before-delivery-ack后，重启直接返回持久化的完整
  `LibraRunLifecycleResult@1`；canonical JSON、storage digest和内部
  `resultDigest`逐字节一致，只补ack，不新增Run revision、Result或marker。
- completed-run public reconstruction中的`contentProfile`来自正式历史
  ProductDelivery的`productStructureSnapshot`，不读取caller cache、Provider、
  Procurement或Arca Store。
- `arca.offload.completed@1` wake保持可丢；测试隐藏wake后仍由正式durable
  Off-load Completion Projection发现资格并推进。两个消息最终各一条Inbox，
  consumer均严格为Libra，且各自只ack一次。

## Grace / audit / cleanup recovery

- 24小时grace使用注入确定性时钟；没有真实等待或放宽策略。
- 第一次实际Reference/Control读取只形成`audit_pending`，零Scope、零物理效果。
- 重启丢失进程内first observation时重新开始第一轮；同一进程提前第二轮仍
  pending；至少一个完整Reclaimer cycle后才执行第二次实际读取。
- Admission UoW原样复用exact target references、other active references、
  current Controls和Workspace revision/state重检。共享反例证明：
  - 两轮之间新增Reference时零Scope；
  - 第二次观测后、Admission CAS前Control漂移时零Scope。
- fault-after-first-physical-effect留下一个intended journal和零completed
  members；重启恢复同一效果。fault-after-first-member-commit留下一个
  committed member；再次重启完成剩余members。
- 最终恰好一个completed Cleanup Scope；全部对应Workspace references
  released，Workspace、`fx_workspace_materials`与Foundation Workspace
  registry均进入`reclaimed`，无重复Scope、member、effect或message receipt。

## Product history 与文件安全

- cleanup前后均可从正式ProductDelivery/Arca历史重建同一JAV Package：
  1个Primary、NFO、poster、fanart共4 members，全部Episode claims为空。
- Arca 4个Inventory rows和active Deck Fact保持不变；Inventory Target文件的
  bytes与mtime在Libra cleanup前后逐项一致。
- 原JAV MKV/NFO/poster和无关源文件bytes、size、mtime保持不变。
- 只有Libra disposable Workspace物理文件被回收；cleanup不解释Episode
  claims，不修改Arca Inventory。

## 验证与机器基线

- JAV public HTTP责任闭合与恢复：`4/4 PASS`。
- JAV + cleanup audit定向反例：`7/7 PASS`。
- Movie/Series/clean-entrypoint共享回归：`20/20 PASS`。
- 完整`npm run test:helix-architecture`：
  `132 files / 887 tests PASS`，findings与`prohibitedActionsRun`均为空。
- 机器库存保持：
  112 Capabilities / 97 Result families / 177 tables /
  43 canonical transactions / 114 routes / 18 UI surfaces。
- Contract aggregate：
  `c1cd53125ffc6055e57cd00b2c8a388b42405b49194ec0aa1292ff5cb350447a`。
- SSOT source-map aggregate：
  `a54b0b3934b8a5a574cf7e1d17370501564e136cdbe9c470082efe9d1f7ce209`。
- Manifest aggregate：
  `1078633da3e788979098d811d0409c1a5520e46d67aac54d33655f4288e77c37`。

## Freeze 与残余

- 本checkpoint冻结，等待Architecture/P14复验；不得进入Western或横向施工。
- Material Field `contentProfile Hint` Owner-row/API continuity仍是Western前的
  独立closure。
- `F09`不提前标记全PASS；`F02.17`继续为`NOT_RUN`。
