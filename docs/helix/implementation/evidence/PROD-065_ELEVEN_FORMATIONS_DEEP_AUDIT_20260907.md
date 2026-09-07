# PROD-065：9 项整理中与 2 项需要处理的完整排摸

2026-09-07；截止采样 16:06:20 CST。生产镜像仍为 `helix-beta-20260903-f05d694dfa`，本地修复基线 `8ec6be753`。本次只有只读数据库、文件、FFprobe、外部 GET 及纯函数复算，无生产状态推进。

## 1. 覆盖与结论

范围固定为 8 个 Arca offloading、1 个 Libra transcode、2 个 frozen；不包含另外 8 个 discarded/等待重新入库的 Subject。

- 核对了 8 个已交接 Package 的冻结 Acceptance Spec、精确引用的 Product Facts/Media Cast/Identity、Final Inventory Decision、实际最终 NFO/正片、原 NFO及目录成员。
- 8 个最终 NFO 用生产版与本地修复版 `compareMovieNfoPresentation` 分别复验，16 次全部匹配；当前 8 个旧 NFO也均满足对应 accepted presentation。这只能证明现在的呈现，不倒推已丢失的原 source witness。
- 8 个最终正片重新运行 FFprobe，编码、分辨率、音轨与体积未发现新的当前要求冲突。未执行完整播放/全文件解码测试，不将 FFprobe 成功视为全片无损证明。
- 8 个 source NFO 在本地均可生成新语义 witness：18–93 entries、2302–9776 bytes；用当前样本估算的新 Provenance 为 19136–36564 bytes，低于 64 KiB。未发现本批影片触发新 witness/Provenance 限额的隐患；估算不回写生产历史事实。
- 纠正上一份报告对 007 的判断：该片是已经修复的旧音轨算法留下的 frozen Run，不能再按当前音轨不合格解释。
- 新确认的本轮修复缺口是 **Settlement 失败信息被压缩成错误代码，丢失具体目录/文件清单**。另有已有网络错误诊断缺口仍未修复；未知目录成员预检过晚属于需要审计的流程改进，不把保护未知文件本身判成 bug。

## 2. 逐项检查矩阵

