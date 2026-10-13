# OPS-RUNTIME-STARTUP 发布资格修正冻结包

2026-10-13 Exit。用户授权标准生产部署，不执行生产停机/Reset或媒体重处理。原OPS开发包及0bc失败历史保留，本发布前修正不分配UAT。

| Work item | 验收 | 结论 |
| --- | --- | --- |
| OPS-RUNTIME-STARTUP | 正常Owner wake进入draining可启动；真正停机仍拒供给；精确镜像、完整副本/回退及标准部署 | 通过 |

产品0dbd762d296e7d936f11e7647e1c40210d624c6e。确定性red/green复现后只接受已有active状态ready/draining，未移动Owner或弱化Recovery Gate。Windows相关37、Linux精确82通过。完整旧版、候选及候选处理数据上的旧版回退通过，既有八类不可变记录无缺失/改写。UI无diff，负责人6cee7e732确认继承已接受具体资产。

标准build/upload/checksum/dry run/apply通过，NAS生产0dbd762d2、health ok/normalSupplyAllowed=true、RestartCount0/OOMfalse；五挂载及QSV正确，无源码bind。实际浏览器安全停机入口可用、运行中Reset禁用、收藏和整理GET200，未点击生产操作按钮。收藏Entry/Commit523及Run661保持，Material正常注册增加。

完整[Evidence](../evidence/OPS_RUNTIME_RESET_20261013.md)。未做NAS长时FFmpeg停机/断电、生产Reset、整季加工E2E或Electron完整分发；浏览器初次加载/按钮等待超时保留，第三次核验通过不代表1秒SLO，UAT-318继续开放。原20条destructive_commit reconcile_required未清除；不是以Reset掩盖历史责任。
