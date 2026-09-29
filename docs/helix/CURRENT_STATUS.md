# ShelfDeck 当前状态

更新：2026-09-30。Helix Beta Movie 全链路获用户阶段验收，Movie 打通阶段已收尾；当前活动阶段为 Series 开发准备（UAT-279）。记录与证据边界见 [UAT-278](implementation/evidence/UAT-278_BETA_MOVIE_CLOSEOUT_20260930.md)。Series 尚未交付，未声明新的技术资格总体 PASS 或正式 release tag。

## 最近已记录生产身份

| 项目 | 值 |
| --- | --- |
| 镜像 | `markmahoro/shelfdeck:helix-beta-20260928-c147188485` |
| 源码 | `c14718848597063dcd28fed002ae8e5e5897a7e5` |
| tar SHA256 | `df9a74befe6ac9bd5ac3014222598c2ff7bd57f1958079decb6aaa4c14400ffa` |
| NAS Image ID | `sha256:a928dc2cb13a03e6e379f3f88420a104dbf83d06fe658b0192a6d9de6a4e9fb0` |
| StartedAt | `2026-09-28T15:19:12.747534143Z` |
| 发布 Evidence | [UAT-275/276/277](implementation/evidence/UAT-275_276_277_ONDECK_FAILURES_20260928.md) |

该发布 Windows 架构241文件、适用真实媒体与精确 Linux 镜像、完整候选/同库回退 Host、标准发布及8类事实摘要保护通过；全量 Service/Desktop/全库整理 E2E 未运行，历史失败片未重跑。上线前后321 Shelf Entries/24635 Inventory Materials不变，未 Reset 或自动重跑。以上为证据记录，本轮没有连接生产重新核验。

## 已接受成果与保留事项

- 2026-09-30 用户确认当前运行比较稳定，接受 Helix Beta Movie 全链路阶段成果。Beta 保持 Movie-only A–I；Series 不追认进原 Beta。
- 现有 UAT 逐项状态见[总表](UAT_ITERATION_REGISTER.md)。已部署、待实际影片或完整业务验收的项继续开放；历史待核实记录不能直接视为当前缺陷。
- 2026-09-29 “检查整体运行状态”聊天只读检查报告：health/Admin 200、无容器重启/OOM，转码仍推进，最近一小时14次成功无新增失败；321上架，保管检查正常。标准符合性63项及呈现5项降级可能重叠，未逐项核验，不据此宣称全部收藏健康。
- 同次检查保留三项风险：《侏罗纪公园2》记录94.4%但输出增长；73次监听器超限警告；系统盘85%/约28GB可用。关联 UAT-127/170/212、125/152、262；后续操作前刷新，未在本轮修复或清理。
- 已上架瑕疵条目不追溯重加工、不撤销上架、不因新接纳标准触发历史瑕疵修复。未完成 Formation 条目仍按 Playbook 的精确授权及 clean-cut 纪律处理，当前没有新增 Reset 授权。

## 当前准备与归档

已有 Series Handoff A、Run layout/lifecycle、PBF-20 Episode Claim 合同测试，以及 TMDB tv/Season Artifact 接线；本轮仅检查源码与测试内容，没有执行 Series E2E 或宣称支持可用。UAT-279 的差距、范围草案和下一步验证均在[唯一 Phase](implementation/CURRENT_PHASE.md)。

原活动文档及残余队列已冻结到[Movie 收尾快照](implementation/archive/20260930_BETA_MOVIE_CLOSEOUT/SNAPSHOT.md)。当前代码/文档交付基线 `ecccf7ba9b`，隔离分支 `codex/beta-closeout-series`。未覆盖主工作区和集成区的用户修改，未删除 worktree。

本次仅文档整理及只读代码审查；未构建、部署或改动生产/媒体。部署集中负责人职责已按用户2026-09-28决定取消，UI负责人职责保留。
