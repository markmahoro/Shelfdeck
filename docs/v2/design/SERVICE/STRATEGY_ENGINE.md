# STRATEGY_ENGINE — 策略计算引擎

> 版本：4.0
> 状态：v4 定稿

---

## §1 定位

StrategyEngine 是一个独立定时任务，对 library.json 全表执行策略计算，产出 `action` / `reason` / `targetBitrate` / `targetCodec` / `seedPreferences` / `maxSizeGB` / `predictedSizeGb` 字段。

**一句话**：用用户可配置的规则模板（rule template）匹配 item → 应用规则的 action/reason/params。

```
EmbyAdapter ──→ library.json (name, bitrate, resolution, codec, watched...)
DoubanAdapter ──→ library.json (doubanRating)
desktop 打分 ──→ library.json (userRating)

StrategyEngine ──→ 全量扫描 library.json ──→ 逐条匹配 ruleTemplates ──→ 写回
                                                      │
                                                      └── config.ruleTemplates (用户可配置)
```

**核心原则**：策略计算与数据写入完全解耦。EmbyAdapter、DoubanAdapter、评分端点只写原始数据，不管策略。StrategyEngine 只读原始数据 + ruleTemplates，只写策略字段，不管数据来源。

### 与 v1/v2 行为对比

| | v1/v2（已废弃） | v4（当前） |
|---|---|---|
| 规则定义 | 硬编码 `mediaPolicyService.recommendedAction()` | 用户可配置 `ruleTemplates`（条件组 + 算子 + 优先级） |
| 规则修改 | 改代码 | 改 config.json / admin 管理页 |
| 评分优先 | `doubanRating` → `userRating` → `null` | 由规则条件表达（用户自行决定条件顺序） |
| 输出字段 | `action`, `reason` | `action`, `reason`, `targetBitrate`, `targetCodec`, `seedPreferences`, `maxSizeGB`, `predictedSizeGb` |

---

## §2 规则模板引擎

### 2.1 规则结构

每条规则（rule）包含：

| 字段 | 类型 | 说明 |
|---|---|---|
| `priority` | number | 优先级（P1→P10，从小到大），同 item 匹配多条规则时取最高优先级 |
| `groups` | array | 条件组列表，每组含 `conditions[field, op, value]` 和 `connector` |
| `groupsConnector` | string | 组间连接符（`and` / `or`） |
| `action` | string | 匹配后的动作：`transcode` / `upgrade` / `delete` / `keep` |
| `reason` | string | 中文说明，如"4★ 1080p 码率超标→建议压缩" |
| `actionParams` | object | 动作参数：`targetBitrate`, `targetCodec`, `seedPreferences`, `maxSizeGB` |

### 2.2 条件算子

| 算子 | 语义 |
|---|---|
| `>`, `>=`, `<`, `<=` | 数值比较（null 视为 false） |
| `=` | 严格相等 |
| `in` | item 字段值在给定列表中 |
| `not in` | item 字段值不在给定列表中 |

### 2.3 匹配逻辑

```
对每个 item:
  subLib = 找到 item 所属子库
  template = config.ruleTemplates 中匹配 subLib.ruleTemplateId（默认 'default'）

  无 template 或 template.rules 为空 → action='keep', reason='无策略模板'

  按 priority ASC 排序 rules
  遍历 rules:
    if ruleMatches(item, rule):  匹配成功（覆盖之前的结果，last match wins）
  无匹配 → action='keep', reason='策略未覆盖'
```

### 2.4 默认模板

`configStore.buildDefaultTemplate()` 生成内置规则模板（`id: 'default'`），含 P1-P7 的基础规则，覆盖：
- P1: 无有效评分 → keep
- P2: 评分 1-2 → delete
- P3-P5: 码率超标 → transcode/upgrade
- P6: 光盘类（isDiscLike）→ keep
- P7: catch-all → keep

用户可通过 admin 管理页创建/编辑/删除自定义模板，替换子库的 `ruleTemplateId`。

---

## §3 输出字段

每条规则匹配后，`applyRule()` 设置以下 item 字段：

| 字段 | 规则 action | 值 |
|---|---|---|
| `action` | 任意 | 规则的 action |
| `reason` | 任意 | 规则的 reason |
| `targetBitrate` | transcode / upgrade | `actionParams.targetBitrate` |
| `targetCodec` | transcode / upgrade | `actionParams.targetCodec` |
| `seedPreferences` | upgrade | `actionParams.seedPreferences` |
| `maxSizeGB` | upgrade | `actionParams.maxSizeGB` |
| `predictedSizeGb` | transcode / upgrade | 根据 targetBitrate + duration 估算 |
| `predictedSizeGb` | keep | `item.size / (1024³)` |
| `predictedSizeGb` | delete | `undefined` |

---

## §4 调度

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `strategyPollIntervalMinutes` | 30 | 轮询间隔（分钟） |

- 服务启动后立即执行一次全量计算（同步）
- 之后按间隔周期执行
- `lastRunAt` 为模块内存变量（`Date.now()`），不持久化到 config.json

### 4.1 与 SmartTaskEngine 的时序

StrategyEngine 应在 SmartTaskEngine 之前运行，确保策略字段是最新的。

**启动保障**：服务启动时 StrategyEngine 先执行一次全量（同步），SmartTaskEngine 延迟 5s 后启动第一轮扫描。后续各自独立周期运行（30min vs 10min），自然保证多数情况下策略先就绪。

不强行加锁同步——即使某个周期 SmartTaskEngine 读到 reason 为 `新入库` 的 item（尚未被策略引擎处理），也只是跳过不入队，下个周期策略算好后自然会入队。

---

## §5 配置项汇总

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `strategyPollIntervalMinutes` | number | `30` | 策略计算间隔 |
| `ruleTemplates` | array | `[defaultTemplate]` | 规则模板列表（核心配置） |

> 所有字段定义在 `data/config.json`，由 ConfigStore 管理。字段语义见 `SERVICE/CONFIG.md`。`mediaPolicy` 和 `mediaPolicyService.recommendedAction()` 已完全废弃，由 `ruleTemplates` 替代。

---

## §6 模块边界

| 读 | 写 |
|---|---|
| `mediaLibraryService.getLibrary()`（全表） | `item.action` |
| `configStore.loadConfig()`（ruleTemplates + subLibraries） | `item.reason` |
| | `item.targetBitrate` |
| | `item.targetCodec` |
| | `item.seedPreferences` |
| | `item.maxSizeGB` |
| | `item.predictedSizeGb` |

不碰 Emby、豆瓣、MoviePilot 等外部系统。不创建/修改任务。不读取 playback-log。

---

## §7 关联文档

- `SERVICE/MEDIA_LIBRARY.md` — library.json 数据模型和字段定义
- `SERVICE/SMART_TASK_ENGINE.md` — 智能入队引擎（在 StrategyEngine 之后运行）
- `SERVICE/CONFIG.md` — 配置字段定义（ruleTemplates、strategyPollIntervalMinutes）
- `configStore.js` — buildDefaultTemplate() 默认规则模板实现
