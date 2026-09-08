# PROD-074 / PROD-075：额外分支证据（主线后实施）

2026-09-08，用户指定先完成健康/Case主线，以下两项单独登记；本文件是问题证据，不是平行活动计划。

| ID | 问题 | 已证实证据 | 后续验收 |
| --- | --- | --- | --- |
| PROD-074（原BR-01 / UAT-079） | Libra 评分目标仍取目录 Claim，身份确认后未有效重算评分与要求 | 霍比特人目录 title 包含 Extended Edition，查询摘要精确复现 not_found；豆瓣 2 星记录早已存在；Libra 无上限 direct_input，上架后规范片名匹配 2 星触发 4 GiB维护 | 原目录弱标题→正式身份→Rating Resolution→Acceptance Spec→实际生产/上架完整回归；审查 SSOT 5.6.3 的首次弱身份与禁止 provisional Run边界，不直接按历史UAT改Owner |
| PROD-075（原BR-02） | Aftercare 视频码率质量保护未与 Libra 对齐 | 当前预算只以100,000 bps判断可执行；霍比特人目标1,475,269 bps；Libra below_4k 2星策略底线2,000,000 bps，再与源码率取较小值 | 同源probe/音轨/时长/体积输入对照；不可满足体积时维持质量保护，走正式可解释结果，不盲目压缩 |

详细时间线与物理证据见 AFTERCARE_HEALTH_CASE_IMPLEMENTATION_20260908.md 后两节。上述分支未修复、未验收。UI倍速显示修正属于主线真实过程展示，不改变编码预算或媒体处理策略。
