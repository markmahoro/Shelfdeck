# Arca On-deck 目标碰撞：媒体 vs 非媒体（2026-10-30）

Status: **implementation slice for first On-deck** — rename-own-write 已废止。

## Problem

首次 On-deck 在**计划成员目标路径**上对「字节不符」一律 `TARGET_OCCUPIED` / Attention。DDOB-019 类残留同名 `.nfo`（非媒体）因此整单冻结。异名外来文件本就不挡 stage；真正缺口是 **非媒体同名应可覆盖**，**媒体同名必须 Attention 防误覆盖**。

## Contract（最终）

1. 不以「整夹未知成员」作为首次 On-deck 占用门禁；异名外来文件不挡。
2. **媒体**（非 `isLibraryPresentationRole`：主要为 `primary_payload` / `structural_dependency`）同名冲突 → Attention，禁止静默覆盖。
3. **非媒体**（`metadata_sidecar` / `poster` / `fanart` / `subtitle` / `sidecar`）同名冲突 → **直接覆盖**，不为此冻结。
4. **禁止** rename-own-write / 双 nfo 共存方案。

## 本 PR 范围

- `clean-arca-inventory-port`：`stage` / `switchPlacement` / `materialize` 首次落盘碰撞。
- 同根 managed NFO settlement 映射门禁仍仅对 managed source；外来残留 presentation 走覆盖，不再误入「无 related mapping」冻结。
- 测试：残留 nfo + 异名外来不挡；媒体同名仍 `STAGE_TARGET_OCCUPIED`。

## 非目标（另 PR）

- JAV short 空目录独占、`CLEAN_ARCA_JAV_SHORT_TARGET_OCCUPIED`
- JAV 纠正 / US Adult 发布 / Series root / Aftercare settlement closed-world
- 部署 / 生产清残留
- 新增 Formation 中间态兼容

完整审计：Project store `docs/arca-target-occupancy-compat-audit.md`。
