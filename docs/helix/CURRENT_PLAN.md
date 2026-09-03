# ShelfDeck Clean Helix Master Plan

Status: **P1–P14 与 PROD-064 稳定化闭包完成；当前无活动实施阶段。**

Last updated: 2026-09-03

## 目标状态

- 维持 Procurement、Libra、Arca、User Perception、People Management 五域与两次单向 Handoff。
- Helix-beta 只声明 Movie 全链路；后续媒体 profile 不得借 Beta 名义提前纳入。
- 生产保持 `helix-clean-v3` 单一 clean runtime，不增加 migration、dual-read/write、旧 Runtime fallback 或影片特例。
- Admin Web、API、执行 Foundation 与生产工具继续只消费各 Owner 的正式事实和 typed contract。

## 当前里程碑

| 里程碑 | 状态 | Evidence |
| --- | --- | --- |
| Architecture Levels 0–10 / final audit | Closed | `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`、`ARCHITECTURE_REVIEW.md` |
| P1–P13 local implementation | Complete | `implementation/evidence/`、P13 E2E-ready package |
| Movie P14 qualification / Helix-beta production | Complete | `BETA_FEATURE_ACCEPTANCE_BASELINE.md`、acceptance evidence |
| PROD-032–064 production stabilization | Complete through PROD-064 | `PRODUCTION_DEPLOY_ISSUE_LOG.md`、production archive packet |
| Active implementation Phase | None | `implementation/CURRENT_PHASE.md` |

## 下一工作规则

1. 新工作先确认是 Architecture、Local Implementation、real-source E2E、Build/Canary 还是 Production。
2. 只有明确、当前、未被取代的问题进入唯一 `implementation/CURRENT_PHASE.md`；已结束历史只进入 issue log、
   evidence 或 archive。
3. Work Package 开始前冻结 SSOT 引用、Owner、typed I/O、Effect/transaction、负向夹具和停止条件。
4. 通过本包验证、边界审查与 Exit Audit 后才关闭；测试通过不能替代 Owner、恢复和授权证明。
5. Production、Formation Reset、真实媒体副作用和 `media-desktop` 分别需要明确授权，不能由本计划推断。
6. 部署固定使用 `scripts/build-image.js` → `scripts/upload-nas-image.js` → `scripts/deploy-nas.js`；
   当前精确身份以 `CURRENT_STATUS.md` 和 `docs/v3/VERSIONING.md` 为准。

当前没有下一 Phase 指针。新的用户目标出现前，不创建占位 Work Package，也不继续扩展已关闭的 PROD-064 事故工具。
