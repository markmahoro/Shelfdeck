# PROD-032 — Pre-deck Pipeline Stabilization

状态：**COMPLETE / DEPLOYED**

日期：2026-08-31

## 目标与根因

生产有 720 个 active Subject、0 active Libra Run、0 token，但 Formation 仍显示 712 pending、2 in progress。历史 succeeded Intake Evidence、Routing、Subject Rating、Acceptance Spec 和 ready-run fallback 绕过 token；Run Admission 又过早释放 token，导致 Pre-deck pipeline 无法按 Field 席位收敛。

## 实施

1. Intake Evidence 提交和 replay 都必须先占 per-field token。
2. Routing、Subject Rating、Acceptance Spec、Run Creation fallback 只推进 token holder。
3. Token 持有到 Handoff B Accepted 或用户 Discard；Intake Rejection 释放。
4. Formation active view 只展示 token holder 或已有 Run/Handoff B 的 Subject；历史事实不删除。
5. Admin GET 纯读、重复 PATCH durable no-op；production image 强制 clean exact-commit build。
6. Reset 同步取消 Libra Work/Event/Attempt/Resource Defer，并 fail-closed 限制 `/transcode` 清理范围。

## Exit Evidence

- Commit：`710aa1b65a`。
- Image：`markmahoro/shelfdeck:helix-beta-20260831-710aa1b65a`。
- Tar SHA-256：`19292cef75f10eb5216f52c41cdb8fc8f50ab156e6dcc27cf7c6c4c4809c8733`。
- Backup：`/vol1/1000/docker/shelfdeck/data.backup-20260830T170231Z-predeck-pipeline`。
- Reset：0 resettable Run、200 retired Libra Work、0 reclaimed Workspace、0 removed `/transcode` entry；policy preserved。
- Post-deploy：health `ok`，schema 186，integrity `ok`；3 seats / 3 tokens / 3 active Work / 0 active Run。
- Formation：3 pending、2 in progress、6 completed；active section 5 items、无分页。
- Tests：Service 357 pass / 18 skip / 0 fail；Architecture、Product Surface、Admin Web、audit 和 deploy gates 全绿。

未触碰 `/media` 正式媒体，未删除 Subject，未执行 `--helix-clean-init`，未改变任何 `HB-*` 验收结论。
