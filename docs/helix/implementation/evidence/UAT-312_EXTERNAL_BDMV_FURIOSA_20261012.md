# UAT-312 外部寻源原盘接入失败

2026-10-12最新用户决定：本项与sample问题均作为待优化点，暂不推进；保留已定位缺陷及验收条件，不作已修复或关闭处理。当前重点切换为剧集版本上线后问题监控。

后续设计讨论见[已废弃的多步骤媒体达标路径规划方案](MULTISTEP_MEDIA_PLANNING_DESIGN_20261012.md)。用户最新决定废弃智能路径规划，继续沿用现有Coordinator逐阶段按Gap推进的方式；该稿仅保留历史讨论。本项外部原盘接入故障仍独立开放；本链接不表示合同已修改、故障已修复或生产已恢复。

2026-10-12，生产只读诊断；未修复、未部署、未重试或 Reset，未修改媒体。用户强调寻源资源珍贵，不应轻易放弃。

## 现场与证据

- 生产镜像 `helix-beta-20260930-8e197b3c36`，容器 running、RestartCount=0。
- 影片《疯狂的麦克斯：狂暴女神 (2024)》，Subject `libra-subject-f696ee2318ab4f5be47bc2753f96417f0181d613`，Run `7fa6b98e6f9f470efd121d565e78785ba7516b63d65e5ab6612dfe6d47c64c6c`。
- 北京时间13:02:30创建Run，13:04:53取得MoviePilot Job Receipt；externalJobId `407261733a8b435a283223c53ce91c1a4838f3de`。
- MoviePilot只读transfer history记录614：同一download_hash、TMDB 786892，15:15:50整理成功，目标目录 `/vol2/1000/shelfdeck_upgrade/疯狂的麦克斯：狂暴女神 (2024)/`。
- ShelfDeck15:17:00将Run终结为`discarded`，Outcome为`unable_to_on_deck / processing_failed`。获取观察共186 Attempt，最后三次为`P5_PROVIDER_TRANSPORT_FAILED`；此前183次中的最后一次为正常`deferred`，不能称186次网络失败。
- 原片Probe为H.264、1920×804、EAC3（分类other），媒体验收未满足HEVC、4K及主音轨要求。外部候选广告为HEVC/4K/TrueHD Atmos，91,278,792,458 bytes；以`selected_processable_claims`选中，仍需后续实际验收及满足50 GiB上限，不能声称下载完成即可上架。
- Landing `/upgrade/疯狂的麦克斯：狂暴女神 (2024)/`仍存在BDMV、CERTIFICATE及NFO。只读执行生产源码的`moviePilotMediaFiles`，得到29个视频文件，共91,270,662,144 bytes，均为原盘分片；最大`BDMV/STREAM/00075.m2ts`为80,117,243,904 bytes。未执行全文件checksum、解码或原盘完整性验收。

## 代码依据与结论边界

生产`h1-provider-adapters.js`的`transferOutputLocation`递归枚举普通视频文件，并强制`media.size === 1`，否则抛出`MOVIEPILOT_TRANSFER_PRIMARY_CARDINALITY`（外层code为`P5_PROVIDER_TRANSPORT_FAILED`）。本片现有29分片必然不满足该入口。当前main仍有相同Movie路径限制，不能宣称Series候选升级已经修复。

历史失败诊断文件仅记录泛化code和空diagnostics，未保存精确causeCode。因此可以证明当前成果必然被此入口拒绝，不能将最后三次历史失败全部断言为已记录的cardinality错误，更不能仅凭transport代码认定网络中断。现场GET download、download history第一页、transfer history第一页均200；不证明历史网络一直正常。

Run终结之后current Run为空，Formation投影显示“等待重新入库”；这不是下载仍在进行或即将自动继续的证据。外部稳定性、身份、Package与导入尚未完成，不能形成Arca上架结果。

SSOT §10.1.5允许有界重试与当前条件下终局，但技术故障不证明寻源无结果。原盘主标题、结构成员与普通文件有不同证据要求，不能挑最大m2ts或放宽唯一性绕过。新增外部原盘承接如需改变typed合同，应先完成Owner/合同审查；下载成果与Job关联的保留、显式恢复和终局展示需分别验收。关联UAT-251/212，不改写其历史。

## 验收条件

1. 对本片精确Job及Landing成果保留关联，不重新下载，不直接改写旧Run、Outcome或生产数据库。
2. 明确并验证外部BDMV支持边界，以真实主标题/成员/身份及权限证据接入Libra加工；完整媒体验收、50 GiB要求、Arca Commit仍独立成立。
3. 故障必须区分网络、Provider响应、结构不支持和媒体不合格；重试耗尽不得表达为资源不存在，已有成果需有明确可恢复路径。
4. 对确切版本补双平台、实际影片及适用UI负责人验收。当前只完成诊断，保持开放。
