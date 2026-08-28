# Helix-beta 生产部署问题台账

状态：`NAS PRODUCTION ISSUES OPEN / NO FIX AUTHORIZED IN THIS DOCUMENT`

建立日期：2026-08-28

环境：飞牛 NAS `http://192.168.12.230:18080`，容器 `shelfdeck`。首次 cutover 镜像 `helix-beta-20260828-a3e07a1e1`；当前运行镜像以 `docs/v3/CURRENT_STATUS.md` 为准。Admin Web 走 HTTP，不是 localhost，也不是 HTTPS。

本文记录 **Helix-beta 部署到该生产环境之后** 用户实际碰到的问题。它不是 Architecture SSOT，不替代 `CURRENT_PLAN.md`、`USER_ACCEPTANCE_TEST_ISSUE_LOG.md` 或 `ADMIN_WEB_UX_ISSUE_LOG.md`。Canary/UAT 历史缺陷继续记在原台账；本文只收生产现场。

记录原则：

- 先记用户可见结果和可复核证据，再写初步根因；
- 区分产品缺陷、展示缺口、配置选择和环境限制；
- 不因后台事实最终正确就忽略「当时页面看起来已经结束」；
- 不在本文写入 API Key、Secret、Cookie 或其他凭据；
- **本文不授权实现。** Product Owner 于 2026-08-28 明确：先开文档，先不修。已在现场热修的项只作为历史关闭记录，不把未授权项一并修掉。

## 1. 总览

| ID | 问题 | 分类 | 页面 | 严重度 | 状态 |
| --- | --- | --- | --- | --- | --- |
| PROD-001 | 打开「文件来源配置」整页白屏 | `USER_EXPERIENCE` / 浏览器安全上下文 | 文件来源配置（收藏架配置同样会中招） | Critical | 已热修并部署 `helix-beta-20260828-ef8eec0dc` |
| PROD-002 | 保存文件来源时报 `Cannot read properties of undefined (reading 'digest')` | `USER_EXPERIENCE` / 浏览器安全上下文 | 文件来源配置 | Critical | 已热修并部署 `helix-beta-20260828-c71149f17` |
| PROD-003 | 采购显示「已扫描完成 72 页」，媒体整理工作区当时一条都没有 | `USER_EXPERIENCE` | 文件来源配置、媒体整理工作区 | High | **OPEN / 先不修** |
| PROD-004 | 文件来源与收藏架都指向容器路径 `/media/Film` | 配置选择 / 后续 Settlement 风险 | 文件来源配置、收藏架配置 | Medium | **OPEN / 先不修**（SSOT 允许同根，不是当前空工作区的原因） |

PROD-001、PROD-002 的共同环境前提：生产管理台是 `http://192.168.12.230`，浏览器不提供 `crypto.randomUUID` / `crypto.subtle`。这不是传输加密设计，只是浏览器 API 限制。未改成 HTTPS。

## 2. PROD-001 — 文件来源配置白屏

发现：2026-08-28，用户登录后跳转「文件来源配置」。

现象：该页主内容空白。根因是页面 mount 时 `useState(newFieldId)` 调用 `crypto.randomUUID()`，HTTP 局域网下该函数不存在，未捕获异常导致白屏。「收藏架配置」同样在 mount 时生成 ID，会同样崩。

处理：`media-service/web/src/helix/id.ts` 在无 `randomUUID` 时回退 `getRandomValues`。现场热更新到 `helix-beta-20260828-ef8eec0dc`，未清库。

## 3. PROD-002 — 保存来源时 digest 报错

发现：2026-08-28，用户按 `/media/Film` 保存文件来源。

现象：前端提示 `Cannot read properties of undefined (reading 'digest')`。根因是登记时计算 `policyDigest` 走 `crypto.subtle.digest`；HTTP 下 `crypto.subtle` 为 `undefined`。

处理：`canonicalDigest()` 在无 SubtleCrypto 时用本地 SHA-256，摘要与 Web Crypto / Node 一致。现场热更新到 `helix-beta-20260828-c71149f17`，未清库。SHA-256 在这里是规则合同指纹，不是 HTTPS。

## 4. PROD-003 — 扫描完成但整理工作区为空（OPEN）

发现：2026-08-28，用户配置完成后说：procurement 显示已扫描完成 72 页，媒体整理工作区一个条目也没有。Product Owner 判断为前端展示不够好，授权只登记、先不修。

当时只读现场（不写库、不改配置）：

- 文件来源活动，观察 `completed` / `pageCount=72` / `observationRevision=72`；
- `procurementStatus.stage=procurement_run_active`，`runCount=10`，`candidateCount=0`，`openOfferCount=0`；
- 观察条目约 18409，Run 材料 8633，候选包 0，Handoff A 收据 0，Libra Run 0，Formation `items=[]`；
- 10 个采购 Run 均为 `active`，材料停在 `run_selection`；`evidence_assessment` 多路仍 `running`（CIFS 源上的分拣/结构检查）。

约数分钟后再查：候选 21，阶段到 `handoff_a_ready`，媒体整理工作区已有 18 条 `in_progress`。后台并没有丢账，只是观察完成之后还有分拣、候选、Handoff A、Intake。

展示缺口：

- 「已扫描完成 72 页」被读成「发现/整理已经结束」；
- 文件来源页没有把「目录已扫完，正在分成 N 个采购批次 / 正在分拣 / 已形成候选 / 已交给整理」说清楚；
- 媒体整理工作区空列表没有解释「上游采购还在做，不是没有电影」；
- 概览当时 `todos=[]`、`inProgress=null`、系统态「正常运行」，也没有把这条长尾标成用户可等的进展。

建议（仅记录，不实施）：来源页把观察完成与采购/候选/Handoff 进度分开；空工作区区分「还没发现」和「发现了、还在交给整理」；概览最近进展带上采购批次而不是只显示观察终态。

## 5. PROD-004 — 来源与收藏架同为 `/media/Film`（OPEN）

用户把文件来源和收藏架目标都配成容器路径 `/media/Film`（NAS `/vol02/1000-0-c5b736af/Film`）。SSOT 允许 Field 与 Shelf Target 同根，这不是 PROD-003 空工作区的原因。风险在后面：成品也写回同一棵树，Settlement /「磁盘有、Inventory 无」会对账更绕。页面没有强提示「源目录和成品目录现在是同一个」。先不改配置、不改合同。
