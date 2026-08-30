# ShelfDeck Clean Helix Master Plan

Status: **Helix-beta Movie-only full chain；当前进入 PROD-032 生产稳定化。**

Last updated: 2026-08-31

## 当前目标

完成一次可回滚的 Libra 有损升级：

1. 收敛并提交当前正式改动，删除一次性排障文件，保证 production image 可由唯一 clean commit 重建。
2. 修复 per-field Pre-deck token 的所有旁路：Intake replay、Routing、Subject Rating、Acceptance Spec、Run Creation、Formation 可见性。
3. 运行完整测试与安全检查；任何 Architecture/Contract gate 失败都阻止部署。
4. 使用标准 build → upload → deploy 流程；部署前停服务并备份完整 data，另执行 bounded Libra reset，清空 `/transcode`，不触碰正式媒体。
5. 部署后验证 health、schema、token occupancy、Formation active queue、旧 Run 终态以及非 ShelfDeck 容器。

详细实施边界和 Exit Gate 只在 `docs/helix/implementation/CURRENT_PHASE.md` 维护。

## 当前生产基线

- NAS：`192.168.12.230:18080`（production）。
- 现网镜像：`markmahoro/shelfdeck:helix-beta-20260830-5189f5f79c`。
- 现网 schema：186 tables；health `ok` / `helix-clean-v3` / `normalSupplyAllowed:true`。
- 现网只读盘点：720 active Subject；0 active Libra Run；Formation 712 pending + 2 in progress；pipeline token 0。
- 上一轮备份仍在 NAS；本轮必须创建新的唯一时间戳备份，禁止覆盖。

## 产品和架构边界

- Helix-beta 仍是 Movie-only journeys A–I；Series/JAV/Western Adult 是后续范围。
- 架构唯一 SSOT 是 `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`；本轮不移动 Owner/Handoff/Canonical Transaction。
- Procurement 只交付 Handoff A；Pre-deck admission 与生产节流归 Libra。
- Token 从 Intake admission 持有到 Handoff B Accepted 或用户 Discard；rejection 释放。0 席表示暂停该 Field。
- Formation 是当前工作视图，不等于所有历史 Subject 的数据库浏览器；tokenless、无 Run/Handoff B 的历史 Subject 不进入 active queue。
- 不删除、移动或改写 `/media` 正式媒体；不做 `--helix-clean-init`；不改 `media-desktop`。
- 通过测试只是部署门禁，不自动把任何 `HB-*` 标为 PASS。

## 后续

PROD-032 关闭后，恢复 Helix-beta 现行 acceptance baseline 的证据运行；不得把本次生产健康检查折算为产品验收。
