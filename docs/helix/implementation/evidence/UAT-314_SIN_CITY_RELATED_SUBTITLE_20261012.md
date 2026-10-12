# UAT-314 正片与sample重复独占字幕导致验收阻塞

2026-10-12后续处置：用户明确授权放弃正片本轮整理。首次正式入口因环境问题返回500、无终态变化；获授权清理满盘旧镜像后原幂等命令200/discarded，Run revision3、Token=0，正式Receipt见[UAT-317复验](UAT-315_317_PRODUCTION_DIAGNOSIS_20261012.md)。仅处置本轮，不关闭sample关联缺陷，不改动已入藏sample。

2026-10-12最新用户决定：sample相关问题先放一放，作为待优化点。本项附件重复归属缺陷，以及sample识别、关联正片、避免独立上架、正片完成后清理的优化诉求均暂不推进；保留诊断及未修复状态，不关闭。本记录不授权处置已入藏sample或生产媒体。当前重点为剧集版本上线后问题监控。

2026-10-12用户要求追查《罪恶之城》`CLEAN_ARCA_PRODUCT_SOURCE_MISSING`和席位占用。生产只读诊断及本地纯函数复现完成；未修改生产文件/数据库，未恢复字幕、放弃、Reset、重启或部署。

## 证据与时间线

1. 2026-08-28 23:07:33/37（北京时间），同一采购Run `procurement-run-e50889a792ed26a99943ccb99f759f007fac1f91`先后发布sample Candidate `candidate-package-dee5ff4b90b01c215bdb752710e1e54f6b135b0b`和正片Candidate `candidate-package-6fcc88d07df5c9b9a44f95954c3a04e192e8e6c3`。
2. 二者均把字幕Material `7f05fd5f72f418e74e62a11527f2cd81151881c0785a5f9e0b58f491d8b85db8`记为`exclusive / disposition_required=1`。原路径为`/media/Film/罪恶之城 - Extended Edition (2005)/罪恶之城 - Extended Edition (2005) 1080p DTS-sample.chinese(简英).default.ass`，345436 bytes。
3. sample于2026-09-25 15:02:01完成收藏提交；On-deck Run `65cc3a3cc8abe0e1e7da01d17558830b6f79c174e671181c105ee47e97a25b0e`有正式stage及input_settlement.delete Result：先验证最终字幕，再清理旧路径，`absent=true / settled_to_final / final_verified=true`。目标位于`/media/Film/罪恶之城 (2005) - Extended Edition (2005) 1080p DTS-sample/`。
4. 2026-10-12只读复验目标字幕仍存在，345436 bytes，middle-256k-sha256为`3e40e0068ed4bff2c3532468217d4acf60853e98c32a9c7ac89ec56762c6089f`，与历史原字幕及Inventory记录一致。没有字幕内容丢失证据；正片MKV和正片自身`.chinese(简).srt`亦在原目录。
5. 正片今天17:36:16建立新Libra Run `bec197dfd3585fb5084d50fcd03ed562aa7e3d253867d648f3ee39b24959b094`，沿用上述8月已发布Candidate。新Package `a63da6ad41e0891a3f7494546a1e020e873fd0f029069be8c5b29b6309c95087`仍含sample字幕旧路径。
6. Offer `c09a5c83a5ba528bb58480909340408a6becb55c5687f2fdb7ca5cb19c64bc86`两代acceptance_assessment均在inventory_feasibility观察失败；身份/媒体/资料等检查成功不证明所有交付成员存在。Recovery为attention_required；无Accepted/Rejected Receipt和Libra终局，正片仍占一个predeck token，页面投影仍显示等待收藏架验收。

## 根因与复现

`procurement-candidate-context-reader.js:reconstructRelatedReferences`按每个Candidate自己的Primary stem判断`stem.startsWith(primary + '-')`等前缀，不排除同目录另一个更具体Primary的附属文件。`Sin.City.2005-sample.chinese.default.ass`因此同时匹配`Sin.City.2005.mkv`与`Sin.City.2005-sample.mkv`，两次均赋予exclusive。

本地通过内存加载当前真实模块、仅暴露该纯函数，分别输入上述两个Primary与同一字幕Observation，两次均返回相同字幕的exclusive关联。未编辑产品源码、未建立生产副作用。说明缺陷不只存在于历史Package，不能以Reset代替修复。

SSOT多Movie目录只允许唯一same-stem Related，exclusive处置义务必须有唯一依据。修复属于Procurement关联Owner，不能由Arca忽略缺失成员、偷取已入藏sample字幕，或改写immutable Package绕过。历史样片收藏保持既有保护范围，不因本项诊断擅自退出或重加工。

## 待修复及验收

- 根据同一冻结Observation/Scope的完整Primary竞争关系消除前缀歧义，覆盖正片/sample、不同版本与合法语言/音轨后缀；不能简单全局排除带sample字样的所有媒体。
- 核对新Candidate不再重复独占，顺序处理后一项不依赖被前项已结算的旧位置。
- 当前旧正片Package处置须单独明确，保护样片现有Inventory与正片原文件，不增加未经授权的旧Run兼容。
- attention_required、正式终结与席位释放按当前Owner合同独立验收，适用UI修正须负责人验收。尚未修复或关闭。
