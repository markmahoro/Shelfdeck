# P13 备份摘要稳定性：隔离修复与验证

基线为 `27a0f68af3599a3422b21853632fc8a01878b750`。完整架构门禁的 P13 用例发现，在 Linux 文件系统的时间戳分辨率内，一次流式读取中的同长度修改可能使 `mtimeNs` 和 `ctimeNs` 均不变；原实现可能接受由新旧内容混合而成的摘要。独立 60 次探针在该基线上得到 9 次拒绝、51 次错误接受，51 次接受均为混合摘要。

## 修复范围和约束

P13 `helix-operational-safety.js` 的 `fileEvidence` 对同一打开的文件描述符用 1 MiB 缓冲区、显式位置分两次完整读取，每次均复核原文件身份、长度和时间戳，比较两次的字节数及 SHA-256；打开后及每遍读取后，以 `lstat` 检查路径仍为同一 `dev/ino` 的普通文件。内容变化、路径消失或身份不一致时保留原有 `P13_BACKUP_FILE_CHANGED` 拒绝。稳定文件的清单格式和摘要不变。额外的完整读取增加 I/O 和时间，具体耗时取决于文件与存储设备。

两次相同摘要和间隔身份检查不是原子文件系统快照，不能保证识别任意并发或协调写入，也不能保证两次检查之间或后续复制期间源路径及数据不变。身份检查依赖底层文件系统提供可区分的 `dev/ino`。完整备份仍要求调用方真实停止写入并确保源独占；该修复不代替停机、独占、复制后校验或恢复演练。

P13 清理初始化及其备份/恢复脚本使用此代码。本轮 Formation Reset 专用生产冷备使用另一套 `formation-reset-deployment-backup.js` / `formation-reset-backup.js` / `formation-reset-generation.js` 路径，不由此修复改变或证明其生产资格。独立的受控专用冷备试验中，合成 Stop 回调下首次库存曾接受混合摘要，后续复核以 `RESET_BACKUP_SOURCE_CHANGED` 拒绝，目标未创建；合成 Stop 不能证明生产已停机。正式流程仍须逐项核验实际停止、独占挂载、备份与校验。

## 验证

测试使用基线加本修复的隔离工作树；Linux 使用候选镜像 `markmahoro/shelfdeck:27a0f68af`（image ID `sha256:2b536c2f42fe619fe91306d5d1677957b5d365e51527a5344b0c3b29a361d0b3`）、Node v20.20.2，修复源码只读挂载；Windows 使用 Node v25.9.0。未访问或修改 NAS。

| 验证 | 结果 |
| --- | --- |
| Linux 固定时间戳负例对原版 | 第一遍读中注入变更时未抛错，确定性红例；旧实现没有第二遍，第二遍注入用例亦未抛错，不能将其当成独立旧版变更复现。 |
| Linux / Windows 固定时间戳负例对修复版 | 第一、第二遍读取期间分别注入同长度变更，两平台均明确拒绝；测试覆盖确实触发变更。 |
| Linux 路径原子替换 | 暂时仅用双读 fd 时，在模拟时间戳不变的情况下，真实替换同大小文件后返回旧内容 SHA-256 `5647f05ec18958947d32874eeb788fa396a05d0bab7c1b71f112ceb7e9b31eee`，路径当前文件 SHA-256 为 `6d75695d93deb1bf5805617cfba166466cf60dc0a99a8014fa58893f358f33b8`。加入路径身份检查后明确拒绝。 |
| 路径身份与消失 | Windows、Linux 的读取前后不同身份和读取后 `ENOENT` 注入均拒绝。Windows 本机拒绝对打开文件进行真实 rename（`EPERM`），该真实替换用例在 Windows 标记 skip，不能据此推断所有 Windows 文件系统相同。 |
| 稳定内容 | 两平台验证跨 1 MiB 分块的二进制文件和空文件的长度、SHA-256 精确不变。 |
| 未改动的原 P13 套件及新增负例 | Linux 13/13 通过；Windows 12 PASS / 1 SKIP，包含原始失败用例及原有 256 MiB 备份、校验、恢复与篡改拒绝测试。 |
| Linux 原自然竞态探针 | 修复后 60 次均拒绝；探针的 `sameStamps` 字段只统计恰好两次 `fstat` 的调用，修复后不能据其数值判断时间戳是否相同。 |
| Linux 1 GiB 逻辑大小文件 | 稀疏文件逐块生成期望 SHA-256，`files` 返回精确长度与摘要；`--max-old-space-size=64`，容器内存上限 256 MiB，最终修复观测最大 RSS 90,144 KiB。该测试不代表实体生产盘吞吐。 |

Windows 全套首次为 8/9，唯一失败是旧 clean-init 用例中将 `data.helix-staging` 重命名为 `data` 遇到 `EPERM`；定向重试及全套重试通过。相同原始脚本和用例的基线隔离快照重复该用例 10/10 通过；首次失败原因未确认，不能宣称已经复现或排除基线竞态。

相关原始日志及有界内存探针保存在本地隔离工作树忽略目录 `.codex/p13-evidence/`，归档工作树前应另行保存。关键日志 SHA-256：

| 日志 | SHA-256 |
| --- | --- |
| `p13-baseline-red.log` | `62773e522648d4cb1604892f861a2268a4f214361f7f629021183771c68716fb` |
| `linux-p13.log` | `05e33bda3fee49e94373a71e1004ddf43af6c3a31e2a7ec1863d3c7dfb0d9250` |
| `linux-p13-final.log` | `0641b5a66940bcf02d570a983f8da0cf7286026443145ba2b461f1e285fa065b` |
| `windows-p13-final.log` | `a0fda4911986d96c80e2b4a134661be2b2b4cd74dd50719a334e3647466654bb` |
| `linux-replacement-before.log` | `1d09b6d6b404d49f61d3661dbf534e78d066b6ff2719a174a3c1123aec601309` |
| `linux-replacement-probe-before.log` | `2429b451d0b2de27834ebfa3e643ed6c06e687f6599cf68c8f78160a4dff354d` |
| `windows-replacement-before.log` | `972f1e642ddb71636083f64fab6bcf4182046c54a8eba46d159a33b21f18bffb` |
| `linux-probe-60.log` | `bff2dc6a54e234fd9ca53a4bd926012cf7da727f2c1628ab3a41d3f3ed95653d` |
| `linux-probe-60-final.log` | `bff2dc6a54e234fd9ca53a4bd926012cf7da727f2c1628ab3a41d3f3ed95653d` |
| `linux-large-stream.log` | `f3bcb5451d8a002d6eed6deac9f5a296ddab9a151f1be41f89c4fa197394dd89` |
| `linux-large-stream-final.log` | `4b7329afbb80e31c63a47877281c5260db5869f38971387ad5d230d171d607bc` |
| `windows-p13.log` | `1cff2bf75d3f2f97c27effa440573973600300292f6084f55b0c67f7f1578f4e` |
| `windows-p13-retry.log` | `71d546de1ec2dfcd0ee8fca75e8c3c1d57dcb044696aaab264cbed00ad92ef71` |
| `windows-clean-init-retry.log` | `50ebb9f25109a93431ae8f465b3313ad1155d22e7b327d43da4bfe9df1b37997` |
| `windows-baseline-init-10.log` | `59f795a619e7e22b5bf958f98af2addb42cd7464a007a8c2ccfd6f03271d5080` |

集成后的固定最终候选仍需重新运行适用的完整架构门禁和发布资格检查；以上结果仅证明此隔离修复的定向覆盖。
