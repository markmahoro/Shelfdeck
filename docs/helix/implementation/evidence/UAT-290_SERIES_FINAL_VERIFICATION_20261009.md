# UAT-290：整季最终校验与 Fulfillment 有界记录

2026-10-09。用户确认两类完整 Verification 由 Arca 不可变保存，最多 1024 成员、每份完整 JCS 8 MiB；Foundation 仅保存精确引用及摘要，结算及最终 Commit 重建校验。质量、来源删除授权和 Foundation 64 KiB 限额不变。

## 根因与修复

47 集通过 UAT-287 验收及 UAT-288 Stage/Placement 后，FinalProductVerification 为 74,939 字节，触发 Foundation Result 上限。两类校验改为正式 Domain Fact Commit，原子写入 `arca_inventory_verification_records`、typed Record、Foundation Result 与 marker。精确 Event 重放返回原观察；完整值、Record、执行 scope 和摘要均校验，不截断成员。

结算授权创建、删除前复核、Fulfillment、On-deck Commit、Aftercare 及历史副作用核验统一重建完整值。Capability 输出绑定 nominal Record schema，保持 Foundation 严格合同匹配。新增 owner 写入使用既有 SQLite writer 资源治理。

复验又发现最终 On-deck Commit 的独立 Foundation Evidence 仍重复内嵌完整 Fulfillment；已改为保存经 Arca 重建校验的精确 FulfillmentVerificationRecord，Commit 自身摘要仍绑定完整 Verification digest。缺失、跨 Run、摘要漂移或损坏的引用拒绝提交。

## 已完成验证

- Windows 合同、存储、升级核心 67 项通过；边界、结算、保留控制及 DDL 等 50 项通过。
- 最终 Commit 引用负向检查及存储 5 项通过；最终 P2/结算边界 15 项通过。
- Linux 存储、原子回滚、1024 成员、篡改与升级 7 项通过。
- 两集完整 Host 37.003 秒通过；Movie 真实 HTTP 登记至上架旅程 10.232 秒通过。
- Windows 47 集完整 Host 172.331 秒通过，Stage 94,045 字节、Final 74,941 字节、Fulfillment 68,242 字节；Foundation Result 有界，完整集数、文件落位、结算及收藏事实通过原有断言。
- 最终 Windows 47 集复验 158.193 秒通过，新增断言验证全库 Foundation Result/Evidence 均≤64 KiB，Commit Evidence 与 Arca 的精确 Fulfillment Record 及其摘要一致；完整 Stage/Final/Fulfillment 分别为 94,043/74,939/68,240 字节。
- Linux 47 集完整 Host 192.184 秒通过，Stage 89,249 字节、Final 73,889 字节、Fulfillment 67,190 字节。
- Windows 完整 Placement migration 91.884 秒、NFO Aftercare 91.373 秒通过。
- 现场只读备份升级演练：原 196 个业务表行数及内容摘要保持，foreign_key_check/integrity_check 通过；仅副本增加 owner 表并更新 schema marker，没有迁移或改写现场 Run。

DDL digest：`ac46cd90031d5d02ac05ed5657ec589117f9763a096c5d19033549c951a8c3fe`，200 表。P2 aggregate：`45cf88c04d20a440e38a3651aaf1db58fc7d57f691baaff5b2669c56e7bdc6c4`。

## 验收边界

本地 18081 仍运行 `a45d7b13f`，保护正在进行的真实转码；本修复尚未加载现场。未 Reset、重扫、授权来源删除或部署 NAS。隔离 Host 通过不等于现场 47 集验收完成，UAT-290 保持待现场验收，UAT-286/287/288 不以本次提交批量关闭。未修改 UI，无新增 UI 验收声明。详细测试日志保存在工作区外的本地 UAT 运行目录。

2026-10-12现场只读验收：人世间58集Run `c8e9ded983da364c62c5e43c52dd1483beb0b0c0f3c96a1680d0e790bcfd5976`已completed，On-deck `b121f187f98f5a03c6234e295e5a446576d782ec35d84850c633dcac717b5593`已Commit，Shelf Entry `097c720a2bc0a240609a48041fc297b9c3c0c956e340c299b3dfa1870ac8c298` revision1含58 Primary、59 metadata sidecar及1 poster。FinalProductVerification为91018字节、Fulfillment为82845字节，均形成Owner记录并完成唯一Commit，超过原64KiB限制。 原始只读审计`.codex/series-release-20261012/local-committed-evidence.json`。结合既有双平台正负回归，本项按自身容量验收条件关闭；其他UAT、生产升级与白鹿原77集验收独立。
