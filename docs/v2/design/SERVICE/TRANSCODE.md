# DESIGN_SERVICE/TRANSCODE — 转码执行层

> 状态：v4
> 基准架构：Phase 4，基于双向 API 通信模型
> SSOT：本文是 TranscodeService 可执行行为的唯一事实来源

---

## §1 职责定位

TranscodeService 负责转码的实际执行操作，被 TranscodeFlowExecutor 调用。

**核心定位**：
- **TranscodeFlowExecutor**：调度侧，管 phase 状态机、停泊点、resumePoint
- **TranscodeService**：执行侧，管 encodeJobs Map、设备分配、startEncode/probeSummary/replaceWithRetries

---

## §2 编码设备池（DevicePool）

### 2.1 设备类型

| 类型 | 说明 |
|---|---|
| CPU | 软件编码（`libx265`），无硬件依赖 |
| GPU | 硬件编码（NVENC/QSV/AMF），需驱动和 FFmpeg 构建支持 |

### 2.2 设备子槽

每个物理 GPU 可能提供多个编码器实例，抽象为子槽；CPU 提供软件编码能力，槽位数由 `maxCpuSlots` 配置决定：

```
DevicePool
    ├── CPU 槽 × maxCpuSlots（用户配置，默认 1）
    └── GPU 设备 × M
          └── 子槽 × maxSlots（各设备独立配置）
```

**CPU 槽位限制**（`maxCpuSlots`）：
- 控制同时进行的 CPU 编码任务数上限
- 默认值：1（保守，避免系统资源被打满）
- 典型值：1-4（根据 CPU 核心数和系统负载能力调整）

**配置字段**：`transcodeMaxCpuSlots`（整数，>= 1）

### 2.3 CPU 参与策略

通过 `transcodeCpuParticipationStrategy` 配置：

| 策略 | 行为 |
|---|---|
| `normal` | CPU 和 GPU 都参与设备分配 |
| `backup_only` | 仅 GPU 参与，CPU 不参与（作为 fallback） |

### 2.4 设备优先级

用户可为设备池中的多个设备配置优先级（`priority` 字段，数值越小越优先）：

| 设备 | 示例 priority | 说明 |
|---|---|---|
| GPU-0（RTX 4090） | 1 | 主显卡，最优先 |
| GPU-1（RTX 4080） | 2 | 次显卡 |
| CPU | 10 | fallback |

**分配顺序**：
1. 按 `priority` 升序排列可用设备
2. 优先分配最高优先级设备
3. 同优先级按设备类型（GPU > CPU）排序
4. `backup_only` 模式下，CPU 设备不参与分配

### 2.5 槽位分配

TranscodeFlowExecutor 在 executing 阶段通过 `acquireFirstAvailableAmong()` 从 DevicePool 分配槽位，压制完成后通过 `releaseEncodeDeviceSlot()` 释放。

**槽位上限**：
- GPU 各设备：`maxSlots` 由用户在配置中为每张显卡独立设定
- CPU：`maxCpuSlots` 统一控制 CPU 编码的并发上限

**优先级策略与 CPU 参与策略的关系**：

| CPU 参与策略 | priority=1 GPU-0 不可用时 | 分配结果 |
|---|---|---|
| `normal` | 降级到 priority=2 GPU-1 | GPU-1 执行 |
| `normal` | GPU 全部不可用 | 降级到 CPU |
| `backup_only` | 降级到 priority=2 GPU-1 | GPU-1 执行 |
| `backup_only` | GPU 全部不可用 | 失败（CPU 不参与） |

---

## §3 核心接口

### 3.1 precheck(config, sourcePath)

| 检查项 | 失败行为 |
|---|---|
| 临时目录存在且可写 | 抛出异常 → Flow 捕获后 `failed_hard` |
| 源文件可读 | 抛出异常 → Flow 捕获后 `failed_hard` |
| DV 检测（libplacebo 滤镜） | 抛出异常 → Flow 捕获后 `failed_hard` |
| FFmpeg/ffprobe 可执行性 | 抛出异常 → Flow 捕获后 `failed_hard` |

