# ShelfDeck Versioning

本文档定义 ShelfDeck v3 / Kairox 阶段的版本管理口径。它解决的是“项目阶段名、生产镜像、Git tag、package version 混在一起”的问题。

## Current Version State

Last updated: 2026-07-07

| 项 | 当前值 | 说明 |
| --- | --- | --- |
| Product line | `v3 / Kairox` | 当前产品和架构演进线 |
| Current milestone | `Kairox Frontend/API E2E` | 当前唯一阶段目标，见 `CURRENT_PLAN.md` |
| Latest deployed image | `markmahoro/shelfdeck:kairox-freshness-20260707-263ef161` | 当前生产运行镜像 |
| Latest deployed commit | `263ef161` | 当前生产代码来源 |
| Latest deployed image SHA256 | `0840d9864e9c0b4f0782a458acd10f1e5b80d51d914f34528b54e63ef573868d` | 本地构建 tar 与 NAS 上传校验 hash |
| Latest Git release tag | `v2.0.0` | 历史 release tag，不代表当前 v3/Kairox 生产镜像 |
| package versions | `1.0.0` | 当前不作为 v3/Kairox 阶段版本来源 |

## Version Layers

ShelfDeck 版本分四层，不能互相替代。

| 层级 | 用途 | 示例 | 管理规则 |
| --- | --- | --- | --- |
| Product milestone | 描述当前业务/架构阶段 | `Kairox Beta`、`Kairox Frontend/API E2E`、`Kairox GA` | 只写在 `CURRENT_PLAN.md` / `CURRENT_STATUS.md`，不是可部署版本号 |
| Deployable build | 标识一个生产可部署镜像 | `markmahoro/shelfdeck:kairox-freshness-20260707-263ef161` | 每次部署必须记录 image tag、commit、sha256 |
| Git release tag | 标识正式发布点 | `v3.0.0-beta.1`、`v3.0.0` | 只有 E2E / release 验收通过后才打 tag |
| Package version | npm / desktop package 元数据 | `1.0.0` | 不再用它表达 v3 阶段；公开发行前再统一 bump |

## Naming Rules

### Product Milestones

Product milestone 用自然语言命名，不伪装成语义化版本。

推荐：

```text
Kairox Runtime Cutover
Kairox Frontend/API E2E
Kairox Frontend GA
Kairox Performance
Kairox GA
```

不推荐：

```text
v3.7
v3.8
v3.11
```

原因：v3.x 计划已经多次重排，继续使用细碎版本号会让旧 roadmap 看起来仍然有效。

### Docker Image Tags

生产部署镜像 tag 使用：

```text
<milestone-slug>-<YYYYMMDD>-<git-short-sha>
```

示例：

```text
kairox-freshness-20260707-263ef161
kairox-e2e-fix-20260708-a1b2c3d4
kairox-ga-candidate-20260715-9f8e7d6c
```

规则：

- 不复用 image tag。
- 不用 `latest` 作为生产版本记录。
- 部署记录必须包含 local sha256 / remote sha256 校验。
- `CURRENT_STATUS.md` 必须记录当前生产镜像和 commit。

### Git Release Tags

Git release tag 只用于真正 release，不用于日常部署。

建议后续格式：

```text
v3.0.0-beta.1
v3.0.0-rc.1
v3.0.0
v3.1.0
```

打 tag 条件：

- 当前 `CURRENT_PLAN.md` 对应验收完成。
- 生产 E2E 或明确的 release acceptance 通过。
- `CURRENT_STATUS.md` 更新到 tag 对应状态。
- 用户明确要求或确认发布。

### Package Versions

当前 package version 仍是 `1.0.0`，包括：

- `media-service/package.json`
- `media-service/web/package.json`
- `media-desktop/package.json`
- `media-worker/package.json`

在 Kairox Beta / E2E 阶段，不用 package version 表达项目状态。等到正式 release 或 desktop 分发时，再统一 bump。

## Release State Machine

```text
Development commit
-> Deployable image
-> Production deployed build
-> E2E accepted build
-> Release candidate
-> Git release tag
```

当前项目处于：

```text
Production deployed build
```

尚未进入：

```text
E2E accepted build
```

## Required Records For Deployment

每次生产部署后，必须在 `CURRENT_STATUS.md` 记录：

| 字段 | 说明 |
| --- | --- |
| Production URL | 当前生产地址 |
| Latest deployed image | 完整 Docker image tag |
| Latest deployed commit | git commit |
| Image tar SHA256 | 本地/远端校验 hash |
| Deployment time | 部署时间 |
| Health result | 部署后 health 状态 |
| E2E status | 未跑 / 进行中 / 通过 / 阻塞 |

## What Not To Do

- 不用旧 v3.4/v3.8/v3.11 roadmap 判断当前版本。
- 不把 package `1.0.0` 当成当前产品版本。
- 不把 `latest` 当成生产版本记录。
- 不复用已经部署过的 Docker tag。
- 不在没有验收的情况下打 Git release tag。
- 不新增多个并列的 active roadmap。
