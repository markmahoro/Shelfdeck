# Series进程恢复与退出中断证据

日期：2026-10-08。基线 `f887edea64d3d299a2927eb903c547d8d146fade`；Series Phase恢复工作项，仅本地隔离数据/生成媒体，未部署NAS。沿SSOT已有Arca Off-deck、Aftercare与Foundation ExecutionInputSuperseded合同，不增加Owner、Handoff、授权或Effect类别。

## 媒体物化进程边界

既有混合成员Case测试新增独立Node worker执行正式Series Materialize Capability：E02–E03共用成员、E02另一个part及E04，E01保持；包含MP4→MKV路径变化。在staged文件完成、原文件移至superseded、最终文件落位三个实际rename后分别process.exit(73)，不运行异常回滚或正常关闭。新进程读取同一冻结Case/成员Result/Workspace输入，以continue_forward恢复，再开一个进程重放并核对相同Receipt、旧文件与未改成员保护、Claims和完整空间集合。

每个中断点还模拟外部写入，恢复明确拒绝ARCA_AFTERCARE_TARGET_CONFLICT并保留写入者字节，恢复fixture原始现场后方可继续。此项使用冻结Owner fixture输入、实际文件与正式Capability，不声称独立验证了完整Aftercare数据库启动恢复。最初27项通过，增强N:M/扩展名及现有物化/完整集合测试60项通过；日志 `series-media-process-recovery.log`、`series-media-process-recovery-v2.log`。

## 完整Service Host退出恢复

新增可选 `HELIX_SERIES_OFFDECK_RESTART=1` / `series-offdeck-process-recovery.test.js`。独立初始Host通过原正式真实N:M上架/退出fixture，在全部6个材料删除、删除Evidence持久化但terminal transaction尚未开始时直接process.exit(73)。此时Entry offdeck_in_progress、terminal receipt为0。随后启动新Service Host读取同一SQLite与runtime目录，完成唯一terminal receipt、Entry offdecked、Case completed、Deck Fact恰加一版及全部Control释放。再次启动第三个Host，完整终态摘要和原删除Evidence完全一致；范围外sentinel保留，FK/完整性检查通过。

普通完整重启 `series-offdeck-process-recovery-v5.log` 62.9秒通过。最终增强 `series-offdeck-process-recovery-v6.log` 115.1秒通过：初始Host对首个Primary删除主动注入一次EPERM，正式Attempt记录integration失败后恢复，最终仍只有一个Case和一份Authorization，随后才触发上述退出/两次重启。未通过等待忽略runtime错误或取消身份检查。

## 发现与修复

- 删除调用本身的EPERM此前逃逸为执行器异常，尽管检查阶段已有端点不可用语义。Arca删除Capability现在将既有ARCA_OFFDECK_ENDPOINT_UNAVAILABLE及明确EACCES/EPERM/EBUSY/ENOTCONN/EIO转为integration失败，沿原contract_policy/同Case恢复，不写成功Evidence。其他错误继续抛出，未推断未知文件副作用成功。五种注入错误均验证原文件保护、外部替换后拒绝删除及恢复后精确删除；造成最初Windows EPERM的具体占用者未确定。
- 重启时旧Aftercare观察任务遇到已退出Entry，旧投影抛普通Error反复阻止恢复。Arca仅在currentContext明确证明offdeck_in_progress/offdecked/deregistered时报告既有ExecutionInputSupersededError；缺记录或active但投影损坏仍保留错误。Foundation只对safe_retry的pure_observation处理该显式信号，关闭旧Attempt为input_projection失败，不派发、不写Effect Journal；临时不可用、未知投影错误及workspace_write等副作用仍保持原恢复约束。业务状态判断没有移入Foundation。
- 测试搭建中的NODE_TEST_CONTEXT继承、错误ready()调用已修正；初次环境/重启失败日志v1–v4保留，不作为通过证据。

## 回归和范围

相关Arca/Foundation专项118通过。分组完整架构2,311通过、10skip、0失败：并行2,295/10skip（123.6秒）及stage 16（0.1秒）。10skip含9项既有可选场景与新重启测试默认skip；本次重启测试已按开关单独实际通过。最终增强只改测试注入与断言，产品代码与上述全量一致。架构449文件/1412依赖、语义2067文件及diff检查通过。日志位于 `E:/my_project/helix-git-consolidation-20261008/`，全量为 `series-recovery-full.log`、`series-recovery-stage.log`，专项为 `series-recovery-targeted.log`、`series-offdeck-delete-unavailable.log`。

未覆盖所有Aftercare/Off-deck崩溃位置、跨设备、长片/HDR、外部寻源或完整UI/Linux/升级回退验收。本机Linux Engine启动问题仍未解决；整体首个Series可部署Gate继续开放，无生产动作。
