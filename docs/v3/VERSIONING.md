# ShelfDeck Versioning

本文档定义 ShelfDeck 的**版本分层口径**。它解决的是“架构阶段、生产镜像、Git tag、package version、面向人的 Changelog 混在一起”的问题。

Kairox release line 已关闭。当前架构、Beta 状态与**生产部署身份**以 `docs/helix/` 为准；本文件只定义规则，不代替 Helix `CURRENT_STATUS.md`。

## Current Version State

Last updated: 2026-10-29（规则整理；**实时生产身份以 Helix Status 为准**）

| 项 | 当前值 | 说明 |
| --- | --- | --- |
| Product line / Release goal | `Helix Beta` | 自然语言阶段名；不是可部署 semver |
| Visible product version | 尚无正式 Git release tag 覆盖当前 Helix 生产线 | 最近正式 Git release tag 仍为历史 `v2.0.0`；下一次用户确认的 release 按下方 Git tag 规则打，并写入根 `CHANGELOG.md` |
| Live production identity | 见 [`docs/helix/CURRENT_STATUS.md`](../helix/CURRENT_STATUS.md) | Docker image tag、commit、sha256、E2E 状态**只写这里** |
| Package versions | `1.0.0` | 不作为 Helix 阶段或产品版本来源 |

历史镜像快照（示例，已过时，勿当现网）：`helix-beta-20260903-f05d694dfa` 等。查现网请打开 Helix Status。

## Version Layers

ShelfDeck 版本分五层，不能互相替代。

| 层级 | 用途 | 示例 | 管理规则 |
| --- | --- | --- | --- |
| Release goal | 描述当前业务/架构阶段 | `Helix Beta`、（已关闭）`Kairox Beta` | 自然语言；定义在 `docs/helix/`，不是可部署版本号 |
| **Product version** | 用户/agent 可读的产品版本号 | `v2.0.0`、`v3.0.0-beta.1` | **等于**已打出的 Git release tag；条目写入根 `CHANGELOG.md` |
| Deployable build | 标识一次生产可部署镜像 | `helix-beta-20261021-6c74939646` | 每次部署记录 image tag、commit、sha256 → Helix `CURRENT_STATUS` |
| Git release tag | 正式发布点 | `v3.0.0-beta.1`、`v3.0.0` | 仅验收通过且用户确认后打 tag |
| Package version | npm / desktop package 元数据 | `1.0.0` | 不表达 Helix 阶段；公开发行/desktop 分发前再统一 bump |

### Product version ↔ Changelog ↔ deploy tag

```text
日常合入 main
  → 可选写入 CHANGELOG「Unreleased」
  → 不自动等于新产品版本

用户授权正式 release
  → 打 Git release tag = Product version
  → 将该 tag 的变更从 Unreleased 落入 CHANGELOG 对应章节
  → 若同次上生产：Docker tag 按下方规则新建，并写入 Helix CURRENT_STATUS
```

- **一个产品版本**对应 **一个 Git release tag** 与 **一节 CHANGELOG**。
- **一次 NAS 部署**对应 **一个 Docker image tag**；可以发生在产品版本之间（hotfix deploy），必须写 Status，**不要**为此发明第二套产品号。
- 不要为每次 deploy 新开 `v3.7` / `v3.8` 式细碎产品号。

## Naming Rules

### Release Goals

Release goal 用自然语言命名，不伪装成语义化版本。

```text
Helix Beta
```

`Kairox Beta` 已达成并关闭。`Helix Beta` 已在 NAS 生产运行。新的 deployable image 只在一次明确发布中按 clean source commit 构建并分配新 tag；不得复用当前或历史 tag。

不推荐：`v3.7` / `v3.8` / `v3.11` 充当阶段名（旧 roadmap 碎片）。

### Docker Image Tags

生产部署镜像 tag：

```text
<milestone-slug>-<YYYYMMDD>-<git-short-sha>
```

示例：`helix-beta-20261021-6c74939646`

规则：不复用 tag；不用 `latest` 作生产记录；部署必须含 local/remote sha256；**只**写入 `docs/helix/CURRENT_STATUS.md`。

### Git Release Tags（= Product version）

```text
v3.0.0-beta.1
v3.0.0-rc.1
v3.0.0
v3.1.0
```

打 tag 条件：

- 对应 Helix Plan / Phase（或明确 UAT 发布范围）验收完成。
- 生产 E2E 或明确的 release acceptance 通过（或用户书面接受例外）。
- Helix `CURRENT_STATUS.md` 更新到该发布身份。
- 根 `CHANGELOG.md` 已写入该产品版本章节。
- 用户明确要求或确认发布。

历史 tag `v2.0.0` 不代表当前 Helix 生产镜像。

### Package Versions

当前 package version 仍为 `1.0.0`（`media-service` / web / desktop / worker）。在 Helix Beta 阶段不用它表达产品状态。

## Release State Machine

```text
Development commit
-> Deployable image
-> Production deployed build   (record: Helix CURRENT_STATUS)
-> E2E accepted build
-> Release candidate
-> Git release tag = Product version + CHANGELOG section
```

当前项目处于：`Helix Beta` 已部署；正式 Product version Git tag 尚未覆盖本产品线（见上表）。尚未进入：`media-desktop` Helix completeness refactor。

## Required Records For Deployment

每次生产部署后，必须在 **`docs/helix/CURRENT_STATUS.md`** 记录：

| 字段 | 说明 |
| --- | --- |
| Production URL | 当前生产地址 |
| Latest deployed image | 完整 Docker image tag |
| Latest deployed commit | git commit |
| Image tar SHA256 | 本地/远端校验 hash |
| Deployment time | 部署时间 |
| Health result | 部署后 health 状态 |
| E2E status | 未跑 / 进行中 / 通过 / 阻塞 |

`docs/v3/CURRENT_STATUS.md` 仅为 CLOSED stub，禁止继续追加部署流水。

## What Not To Do

- 不用旧 v3.4/v3.8/v3.11 roadmap 判断当前版本。
- 不把工程切片名当成大版本名。
- 不把 package `1.0.0` 当成当前产品版本。
- 不把 `latest` 当成生产版本记录。
- 不复用已经部署过的 Docker tag。
- 不在没有验收的情况下打 Git release tag。
- 不新增多个并列的 active roadmap 或第二套 Changelog。
- 不为每次 NAS deploy 发明独立产品 semver。
