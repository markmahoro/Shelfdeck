# DESIGN_SERVICE/MEDIA_LIBRARY — 媒体库管理

> 状态：待编写

---

## 1. 媒体库表（library.json）

### 1.1 表结构

| 字段 | 类型 | 来源 | 说明 |
|---|---|---|---|
| `itemId` | string | 主键 | 统一标识，来源无关，可支持 Emby / 本地文件夹 / TMDB 等多来源 |
| `name` | string | Emby / 文件夹扫描 | 影片名称 |
| `path` | string | Emby / 文件夹扫描 | 媒体文件路径 |
| `source` | string | 系统 | 来源类型：`emby` / `local` / `tmdb` |
| `sourceId` | string | 来源系统 | 对应来源系统的主键（如 EmbyId） |
| `type` | string | Emby / 文件夹扫描 | 媒体类型：`movie` / `series` / `episode` |
| `bitrate` | number | Emby / 文件夹扫描 | 码率（bps） |
| `duration` | number | Emby / 文件夹扫描 | 时长（秒） |
| `resolution` | string | Emby / 文件夹扫描 | 分辨率，如 `3840x2160` |
| `size` | number | Emby / 文件夹扫描 | 文件大小（字节） |
| `premiereDate` | string | Emby / 文件夹扫描 | 首播日期（ISO 8601） |
| `genres` | string[] | Emby / 文件夹扫描 | 类型标签列表 |
| `isDiscLike` | boolean | 解析 | 是否原盘（ISO/BDMV），由路径解析或 Emby 返回判定 |
| `doubanId` | string | Douban 匹配 | 豆瓣条目 ID |
| `doubanRating` | number | Douban | 豆瓣星级（1-5），null 表示未匹配 |
| `doubanSyncedAt` | string | Douban | 豆瓣评分同步时间（ISO 8601） |
| `userRating` | number | Desktop | 用户星级（1-5），null 表示未评分 |
| `userRatingUpdatedAt` | string | Desktop | 用户评分时间（ISO 8601） |
| `lastRefreshedAt` | string | 系统 | 最近一次媒体库刷新时间（ISO 8601） |
| `action` | string | 策略计算 | 推荐动作：`delete` / `transcode` / `upgrade` / `keep` |
| `reason` | string | 策略计算 | 推荐原因，如"码率偏高"、"已观看" |

### 1.2 主键设计

主键为 `itemId`（string），不绑定任何来源系统，以保证多来源扩展性：

- Emby 来源：itemId = Emby 返回的 `Id`
- 本地文件夹来源：itemId = 文件绝对路径或哈希
- TMDB 来源：itemId = TMDB ID
- 其他来源：按来源系统约定

### 1.3 持久化

文件路径：`data/library.json`

### 1.4 策略计算

```
effectiveRating = doubanRating 非空 ? doubanRating : userRating 非空 ? userRating : null
```

豆瓣评分优先，用户评分兜底，均为空时 effectiveRating = null。

策略计算逻辑（action / reason）由 `mediaPolicy` 配置驱动，见 `CONFIG.md`。

---

## 2. 模块职责

（待编写）

---

## 3. 数据写入链路

（待编写）

---

## 4. REST API

（待编写）
