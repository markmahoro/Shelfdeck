# UAT-130 External Landing 独立修订验收

2026-09-08，Edge真实操作本机非localhost普通HTTP隔离服务；使用新数据库、临时目录与只读MoviePilot测试服务，不改变生产Landing或Secret。

- 配置成功后只把ShelfDeck可见Landing从landing-one改为landing-two；External Provider endpoint和两条Provider路径不变，revision从1到2，页面复用已保存API Key。
- 修订没有调用Provider写操作；初始资格检查仅3次GET。新Secret envelope绑定新revision，因此密文变化符合合同；通过Secret Store读取比较，凭据字节完全相同，比较后清除内存Buffer。
- 与已配置Material Field重叠的Landing被拒绝，错误码PLATFORM_MOVIEPILOT_LANDING_ROOT_OVERLAP；revision仍为2。页面当前错误文本为英文，未将其计为中文文案验收。
- 重启同一隔离服务后，浏览器重新进入设置仍显示landing-two、已配置且复用Secret。
- 原浏览器请求同幂等键/同body重放返回200和revision2；另一幂等键携带旧expectedRevision1返回409 PLATFORM_INTEGRATION_CAS_CONFLICT。
- 7项Provider定向测试通过，包含CAS、重放、重启与重叠拒绝。原始本地证据位于忽略目录.codex/uat130-*，未提交凭据或运行数据。

结论：UAT-130按原问题范围验收关闭。没有把UAT-119真实代理全链路或其他设置页需求一并关闭。
