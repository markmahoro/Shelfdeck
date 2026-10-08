# Series Off-deck与共享引用保护证据

日期：2026-10-08。基线 `c04d8d840baa3e7f5a0e5ff5780a948ec3059bc4`；本批仅测试与证据，无产品实现修改、生产数据操作或NAS部署。对应Series Phase运营工作项，合同为SSOT §2.7、§8.6.12。

## 正式Host整季退出

新增可选 `HELIX_SERIES_OFFDECK=1`，执行 `series-routing-run.test.js` 中 `with real N:M Off-deck$`。使用隔离数据、实际FFmpeg与正式Host，从E01–E02共用HEVC/MP4及E01的H264独立part，完成Libra Remux/NVIDIA Transcode、Arca上架和源结算。随后以正式Review、Selection确认和Authorization API授权整个Season退出。

`series-offdeck-host.log` 45.0秒通过：3条Episode Claims对应2个物理Primary，Scope含6个唯一材料，精确等于当前Inventory；没有按Episode展开重复删除。Case completed、Entry offdecked、Deck Fact增加一版。每个材料有唯一删除Evidence且实际文件不存在；范围外sentinel字节保持。Entry全部Material Control释放，active_guard清除，仅一个terminal receipt，SQLite foreign_key_check为空、integrity_check为ok。

在真实 `arca_offdeck_terminal` UnitOfWork最后追加抛错参与者，核对Entry、Inventory、Deck Fact、Scope、Authorization、Case、terminal receipt、Control/revisions及Commit/Result共11表全部回滚；随后原参与者正常提交，记录一次成功审计。这证明事务原子性，不等同于真实进程被终止后的重启恢复。

## 跨收藏引用保护

`p16-offdeck-closure.test.js`新增原生SQLite与实际文件删除Capability结合的验证。Seed构造当前Season、正在退出的Season、Movie、旧revision和已退出Season，真实 `createOffdeckStore.activeReferenceCount` 读取完整当前引用。一个Season多个part引用同一材料只计一个consumer，Movie的Related与Inventory也不重复计数；部分Related释放或全部Related释放后仍有当前Inventory时，实际删除Capability返回retained_due_to_active_reference且文件保持。最后Movie退出后，历史revision和已退出Entry不形成有效consumer，文件方可删除。

此处跨收藏关系与状态为隔离数据库fixture种子及受控推进，不声称多个Season/Movie都经完整上架/退出API形成，也不代替真实进程崩溃恢复。初次新fixture缺Inventory Representation父记录导致外键拒绝；补齐父记录与head后验证通过，没有关闭外键约束或改产品逻辑。

## 验证与剩余门槛

两文件专项18通过/0失败/0skip，日志 `series-offdeck-targeted-v2.log`；首次fixture失败保留 `series-offdeck-targeted.log`。架构449文件/1412依赖、语义2067文件及diff检查通过。本批未重复完整架构历史回归、未执行Linux或UI验收。日志均在 `E:/my_project/helix-git-consolidation-20261008/`，不提交运行数据。

真实进程中断/跨设备恢复、N:M有界长媒体、外部寻源及完整Series界面、Linux/升级回退/版本验收仍开放；本批不关闭整体首版可部署Gate。