| 影片 | 已核验的后续成品/材料 | 当前阻断 | 此次新增判断 |
| --- | --- | --- | --- |
| 绣春刀 | 最终 NFO 两版语义 PASS；HEVC 1920×800，3.95 GiB≤14 GiB；8 项 Settlement succeeded | 原 NFO 6915→6898 bytes；仅 1 项 executing | 没有发现进一步的 NFO 字段或成品规格阻断；不能倒写旧正片路径 |
| 静水城 | 最终 NFO 两版 PASS；HEVC 1920×1040，8.33 GiB≤14 GiB；4 项 Settlement succeeded | 原 NFO 10871→9756 bytes；仅 1 项 executing | 没有发现进一步的成品验收问题 |
| 恋恋笔记本 | 最终 NFO 两版 PASS；HEVC 1920×816，4.43 GiB≤8 GiB；11 项 Settlement succeeded | 原 NFO 14571→13035 bytes；仅 1 项 executing | 与前两片同根因，不是大小上限问题 |
| 图雅的婚事 | 最终 NFO 两版 PASS；HEVC 1870×1032，2.89 GiB；当前无体积/分辨率强制上限；4 项 Settlement succeeded | 原 NFO 5309→4874 bytes；仅 1 项 executing | 1870 宽与 AAC 不违反该片冻结要求，不能因非标准宽度或普通音轨误判失败 |
| 霍比特人1 Extended | 最终 NFO 两版 PASS；HEVC 1920×804，10.87 GiB；当前无体积上限 | 5 项 executing；源目录未计划 torrent | 原 NFO 大小/hash精确匹配；不是 source NFO 改写问题 |
| 哪啊哪啊神去村 | 最终 NFO 两版 PASS；HEVC 1920×1038，5.65 GiB≤14 GiB | 7 项 executing；未计划 torrent、额外字幕、sample | 原 NFO 精确匹配；未知字幕/sample不得自动删除 |
| 夺宝奇兵5，2160p CMRG | 最终 NFO 两版 PASS；HEVC 3840×2160，13.04 GiB≤14 GiB | 3 项 executing；旧目录另一份1080p正片、NFO/字幕及公共图片 | 另一版本是必须保护的实际媒体；当前最终文件未超限 |
| Top Gun — Maverick IMAX | 最终 NFO 两版 PASS；HEVC 3840×2024，14.84 GiB；当前无体积上限 | 5 项 executing；未计划 torrent 与 10 张不同前缀图片 | 14.84 GiB 在本片不是超限；不能套用别片的14 GiB标准 |
| 哥斯拉大战金刚 | 转码前预检 PASS，原直接使用仅因 max_size_exceeded 被拒；5 个原材料都存在，目录无额外成员，未发现失败 Attempt | 正常 GPU 转码，16:06 为45.7%，预计剩余约83分钟 | 当前不是停滞；但仍运行旧代码、旧 Observation 无新 witness，后续 Emby 改写时仍可能触发已知 NFO 缺陷，不能提前保证会完成 |
| 寒战2 | 原文件实际 H.264 3840×1632，4.71 GiB；NFO身份416249；带生产凭据和代理 GET 返回200、寒战2、2016-07-08 | 历史网络失败三次后 frozen | 当前 exact identity HTTP 请求已恢复；后续 H.264→HEVC是正常生产步骤，不是新增缺陷；历史网络原因已被抹去，无法追认具体DNS/TLS原因 |
| 007：大破天幕杀机 | 补购 Workspace 文件仍存在，25.62 GiB，HEVC 3840×1604、含TrueHD；当前纯函数对原冻结输入复算 PASS | 旧算法产生的 primary_audio_unmet 与 frozen 结果保留 | 无需以更换默认/首音轨或再次下载为前提；恢复需保住现有合格25.62 GiB文件，不能在Reset时未经安排丢弃 |

同名/当前文件存在不产生 Shelf Entry；8 个 Arca Run 仍没有完整 On-deck Commit。27 个 Settlement Event 成功、24 个 executing；后者均为已知 NFO/目录阻断，不能把 executing 数量解释成24部电影。

## 3. 007 的精确反证与报告更正

原验证 Event：`libra-external-import-verify-event-522303ab69dbc3351bcb91d4711561e2dae97a4e`。

只读取得其原 Plan 的 `projected_event_results` binding、原 import/probe Result，用生产现有 `createExternalMaterialProjections` 重建输入，再调用 `buildProductMediaVerification`，使用原 verifiedAtMs：

| 项 | 历史结果 | 当前代码纯函数复算 |
| --- | --- | --- |
| Input digest | `d2c1d78e71cde5f02dd6856e580dff3b60373d2efbc02e204d8b4a4c75271a4f` | 完全一致 |
| result | failed | passed |
| reasonCodes | primary_audio_unmet | 空 |
| primaryAudioClasses | other | other、truehd |

生产代码和 SSOT 5.5.7 都已经规定：容器内任意一条正式 Probe 音轨符合白名单即满足，语言、顺序、default不参与判断。`c77cd9995` 于09-03 10:05修正该算法，当前镜像包含修正；007 的冻结发生在此前。旧 Run 不会因更新代码自动重写失败结果，frozen不得原地复活属于已有合同，不能列为新调度缺陷。

上一份报告“需核对当前主音轨选择/采购要求”的疑点现已关闭；不能据旧 qualitySummary 推断当前仍存在首音轨算法缺陷。本次没有改历史 Result。

## 4. 已确认待修复的问题

### D1：本轮 Settlement typed failure 丢失具体故障证据

定位：`media-service/src/helix/domains/arca/capabilities/on-deck-capability-ports.js` 的 `settlementPreconditionFailureOutcome`。

