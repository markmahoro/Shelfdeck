# Series Direct On-deck 隔离验收

日期：2026-10-08。归属唯一活动 Phase 的节点1/2，不构成首个可部署版本完成或 UI PASS。

## 范围与实现

Arca 正式布局按 Package 中精确 Series/Season identity 与 Primary Episode Claims 分配 `Season NN` 目录和逐集文件名；共文件保留覆盖集列表，相同覆盖集合的物理 part 保持独立文件。Libra 的 Episode NFO ArtifactRequirement payload 冻结 Episode scope，Arca 根据已发布 requirement digest 匹配目标，不从文件名猜集，也不向 Related/Sidecar 添加 Primary 关系。Movie 的 ArtifactRequirement 和布局保持原规则。

Arca 元数据验收和缺失字段报告改为逐个已交付 Episode 检查 number/title/plot，拒绝借用 Season 标量、错季和重复记录。保持 Arca 正式落位、源结算、Commit 责任，不增加跨域写入。

## 隔离验证

`series-routing-run.test.js` 使用实际 Host、SQLite、Scheduler、领域事务和文件操作，从正式 Field/Owner observation 驱动 2/24 集至 On-deck Commit。Provider、Probe、Playback 为确定性 stub；媒体文件为人工测试字节，不是真实解码验收。通过正式自动运行设置接口在临时目录授权源结算，生产未修改。

逐项核验：单一 Season Shelf Entry/Deck Fact、全部 Primary/逐集 NFO/Season NFO/Poster Inventory、唯一目标路径、每个 Primary 字节保真及 Season 子目录、完整 Episode Claim 集、逐集 NFO 内容、源文件已按结算范围移除；同时保留 Product Package/ReadSet、Source Probe 和 Fact Provenance 校验。

排查过程：初始全部 Primary 使用 Movie stem 导致目标碰撞；完成命名后发现元数据错误使用 Season 字段；修正后缺少隔离结算授权使事件等待，正式开启测试授权后完成 Commit。追加 Inventory Claim 断言最初写成 `.claims`，实际闭合类型字段为 `.items`，已修正。没有通过跳过阶段或弱化结算授权完成链路。

## 未完成范围

最终 `node scripts/helix-architecture-verify.js` 全部 251 个测试文件通过；包含修正后的2/24集完整Host测试、5项命名/逐集元数据专项及Movie回归，boundary/semantic/manifest/P2均通过，aggregate保持 `194ec732382eba05b763d22a49f36dcf28847944a378634a1762d09e22a3efa7`。日志保存在工作区外 `E:/my_project/helix-git-consolidation-20261008/series-ondeck-architecture.json`。此批仅贯通 Direct 新建 Season，不能覆盖 E03 追加、实际 Remux/Transcode、有上限 N:M 聚合接线、Related NFO/Aftercare/退出、真实媒体/Linux、Series Admin 页面与 UI 负责人验收、部署构建/回退资格。后续按同一活动 Phase 继续。
