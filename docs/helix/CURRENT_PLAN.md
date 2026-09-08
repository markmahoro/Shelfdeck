# ShelfDeck 当前迭代计划

更新：2026-09-08。ACTIVE；本轮未完成。全部功能、UI及修复使用[统一PROD台账](PRODUCTION_DEPLOY_ISSUE_LOG.md)，历史别名不再扩展。唯一执行包：[CURRENT_PHASE](implementation/CURRENT_PHASE.md)。

## 执行顺序

1. **PROD-078**：先完成工作区归属、编号与工程文档整理，本步不实施功能或操作生产。
2. **PROD-067/068/070/071/072**：完成健康/Case全链路开放合同与后端修正；旧目录回收纳入Arca上架收尾，和健康检查分开。
3. **PROD-069**：审查整合UI任务交付，保持列表与详情设计克制；与后端依赖一起完成真实浏览器验收。
4. 主线统一测试与标准部署，按具体PROD记录生产验证；已授权测试后部署，无须重复申请。不得以health端点正常代替用户场景通过。
5. **PROD-073**：存量旧目录按精确清单及物理处置授权独立推进、独立验收；不是流程修正完成的证明。
6. **PROD-074/075**：主线后处理评分身份与码率保护支线。**PROD-076/077**保留后台待办，先核实历史Evidence，不扩大当前UI重设计。
7. 最后清理本任务临时文件、备份与废弃worktree；先核对归属/引用/回滚用途，保留生产回滚材料和审计证据。

## 当前授权与边界

用户授权本轮合同同步、实施、本地测试后标准生产部署；具体合同改变按已确认范围回写，工程规则不能撤销用户授权。当前最新要求先整理文档。Emby审查停止，5分钟自动轮询保持PAUSED。保护现有已上架事实；不执行清库、重新退收藏或未经精确授权的源文件清理。完成Settlement的历史路径不再重复充当健康缺口；额外NFO的物理清理不是变绿前提。

## 工作区与交付

| 工作区 / 分支 | 归属与当前用途 |
| --- | --- |
| E:/my_project/emby_third_party-helix-iteration / codex/user-pain-iteration | 本任务集成区；代码基线1755743c1，承担主线合同/后端/整合发布；本次文档整理记PROD-078 |
| E:/my_project/emby_third_party-helix-care-clarity / codex/formation-care-clarity | 用户指定任务“澄清媒体整理维护状态”；PROD-069交付e6b7f0424，基于1755743c1；未整合、未部署 |
| E:/my_project/emby_third_party-helix / main | 主工作区，未作为本次编辑目标 |
| emby_third_party-helix-baseline / codex/collection-clean-baseline | PROD-066历史基线，保留 |
| emby_third_party-helix-prod065 / codex/prod065-settlement-failure | PROD-065历史修复，保留 |

其余Codex worktree尚未完成归属/引用审查，不自动删除。分支和目录无需为编号批量改名；PROD通过台账、提交和证据映射追溯。历史工作流水已冻结到[整理前快照](implementation/archive/20260908_PRE_PROD_CONSOLIDATION/CURRENT_PLAN.md)。