Inventory adapter 会给出 `details.sourceDirectory/unknownNames`，Final NFO semantic failure还会给出field/reasonCode；该转换仅保留message和`evidence:{errorCode}`。原始名单不会随 typed outcome进入后续处理。

本地纯函数复现：分别输入相同目录下 `extras.torrent` 和 `another-movie.mkv` 两个 `CLEAN_ARCA_SETTLEMENT_UNKNOWN_MEMBER`，生成Outcome的canonicalDigest完全相同。两种实际需要不同处置的事件被压成相同证据。此缺口在本轮本地修复版仍存在，之前验收只证明失败终态收敛，没有覆盖“用户凭持久化证据能够处理”的完成标准。

影响：NFO修复后不再无限运行，但用户仍可能只看到需要处理/错误代码，无法知道是哪个目录、哪类文件，也不能区分语义冲突字段。需保存有界、脱敏的结构化原因及可追溯定位，并贯通Owner查询与UI；不要将任意Error.details直接暴露。

必要回归：两种不同未知成员产生可区分的持久化事实；重启后仍能读出具体原因；NFO字段冲突可定位；证据超限有明确处理；不泄露Secret、不扩大删除授权。

### D2：Provider底层失败原因被抹去（已有、未修复）

定位：`media-service/src/helix/integrations/tmdb-provider-adapter.js` 的 `fetchJson` catch。普通网络异常被统一替换为 `PLATFORM_INTEGRATION_NETWORK_FAILED`，不保留原cause code/阶段；图片请求分支也存在类似归并。

本次先通过同代理无凭据GET收到401，再通过现有Secret Store只读解密并使用生产凭据GET `/movie/416249`，返回200及正确身份；凭据始终只在NAS进程内使用，未输出或落盘。只证明当前请求成功，不证明历史故障是何种网络原因，也不把HTTP单次成功当作Libra整链已恢复。

必要修复：保留脱敏的DNS、连接、TLS、上游响应、超时类别及关联信息；按照既有重试合同消费，不据通用网络错误无限循环或绕过身份校验。历史证据缺失无法通过新代码补回。

## 5. 需要继续审计的流程改进，不冒充已确认新缺陷

1. 未知成员直到Settlement才检查，四部已经完成复制后才卡住；建议在搬运前增加同一Arca责任范围内的只读预检，末次删除前检查仍需保留。SSOT要求保护未知成员，不能改成“忽略未知文件并算上架成功”。前移是否增加正式Evidence/输入合同需按现有Owner固化。
2. 《夺宝奇兵5》暴露多版本共目录，《Top Gun》暴露附属图片命名前缀与正片不一致。需审计前序Related识别为何不纳入这些成员；当前证据不能证明它们都应被归入当前Product，也不能扩大至整目录接管。
3. 恢复必须区分历史失败与当前可复现错误。007算法已修、寒战2当前网络已通；UI仍显示旧冻结记录并不等同于修复失效。需要明确恢复路径与保留文件清单，不要继续对已经修好的音轨算法叠补丁。

## 6. 上线与恢复前的结论

- 本轮NFO语义连续性与无限恢复修复仍有价值，生产尚未应用；D1应补进本轮局部修复验收。
- D2作为独立网络可诊断性修复，不改变Libra/Provider事实边界。
- 未发现8部最终NFO新的语义不合格、正片格式/体积不合格或当前样本witness限额问题；不需要为这些未复现的假设增加兜底。
- 哥斯拉进度21.5%→45.7%，当前媒体和Workspace磁盘可用空间充足，未见I/O空间耗尽证据。不能把正常转码并入故障Reset。
- 007现有合格文件应纳入恢复保留清单；旧Observation补证、修改历史Result、强行成功均不属于本次审计操作。
- 无代码修复、生产部署或生产恢复在本次审计中执行。原始JSON/Probe/NFO只存工作站临时目录，仓库仅保存摘要证据。
