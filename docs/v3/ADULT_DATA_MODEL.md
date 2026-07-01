# Adult Library Data Model

Status: v3.3-alpha.1 contract.

本文定义 v3.3 恢复成人库前必须遵守的数据分层。它是 `docs/v3/KAIROX_ARCHITECTURE.md` 在成人库数据模型上的细化，不改变 Kairox 的 Task / Flow / Event、TaskAdmission、Lifecycle gate 或 Admin Web projection 边界。

## 1. Kairox 边界

成人库仍然是 ShelfDeck 的 `subLibrary`，不是独立业务链路。

- Lifecycle gate 仍然拥有用户语义：成人库 item 也必须通过 ingest gate、metadata gate、optimize gate、archive gate 表达状态。
- 自动任务创建必须继续通过统一 Task Creator / TaskAdmission；成人库扫描、刮削、重刮、后台恢复不得开私有入队路径。
- JAV scraper、欧美成人 AI、自算和整理只是 metadata/flow 的实现路径，不能反向创造新的 task 目标。
- `media_items` 的热 payload 只能服务列表、详情首屏、Lifecycle gate 和 TaskAdmission；AI 中间产物和图片大对象必须进入冷数据或文件资产。
- Admin Web 普通页面只展示用户语义，不展示 payload、embedding、base64、resource bucket 或 DB/WAL 诊断。

## 2. 数据分层

| 层 | 保存位置 | 内容 | 读取方式 |
| --- | --- | --- | --- |
| hot media facts | `media_items` columns / hot payload | item identity、subLibrary、source/path、file facts、lifecycle/gate facts、task target facts | 列表、dashboard、任务准入、生命周期判断直接读取 |
| light adult metadata | `media_items.payload_json.adultMetadata` | 用户能理解且 gate 需要的轻量元数据 | 列表和详情首屏可读取 |
| cold AI artifacts | 冷数据表或独立冷库，v3.3-beta 前由 dry-run 定稿 | face clusters、unknown faces、embedding、gallery、AI 中间输出 | 详情页、人脸操作、诊断按需读取 |
| file assets | 媒体目录或 service data asset path | poster、fanart、NFO、marker、sample image 等文件 | DB 只保存引用、hash、尺寸、用途 |

## 3. Hot Media Facts

`media_items` 热事实用于回答“这个媒体是什么、在哪个子库、当前生命周期到哪一步、是否能创建下一步任务”。

允许保留：

- identity：`itemId`、`source`、`sourceId`、`subLibraryId`、`assetKey`、`externalRefs`。
- file facts：`path`、`assetRootPath`、`size`、`duration`、`bitrate`、`resolution`、`codec`、`audioCodecs`、`bucket`、`isDiscLike`。
- lifecycle/gate facts：`scraped`、metadata gate facts、optimization facts、archive facts。
- task target facts：当前推荐 target gate、gate objective、blocked reason、manual/auto eligibility 的轻量事实。

不允许保留：

- base64 图片。
- embedding 向量。
- gallery 数组。
- face cluster 明细。
- AI prompt、response、intermediate output。

## 4. Light Adult Metadata

`media_items.payload_json.adultMetadata` 只保留以下轻字段：

| 字段 | 用途 |
| --- | --- |
| `adultId` | 成人库可读编号；不是 item identity |
| `title` / `originalTitle` | 用户识别标题 |
| `actors` | 用户识别演员名 |
| `studio` / `series` / `premiered` | 基础元数据 |
| `region` | `japanese_jav` / `western_adult` 等子库区域事实 |
| `scrapeStatus` / `reviewStatus` | metadata gate 和审核状态 |
| `idConfidence` | JAV 番号识别置信度 |
| `protagonist` | 欧美成人主角轻量摘要：`personId/name/adultId` |
| `posterPath` / `nfoPath` | 文件资产引用 |
| `organized` | 是否已整理 |
| `scrapeVerification` | 刮削合同校验摘要 |

这些字段由 `media-service/src/adultDataModel.js` 中的 `projectLightAdultMetadata()` 固化。后续写入路径必须使用该投影，不能各 flow 自己挑字段。

## 5. Cold AI Artifacts

以下内容不得进入 hot `adultMetadata`：

- `faceClusters`
- `unknownFaces`
- `embedding`
- `sampleImage` / `sampleImageBase64`
- `galleryImages`
- `posterImageBase64` / `fanartImageBase64` / `imageBase64`
- `posterImage` / `fanartImage`
- `ai`
- `actorConfidence`
- `scene`
- `safetyFlags`
- `generatedTitle` / `generatedDescription` / `safeSummary`

这些内容属于 cold AI artifacts。v3.3-alpha.2 之后新写入必须把它们从热 payload 中剥离；v3.3-alpha.3 先对生产旧数据 dry-run；v3.3-beta.1 才允许备份后迁移历史数据。

## 6. File Assets

图片和 NFO 等文件资产不应长期以 base64 存入 DB。

允许 DB 保存：

- asset reference path。
- content hash。
- width / height / mime type。
- purpose，例如 `poster`、`fanart`、`face_sample`、`gallery_sample`。

不允许 DB 保存：

- 原始图片 base64。
- 可从文件资产重新读取的大图二进制。
- worker/service AI 中间帧数组。

## 7. 恢复顺序

1. `v3.3-alpha.1`：只固化本文和测试约束，不迁移生产数据。
2. `v3.3-alpha.2`：新写入瘦身；`media_items` 新增/更新不再写入冷 artifacts。
3. `v3.3-alpha.3`：生产 dry-run，只读分析旧 payload 来源、迁移收益和回滚路径。
4. `v3.3-beta.1`：备份后迁移历史数据，保持 item identity、Lifecycle facts、Task target facts 不变。
5. `v3.3-beta.2`：恢复 JAV/US 普通可见路径；列表走热数据，详情和人脸操作按需读冷数据。

## 8. 测试约束

当前约束测试在 `media-service/test/adult-data-model.test.js`：

- light projection 只能包含本文列出的轻字段。
- protagonist 只能保留 `personId/name/adultId`。
- cold artifact detector 必须识别 face、embedding、gallery、base64 和 AI 中间字段。
- light projection 不得包含 cold artifact。

