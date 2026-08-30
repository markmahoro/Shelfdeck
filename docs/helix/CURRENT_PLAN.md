# ShelfDeck Clean Helix Master Plan

Status: **Helix-beta Movie-only full chain；PROD-032 已关闭，等待下一项明确工作。**

Last updated: 2026-08-31

## 当前基线

- NAS production：`192.168.12.230:18080`。
- Image：`markmahoro/shelfdeck:helix-beta-20260831-710aa1b65a`。
- Health：`ok` / `helix-clean-v3` / `normalSupplyAllowed:true`；schema 186；SQLite integrity `ok`。
- Libra Pre-deck：唯一 Field policy 为 3 seats；生产复查为 3 tokens、3 active Works、0 active Runs。
- Formation：3 pending、2 in progress、6 completed；active section 仅 5 条。
- Rollback backup：`/vol1/1000/docker/shelfdeck/data.backup-20260830T170231Z-predeck-pipeline`。

## 已完成

PROD-032 已修复 Intake replay、Routing、Subject Rating、Acceptance Spec、Run Creation 和 Formation visibility 的 token 旁路；token 生命周期延长到 Handoff B Accepted / Discard，Intake Rejection 释放。生产有损升级终止了 200 条遗留 Libra Work，并让现存 Handoff A Package 重新按 Field seats 进入 Libra。

## 下一步规则

- 恢复 Helix-beta 现行 acceptance baseline 的证据工作时，仍以 `BETA_FEATURE_ACCEPTANCE_BASELINE.md` 为准；本次 health 与稳定性检查不能折算为 `HB-*` PASS。
- 架构唯一 SSOT 仍为 `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`；不因生产修复移动 Owner、Handoff 或 Canonical Transaction。
- 生产继续使用 `scripts/build-image.js` → `scripts/upload-nas-image.js` → `scripts/deploy-nas.js`；有界 Pre-deck reset 仅使用 `scripts/predeck-pipeline-upgrade-nas.js`。
- 不删除、移动或改写 `/media` 正式媒体；不做 `--helix-clean-init`，除非 Product Owner 明确授权。

当前没有活动 Local Implementation Phase；状态见 `docs/helix/implementation/CURRENT_PHASE.md`。
