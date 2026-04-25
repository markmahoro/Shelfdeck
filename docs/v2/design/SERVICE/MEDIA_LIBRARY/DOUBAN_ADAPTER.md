# DESIGN_SERVICE/MEDIA_LIBRARY/DOUBAN_ADAPTER — 豆瓣评分抓取与匹配

> Phase 3 为基准架构，v2 重写中。
> 参考：`ref/design/DESIGN_LIBRARY_AND_QUEUE.md` §5 · `ref/architecture/ARCH_INTEGRATIONS.md`
> 实现：`doubanService.js` · `doubanMatchService.js`

---

## §1 职责定位

DoubanAdapter 是 MediaLibraryService 内部组件，负责从豆瓣抓取用户在"电影看过"页标记的个人评分，并通过标题关键字匹配写入媒体库表。

**调用链**：
```
MediaLibraryService
    │
    ├── DoubanAdapter
    │     ├── doubanService.js      — 豆瓣"看过"列表 HTTP 抓取
    │     └── doubanMatchService.js — 标题→评分匹配逻辑
    │
    └── 豆瓣 API
```

**设计原则**：DoubanAdapter 仅负责拉取原始数据和提供匹配函数；匹配在 MediaLibraryService 协调层完成（§3）。

---

## §2 核心接口

### 2.1 DoubanService（doubanService.js）

| 函数 | 说明 |
|---|---|
| `saveSession(payload)` | 保存豆瓣会话（userId + cookieHeader）到 `douban-session.json` |
| `getSession()` | 读取当前会话 |
| `fetchRatings(progressSink, opts)` | 抓取用户豆瓣"看过"电影列表，返回 `[{ subjectId, title, stars }]` |
| `requestStop()` | 请求停止当前抓取（用于中断长任务） |

**fetchRatings 返回格式**：
```ts
{
  entries: Array<{ subjectId: string, title: string, stars: number }>,
  cancelled: boolean
}
```

**进度推送**（通过 `progressSink.send()`）：
```ts
{
  pageIndex: number,
  start: number,
  pageSize: number,
  allEntries: Array<{ subjectId, title, stars }>,
  done: boolean,
  cancelled: boolean
}
```

### 2.2 DoubanMatchService（doubanMatchService.js）

| 函数 | 说明 |
|---|---|
| `normalizeTitleForDoubanMatch(title)` | NFKC 规范化 + 去标点/空白 |
| `doubanTitleNormalizedKeys(title)` | 豆瓣 title → 多个 normalized key（按 `/` 分段 + 全串） |
| `embyTitleNormalizedKeys(name)` | Emby 名称 → 多个 normalized key（按 `：:`、`：`、`｜`、`|` 分段 + 全串） |
| `buildDoubanStarsByNormalizedTitle(entries)` | 将 `[{ title, stars }]` 转为 Map（key → stars） |
| `movieDoubanStars(embyName, itemType, byNormTitle)` | 匹配单个 Emby 影片，返回 stars 或 null |

**movieDoubanStars 匹配算法**：
1. 仅 `itemType === 'Movie'` 参与匹配
2. 生成 Emby 名称的 normalized keys，按长度降序排列
3. 依次查 Map，长键优先（减少短词误匹配）
4. 均未命中 → 返回 null

---

## §3 评分同步链路

完整链路由 MediaLibraryService 协调，DoubanAdapter 仅提供两个原子操作：

```
豆瓣定时同步触发
    │
    ├──→ 步骤1：DoubanAdapter.fetchRatings()
    │           ├── HTTP GET https://movie.douban.com/people/{userId}/collect
    │           │       （分页抓取，每页 15 条，页间隔 800ms）
    │           └── 返回 [{ subjectId, title, stars }, ...]
    │
    ├──→ 步骤2：DoubanMatchService.buildDoubanStarsByNormalizedTitle(entries)
    │           └── 建立内存 Map：normalized_title_key → stars
    │
    └──→ 步骤3：遍历 library.json items，调用 movieDoubanStars()
                ├── 仅 Movie 类型匹配
                ├── 匹配成功 → 更新 item.doubanId + item.doubanRating
                └── 匹配失败 → doubanRating = null（保留 doubanId 若之前有值）
```

**增量同步策略**：
- 默认增量：翻页过程中若某一页所有 subjectId 均已在本地缓存中，停止翻页
- 全量刷新：约每 14 天触发一次完整分页扫描，或首次同步时
- 页间延迟：800ms（降低豆瓣站点请求压力）

---

## §4 限流与缓存

- **请求限流**：豆瓣"看过"页翻页间隔 800ms（`PAGE_DELAY_MS`）
- **会话存储**：`douban-session.json`（userId + cookieHeader），与应用 data 目录同路径
- **内存缓存**：`buildDoubanStarsByNormalizedTitle()` 构建的 Map 存活于单次同步周期，不持久化
- **增量判断**：豆瓣返回的 subjectId 集合与内存缓存比对，快速终止无新数据页

---

## §5 已知限制

- 仅覆盖豆瓣"看过"电影列表，剧集/纪录片等类型不参与匹配
- 依赖豆瓣 HTML 结构稳定性（页面改版需更新 `parseCollectMovieGrid()`）
- 豆瓣"看过"页设为仅自己可见时，需要有效 Cookie 才能抓取完整列表
- 不回写 Emby 服务端元数据，评分仅存在本地 `library.json`

---

## §6 关联文档

- `SERVICE/MEDIA_LIBRARY.md` — 豆瓣同步在媒体库管理中的角色
- `SERVICE/MEDIA_LIBRARY/EMBY_ADAPTER.md` — Emby 数据拉取适配器
- `SERVICE/API.md` — `GET /v1/integrations/douban/fetch/ratings` 端点
