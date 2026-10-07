# Series 真实混合媒体 Host 验证

日期：2026-10-08。关联 CURRENT_PHASE 逐成员加工/混合交付与复杂文件映射工作项；基于 `3708a1723` 的正式链路。仅扩展隔离测试和证据，无生产部署。

## 场景与正式路径

测试入口：`media-service/test/helix-architecture/series-routing-run.test.js`，显式设置 `HELIX_SERIES_REAL_MEDIA=1`；以 `--test-name-pattern='with real '` 执行两个真实样本。

1. 三集：E01 HEVC/MKV Direct，E02 HEVC/MP4 Remux，E03 H.264/MKV Transcode；最终同一 Season 三集完整上架。
2. N:M：HEVC/MP4覆盖E01+E02，另一个H.264/MKV为E01第二个part；分别Remux和Transcode，最终两个物理成品、三个Episode Claim组成一个Season。

媒体在临时目录由FFmpeg生成，1080p、24fps、3秒黑色视频。Host使用正式Device探测、Probe、24帧Transcode Assessment、FFmpeg Remux/Transcode、三点播放检查、Workspace Effect/Fence/Receipt、终检、Conformance/Promotion、Arca Acceptance/placement/settlement/Commit。实际转码Device为 `nvidia_nvenc`；通过持久化Result核验一种remux和一种encode、两个不同源Handle，以及兼容Assessment。Provider身份/资料/海报仍为受控fixture，不声称测试了外网Provider。

逐一检查正式Inventory、Season目录/逐Episode NFO、每个成品HEVC实际Probe、完整Claims、源→成品读取权限与身份、逐源Offload Context的最终Material Key/处置/结算期望以及来源结算。N:M另由最终Inventory文件大小独立计算E01=`shared/2+part`、E02=`shared/2`，以BigInt约分后对照Libra所有最终Verification与Arca Space Check。

## 结果与限制

- 两个真实Host场景已通过，合计83.4秒；三集44.6秒、N:M38.4秒，均选择本机NVENC。
- 最终N:M实际字节数独立重算补充复验通过（43.0秒）。测试Oracle按每份Verification覆盖的Claims检查Libra，按完整范围检查Arca；通过Verification ID关联正式Product Package，避免将重新签发的Shelf Acceptance读取Handle误当生产Handle。
- 受控Direct+Remux旧Host回归35.8秒通过；成员/预算专项105项通过。无生产代码变更，本轮未重复全架构；此前 `3708a1723` 全架构2,121通过/9既有skip。
- 这是短时SDR静态视频、无音轨、无大小上限的真实加工验证。长片、音轨/字幕、多设备、真实有界压缩/N:M预算重试、外部寻源与恢复、Linux及UI验收仍需对应证据，不能将本批作为完整Series发布资格。
- 临时Host关闭并清理自有临时目录。原始日志位于仓库外 `E:/my_project/helix-git-consolidation-20261008/series-real-*.txt`；不提交测试媒体、数据库或runtime数据。
