# UAT-288 Series Stage Manifest有界引用

2026-10-09用户确认：完整StagedInventoryManifest由Arca不可变保存，最多1024成员、完整值8 MiB；Foundation Result只保存StagedInventoryManifestRecord与完整摘要，继续64 KiB。Stage仍material_commit，物理恢复机制不变；保存失败不得成功，重放必须同一Manifest。不是新收藏事实。

47集UAT-287后正式Stage产生94041字节。新增arca_staged_manifest_records按精确Event/Work/Owner process/Slot绑定完整Manifest；后续staged verification、placement、最终Commit、Aftercare与历史只读核验通过Arca重建并验证完整摘要、成员集摘要和成员数。纯模型的Aftercare收据计算仍接收完整事实，不访问持久层。

Windows存储7项（含UAT-287）、升级/Reset47项、P2/DDL/结算28项通过；Linux存储/升级8项通过。完整两集Host37.97秒通过。1024完整成员、>64 KiB值、重复执行、写入故障、篡改、执行fence及8 MiB SQL边界均有测试。现场只读副本升级保留196张原表完整数据摘要与Run状态，外键/完整性通过；没有实际升级、Reset或NAS动作。

47集已通过Stage、暂存校验、Placement Switch，下一关FinalProductVerification为74939字节，触发Foundation64 KiB限制；新增UAT-290，用户已确认最终校验和Fulfillment完整值按Owner证据引用处理。47集完整E2E仍未通过。本项待现场加载与完整链路验收，不关闭。

Windows正式Host追加回归：完整目录迁移93.53秒、同目录重命名93.47秒、Direct/Remux混合36.68秒全部通过。Target Slot输入绑定专项4项复验通过。
