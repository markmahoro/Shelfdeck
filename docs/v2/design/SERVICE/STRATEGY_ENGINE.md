# STRATEGY_ENGINE — 策略计算引擎

> 版本：2.0
> 状态：设计阶段，待实现

---

## §1 定位

StrategyEngine 是一个独立定时任务，对 library.json 全表执行策略计算，产出 `action` / `reason` 字段。

**一句话**：有评分 → 按 mediaPolicy 算策略；没评分 → 标 keep。

```
EmbyAdapter ──→ library.json (name, bitrate, resolution, codec, watched...)
DoubanAdapter ──→ library.json (doubanRating)
desktop 打分 ──→ library.json (userRating)

StrategyEngine ──→ 全量扫描 library.json ──→ 逐条计算 action/reason ──→ 写回
                                                      │
                                                      └── mediaPolicyService.recommendedAction()
```

**核心原则**：策略计算与数据写入完全解耦。EmbyAdapter、DoubanAdapter、评分端点只写原始数据，不管策略。StrategyEngine 只读原始数据、只写策略字段，不管数据来源。

### 与 v1 行为对比

| | v1（当前实现） | v2（目标架构） |
|---|---|---|
| 触发方式 | 嵌入 EmbyAdapter / DoubanAdapter / 评分端点，按 diff 触发 | 独立定时器，全量重算 |
| 计算范围 | 仅变化条目（diff 检测） | 全表 |
| 耦合点 | 3 个（各数据写入路径各算各的） | 0（只读 library.json + config） |
| 扩展策略规则 | 需改 3 处 | 只改 mediaPolicyService.js |

---

## §2 执行流程

```
每个周期 (默认 30min):
  lib = mediaLibraryService.getLibrary()      ← 全量读
  cfg = configStore.loadConfig()
  subLibs = cfg.subLibraries || []

  changed = 0
  for each item in lib.items:
    // 1. 找到对应子库的 mediaPolicy
    subLib = subLibs.find(s => s.uuid === item.subLibraryId)
    policy = subLib?.mediaPolicy || cfg.mediaPolicy

    // 2. 计算策略（纯函数，无副作用）
    if (policy) {
      const { action, reason } = mediaPolicyService.recommendedAction(item, policy)
      if (item.action !== action || item.reason !== reason) {
        item.action = action
        item.reason = reason
        changed++
      }
    } else {
      // 无 policy → 标记待配置
      if (item.action !== 'keep' || item.reason !== '无策略配置') {
        item.action = 'keep'
        item.reason = '无策略配置'
        changed++
      }
    }

  // 3. 写盘
  if (changed > 0) {
    mediaLibraryService.saveLibrary(lib)
  }
```

### 2.1 为什么全量重算

- `mediaPolicyService.recommendedAction()` 是纯函数，内存计算，即使万条 item 也是毫秒级
- 免去 diff 检测逻辑（当前 mediaLibraryService.upsertItems 中的 `changedItemIds` 追踪）
- 策略规则变更后，全量重算保证所有 item 的策略与规则一致，不需要手动触发"全部重算"
- 代码简化为一个 `for` 循环

### 2.2 幂等性

全量重算天然幂等。同一 item 用同样输入多次计算，输出相同，不会重复写盘。

---

## §3 计算逻辑

委托 `mediaPolicyService.recommendedAction(item, policy)`，StrategyEngine 不做任何额外计算。

**输入**：

| 取自 item | 取自 policy |
|---|---|
| `bitrate`（bps） | `target1080p[rating]`（Mbps） |
| `resolution`（如 `3840x2160`） | `target4k[rating]`（Mbps） |
| `codec`（如 `h265`） | |
| `doubanRating`（1-5 或 null） | |
| `userRating`（1-5 或 null） | |

**输出**：

| 字段 | 值 |
|---|---|
| `action` | `delete` / `transcode` / `upgrade` / `keep` |
| `reason` | 中文说明，如"码率 15.2 Mbps 超出 4★ 目标 10 Mbps" |

**规则速查**（详见 `mediaPolicyService.js`）：

| effectiveRating | 条件 | action |
|---|---|---|
| null | — | `keep`（原因: "无有效评分"） |
| 1-2 | — | `delete` |
| 3 | bitrate > target + 1 Mbps | `transcode` |
| 3 | bitrate ≤ target + 1 Mbps | `keep` |
| 4 | bitrate > target + 1 Mbps | `transcode` |
| 4 | bitrate < target × 0.8 | `upgrade` |
| 4 | 其他 | `keep` |
| 5, 1080p | — | `upgrade` |
| 5, 4K | bitrate < target × 0.8 | `upgrade` |
| 5, 4K | 其他 | `keep` |

**effectiveRating 优先级**：`doubanRating` → `userRating` → `null`

**现代编码滞留规则**：3-4★ 且 codec 已是 h265/hevc/av1 时，即使码率超标也不转码（原因是硬件重编码不会显著减小体积）。

---

## §4 调度

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `strategyPollIntervalMinutes` | 30 | 轮询间隔（分钟） |

- 服务启动后立即执行一次全量计算
- 之后按间隔周期执行
- 每次执行记录 `strategyLastRunAt` 到 config

### 4.1 与 SmartTaskEngine 的时序

StrategyEngine 应在 SmartTaskEngine 之前运行，确保策略字段是最新的。

**启动保障**：服务启动时 StrategyEngine 先执行一次全量（阻塞），SmartTaskEngine 在其之后启动第一轮扫描。后续各自独立周期运行，30min vs 10min 的间隔自然保证多数情况下策略先就绪。

不强行加锁同步——即使某个周期 SmartTaskEngine 读到尚未被策略引擎处理的 item（`action: 'keep', reason: '新入库'`），也只是跳过不入队，下个周期策略算好后自然会入队。

---

## §5 配置项汇总

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `strategyPollIntervalMinutes` | number | `30` | 策略计算间隔 |

> 所有字段定义在 `data/config.json`，由 ConfigStore 管理。字段语义见 `SERVICE/CONFIG.md`。

---

## §6 模块边界

| 读 | 写 |
|---|---|
| `mediaLibraryService.getLibrary()`（全表） | `item.action` |
| `configStore.loadConfig()`（subLibraries + mediaPolicy） | `item.reason` |

不碰 Emby、豆瓣、MoviePilot 等外部系统。不创建/修改任务。不读取 playback-log。

---

## §7 关联文档

- `SERVICE/MEDIA_LIBRARY.md` — library.json 数据模型和字段定义
- `SERVICE/SMART_TASK_ENGINE.md` — 智能入队引擎（在 StrategyEngine 之后运行）
- `SERVICE/CONFIG.md` — 配置字段定义（mediaPolicy、策略参数）
- `mediaPolicyService.js` — 策略规则纯函数实现（代码级 SSOT）