返回值：`{ ok, needsDvConfirm, sourcePath, isDolbyVision, durationSec, originalSizeBytes, originalVideoCodec, originalWidth, originalHeight, originalAudioCodec, originalBitrate }`

**注意**：
- 设备池非空检查不在 `precheck()` 中，而在 `startEncode()` 的 `acquireFirstAvailableAmong()` 中（`slots.length === 0` → 抛出异常）。
- 预估输出体积计算未实现（无体积对比跳过压制优化）。

### 3.2 startEncode(onProgress, params)

- 分配设备槽位（按 CPU 参与策略，通过 `acquireFirstAvailableAmong()` 阻塞等待）
- 若设备池为空（`orderedDeviceSlots.length === 0`）→ 抛出异常
- 启动 FFmpeg 压制进程（由 `buildEncodeArgs()` 构建参数）
- 通过 `onProgress` 回调报告进度（解析 stderr 中的 `time=` 行，按 duration 计算百分比 0-99）
- 返回 `{ ok, encoderUsed, resolvedDeviceId }`
- `encodeJobs` Map 追踪活跃进程（key = taskId）

### 3.3 probeSummary(config, filePath)

执行 ffprobe 探针，返回：

```json
{
  "durationSec": 7200,
  "videoCodec": "hevc",
  "width": 3840,
  "height": 2160,
  "audioCodec": "eac3"
}
```

**注意**：`isDolbyVision` 和 `hdrType` 尚未实现（探针函数不返回这些字段）。

### 3.4 replaceWithRetries({ config, targetPath, partialPath })

原子替换原始文件（最多 3 次重试）：

```
1. copyFile partial → .etp.new
2. ffprobe 验证 .etp.new（依赖 ffprobeJson 抛异常）
3. rename 原文件 → .etp.bak
4. rename .etp.new → 原文件名
5. 删除 partial
6. 删除 .etp.bak
```

失败回滚：若 rename .etp.new → 目标失败，从 .etp.bak 恢复。

---

## §4 扩展公共 API

除核心 CRUD 接口外，TranscodeService 还暴露以下 API：

| 函数 | 说明 |
|---|---|
| `extractPreviewClip(config, sourcePath, outputPath)` | 生成预览切片（默认 30s，从 25% 位置开始）。先尝试 copy 模式，失败 fallback 到软件编码 |
| `abortTask(taskId)` | 杀死指定 task 的 FFmpeg 子进程（SIGKILL） |
| `abortAllEncodes()` | 杀死全部活跃编码进程 |
| `scanOrphans(tempRoot)` | 扫描临时目录中的孤儿文件（.etp.partial / .etp.new / .etp.bak） |
| `cleanupOrphans(config)` | 启动时清理孤儿 etp-task-* 目录（先杀孤儿 ffmpeg 进程释放文件锁，再删目录） |
| `killOrphanFfmpegProcesses()` | 通过 PowerShell 查找并杀死由 bundled ffmpeg 启动的孤儿进程 |
| `cleanupTaskWorkdir(tempDir)` | 清理指定 task 的临时工作目录（删除所有文件 + 目录） |
| `getDeviceSlotUsage()` | 返回各设备当前槽位占用 `{ deviceId: inUse, ... }` |
| `probeEncodeDevices(config)` | 自检可用编码设备，返回 `{ devices: [{ stableKey, label, backend, gpuIndex }] }` |
| `getHealth(config)` | 返回 `{ status, ffmpegOk, deviceCount, message }` — green/yellow/red |

---

## §5 内存状态

`encodeJobs` Map：进程退出后丢失。重启后由 TaskScheduler 的 `recoverInterruptedTasks()` 降级为 `interrupted`，用户需手动重试。

---

## §6 关联文档

- `SERVICE/TRANSCODE_FLOW.md` — TranscodeFlowExecutor 的调用方式
- `SERVICE/CONFIG.md` — 转码配置（设备优先级、CPU 策略）
