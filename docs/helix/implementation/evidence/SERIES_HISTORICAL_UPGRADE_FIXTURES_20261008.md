# Series 发布验证：历史升级测试修复

日期：2026-10-08，关联 CURRENT_PHASE 发布资格验证；没有生产代码/DDL/迁移逻辑变更。

## 根因与改动

此前 `helix-uat-schema-migration.test.js` 的9项既有失败已在修改前记录。7项将当前DDL局部删除/改写后配上旧schema marker，留下后续新增的Terminal Outcome等表，迁移时重复建表；其余2项仍期待current schema自动retire旧Plan，违反当前clean-cut不自动修复未完成Formation的规则。

改为8份Git中真实历史DDL快照，涵盖v1、v2、三态Formation之前、Case Admission、Source Cleanup、Target Binding、Offdeck Coverage和Secondary Target之前。每份在fixture manifest记录完整commit、原路径、DDL SHA256、表数、字节数；gzip仅压缩静态SQL，没有生产数据库或用户数据。测试使用前先校验原始摘要，不依赖Git或网络，不由当前DDL逆推旧版本。原先已通过的Secondary Target用例也改用精确历史DDL。

保留各历史升级的原事实/引用/nullable Evidence/幂等断言；两个current schema旧Plan用例改为逐表比较marker、Work、Attempt、Plan、Node、Event及Event Attempt完全不变。新增catalog drift拒绝用例，核验拒绝后schema、marker及Audit row不变。不增加兼容、retire、resume或生产数据写入。

## 验证

联合执行历史升级、UAT-251 schema、Series Fact Key、Provenance容量和On-deck Target Reservation五个文件：20项通过、0失败/跳过，11.9秒。历史升级文件现在12项，其中1项为新增catalog drift测试。`git diff --check`通过。

本轮为测试/文档变更，不重复全架构、Service/Desktop build、Linux或生产同库升级/回退演练。现有8个历史源只覆盖各测试所声明的保留事实；不以空库或稀疏fixture证明完整生产数据升级安全。当前Series部署资格仍需完整Phase门禁。

日志：仓库外 `E:/my_project/helix-git-consolidation-20261008/series-historical-migration-repaired.txt`、`series-upgrade-gates.txt`。外部寻源N:M source-to-final多值映射决定另在CURRENT_PHASE等待用户确认，不由本次测试修复替代。
