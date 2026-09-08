# ShelfDeck 当前迭代计划

更新：2026-09-08。ACTIVE；[UAT总表](UAT_ITERATION_REGISTER.md)是唯一完整迭代入口。所有功能、修复、UI与运维使用UAT编号，PROD/UX/AC/BR仅为历史别名。唯一执行包：[CURRENT_PHASE](implementation/CURRENT_PHASE.md)。

## 逐项推进顺序

1. **UAT-220**：完成总表合并、编号覆盖、状态证据对账与规则同步；历史缺口必须落到对应行，不藏在汇总待办。
2. **UAT-211**：修正已完成Settlement历史路径的健康检查边界。
3. **UAT-213 → UAT-212**：先冻结维护创建目标，再整合维护/收藏UI、历史解释与真实两页响应；e6b7f0424仍待整合。
4. **UAT-214 → UAT-215 → UAT-210**：人物观察、Arca上架旧目录收尾、健康/Case节流全链路剩余验收分别完成。
5. 各项按依赖测试及统一标准部署，逐行记录用户结果；需要生产验收的先验收再关闭，不能仅凭health端点或测试通过。
6. **UAT-250**：整理区存量治理，依赖UAT-212正确区分历史/当前；保留正常任务，活着冻结单独核查，生产修改须精确授权。**UAT-216**：存量旧目录按精确清单及授权独立处置；Top Gun只关闭其单项处置，不代表收尾流程已完成。
7. **UAT-217 → UAT-218**：主线后处理评分身份与码率保护。**UAT-219**及总表其他未关闭历史项按证据、优先级逐一核实；不按编号机械排序，不以同主题直接合并复发。
8. 最后清理本任务临时文件/废弃worktree；先核对归属、引用和回滚用途，保留审计与生产恢复资料。

## 授权与边界

用户授权先合并完整台账，再逐项推进关闭；本轮既有实施、本地测试后标准部署授权保留。具体合同变化按确认范围回写，新的物理处置仍需精确授权。Emby审查停止、5分钟自动化PAUSED。保护已上架事实，不清库、不重新退收藏，不以手改灯色或删额外NFO掩盖健康检查缺陷。

## 工作区与交付

| 工作区 / 分支 | 归属与当前用途 |
| --- | --- |
| E:/my_project/emby_third_party-helix-iteration / codex/user-pain-iteration | 本任务集成区；代码基线1755743c1，承担主线合同/后端/整合发布；本次文档整理记UAT-220 |
| E:/my_project/emby_third_party-helix-care-clarity / codex/formation-care-clarity | 用户指定任务“澄清媒体整理维护状态”；UAT-212交付e6b7f0424，基于1755743c1；未整合、未部署 |
| E:/my_project/emby_third_party-helix / main | 主工作区，未作为本次编辑目标 |
| emby_third_party-helix-baseline / codex/collection-clean-baseline | UAT-209历史基线，保留 |
| emby_third_party-helix-prod065 / codex/prod065-settlement-failure | UAT-208历史修复，保留 |

其余Codex worktree尚未完成归属/引用审查，不自动删除。分支和目录无需为编号批量改名；UAT通过台账、提交和证据映射追溯。历史工作流水已冻结到[整理前快照](implementation/archive/20260908_PRE_PROD_CONSOLIDATION/CURRENT_PLAN.md)。
