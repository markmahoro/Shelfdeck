# Movie Optimize Policy Calibration

Status: accepted calibration evidence; not runtime acceptance evidence.

Last updated: 2026-07-13

## 1. Accepted baseline

Movie Optimize Policy的Beta空间上限固定为：

```text
1 star -> 2 GiB
2 star -> 4 GiB
3 star -> 8 GiB
4 star -> 14 GiB
5 star -> 50 GiB
```

全部档位同时要求HEVC与`mediaForm=stream_file`；5星额外要求4K和高质量音频。空间上限
不是目标文件大小，Planner不得补大较小文件。

5星高规格音频白名单为E-AC3 Atmos、TrueHD、TrueHD Atmos、DTS-HD MA和DTS:X；普通
AC-3、非Atmos E-AC3、DTS Core、DTS-HD HRA、AAC、MP3、FLAC和PCM不满足。Kairox不提供
音频转码Capability；现有合格主音轨只能原样保留，缺失时只能通过Upgrade补齐。

Beta候选选择沿用MoviePilot音频声明，不增加Replace前专用验证层。真实文件替换并完成
Source rebind后，由独立Basedata refresh发布Audio Track Facts；Lifecycle只有在这些Facts
满足白名单时才通过Optimize Gate。未关闭Audio Gap时，Task Creator按
`subjectId + optimize + objectiveRevision`的一次automatic attempt额度拒绝新Task，Run据此
以`automatic_attempt_limit_reached`进入unachievable `abandoned`；Facts、Admission、rebind
或Run变化均不能重置额度，同一maintenance intent也不得自动重建Run。

## 2. Data source

校准只读取历史生产ShelfDeck备份，不关联或修改`Z:\Film`：

```text
library.db
config.nas-original.json
Library: 公共_电影_原生
Library UUID: c06f84a5-9f76-4f7b-87fb-be7993642b4a
```

备份共有924项公共电影，全部具有size；112项具有`user_rating`，790项具有
`douban_stars`。有效评分优先使用`user_rating`，否则使用Douban评分；900项有有效评分，
24项无评分。

## 3. Earlier loose-cap analysis

在最终档位确认前，曾用较宽松的`4/6/12/22/38 GiB`测算现有分布：

| Rating | Items | Actual TiB | Over cap | Upper-bound reclaimable TiB | Non-HEVC | 5-star non-4K |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0 | 0.000 | 0 | 0.000 | 0 | 0 |
| 2 | 1 | 0.031 | 1 | 0.025 | 0 | 0 |
| 3 | 321 | 2.945 | 79 | 0.689 | 37 | 0 |
| 4 | 405 | 4.986 | 42 | 0.574 | 79 | 0 |
| 5 | 173 | 3.982 | 34 | 0.471 | 85 | 138 |

汇总：

```text
rated current size             11.944 TiB
unrated current size            0.432 TiB
over-cap items                    156
upper-bound reclaimable         1.759 TiB
non-HEVC items                    201
5-star non-4K items               138 / 173
```

该结果说明早期3星、4星上限偏宽，且5星强制4K会产生显著Upgrade需求，因此5星不能按纯
节省空间档位理解。最终采用`2/4/8/14/50 GiB`，分别表达低评分压缩、标准收藏、高质量
收藏与精品收藏。

## 4. Evidence limits

- `upper-bound reclaimable`只计算`sum(max(0, currentSize - cap))`，不是输出文件预测。
- 测算没有模拟HEVC转码、真实编码复杂度、音轨开销或5星Upgrade后的体积变化。
- 5星非4K数量表示潜在Objective Gap，不证明MoviePilot存在合格Upgrade候选。
- 24项无评分媒体按当前合同不能On-deck；本报告不为其补评分。
- 最终`2/4/8/14/50 GiB`仍需由未来Planner实现和真实E2E验证，本文只保留决策依据。

## 5. Reproduction

只读分析脚本：

```text
media-service/scripts/analyze-movie-size-policy.js
```

示例：

```powershell
cd media-service
npm run analyze:movie-size-policy -- `
  --data-dir ..\.codex\local-prod-data `
  --config ..\.codex\local-prod-data\config.nas-original.json `
  --library 公共_电影_原生
```
