# P9-01 Legacy Function-level Reuse Audit

Status: PASS for read-only disposition；no legacy code copied.

## Decision

| Historical locator | Disposition for P9 | Reason / bounded reusable evidence |
| --- | --- | --- |
| `src/capabilities/transcodeCapabilities.js#registerTranscodeCapabilities` | delete semantics / do not reuse | 读取Task、sourceAccessResolver、旧target facts并由executor选择流程，违反typed port与Owner边界 |
| `src/services/transcodeService.js#startEncode/startRemoteEncode` | do not copy wrapper | 混合taskStore/nodeStore、设备池、retry/fallback、进程与业务调度；P9只可经P4/P5 typed Effect/Worker ports调用 |
| `src/services/transcodeService.js#replaceSwapOnce/replaceDiscSwapOnce/replaceWithRetries` | forbidden in P9 | 修改正式目标材料属于Arca material commit，不得被Libra Workspace production复用 |
| `src/services/transcodeService.js#buildEncodeArgs/buildTwoPassEncodeArgs/parseFfmpegTimeMs` | atomic candidate only | 可在正式EncodeIntent/FFmpeg port下逐函数提取pure command/progress parsing；必须删除Task/config/path authority并迁移参数边界fixture |
| `src/services/transcodeService.js` disc/ISO/UDF/MPLS parsers | test-vector candidate | pure byte/parser算法可登记后提取；不得连同archive execution、路径解析或正式Source mutation包装复用 |
| `src/transcodeDevicePlan.js` pure slot/rate-control helpers | evidence candidate | 保留Windows backend、priority和QSV retry测试向量；实际资源选择归P4/P5 Resource/Worker合同，不复制旧全局设备池 |
| `src/metadataArtifactWorkspace.js#checksum/atomicWrite/overlaps/validateLocation` | already superseded by P5 substrate | checksum、containment、fsync/rename和overlap不变量已由clean Artifact/Workspace/File Effect实现；只保留fixture，不复制旧config root/GC模块 |
| `src/metadataArtifactWorkspace.js#cleanupUnreferenced` | do not reuse | 按时间/路径扫描的旧GC无Owner Cleanup Scope、Control、Deletion Evidence或durable Off-load Projection |
| `src/metadataProviderAdapter.js` | do not reuse | 依赖Emby/JAV旧Service、Task descriptor与Kairox错误码；P9只用P5 Provider protocol和SSOT fixed source order |

## Reusable test vectors

- FFmpeg command assembly的codec/rate-control/bitrate边界；
- FFmpeg progress line parsing与diagnostic stderr归一化；
- ISO/UDF/MPLS parser的synthetic byte fixtures；
- Workspace containment、parent traversal、checksum及atomic rename crash fixture；
- Windows AMD/Intel/NVIDIA backend识别与priority ordering反例。

这些仅是输入与不变量，不继承旧Task、fallback、Store、path authority或业务完成语义。正式提取必须等对应P9 typed Capability与
Effect contract通过Ready审计后逐函数进行，并由clean package/import guard证明不反向import旧模块。
