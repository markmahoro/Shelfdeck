# DESIGN_SERVICE/TRANSCODE — 转码执行层

> 状态：v2 重写中
> 基准架构：Phase 3，基于双向 API 通信模型重写
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

每个物理 GPU 可能提供多个编码器实例，抽象为子槽：

```
DevicePool
    ├── CPU 槽 × N
    └── GPU 设备 × M
          └── 子槽 × 子槽数
```

### 2.3 CPU 参与策略

通过 `transcodeCpuParticipationStrategy` 配置：

| 策略 | 行为 |
|---|---|
| `normal` | CPU 和 GPU 都参与设备分配 |
| `backup_only` | 仅 GPU 参与，CPU 不参与（作为 fallback） |

### 2.4 槽位分配

TranscodeFlowExecutor 在 `executing` 阶段从 DevicePool 分配槽位，压制完成后释放。

---

## §3 核心接口

### 3.1 precheck()

| 检查项 | 失败行为 |
|---|---|
| 临时目录存在且可写 | 抛出异常 → Flow 捕获后 `failed_hard` |
| 源文件可读 | 抛出异常 → Flow 捕获后 `failed_hard` |
| DV 检测（libplacebo 滤镜） | 抛出异常 → Flow 捕获后 `failed_hard` |
| FFmpeg/ffprobe 可执行性 | 抛出异常 → Flow 捕获后 `failed_hard` |
| 预估输出体积 vs 原文件体积 | 返回预估体积，供 Flow 判断是否跳过压制 |
| 设备池非空 | 抛出异常 → Flow 捕获后 `failed_hard` |

### 3.2 startEncode(onProgress)

- 分配设备槽位（按 CPU 参与策略）
- 启动 FFmpeg 压制进程
- 通过 `onProgress` 回调报告进度（0-99）
- 返回 `encodeJobId`

### 3.3 probeSummary()

执行 ffprobe 探针，返回：

```json
{
  "durationSec": 7200,
  "videoCodec": "hevc",
  "width": 3840,
  "height": 2160,
  "isDolbyVision": true,
  "hdrType": "dolby-vision"
}
```

供 TranscodeFlowExecutor 三层 verify 使用。

### 3.4 replaceWithRetries()

原子替换原始文件：

```
1. 复制 partial → .etp.new
2. ffprobe 验证 .etp.new
3. rename 原文件 → .etp.bak
4. rename .etp.new → 原文件名
5. 清理 .etp.bak（可选）
```

重试次数：3 次。

---

## §4 内存状态

`encodeJobs` Map：进程退出后丢失。重启后由 TaskScheduler 的 `recoverInterruptedTasks()` 降级为 `interrupted`，用户需手动重试。

---

## §5 关联文档

- `SERVICE/TRANSCODE_FLOW.md` — TranscodeFlowExecutor 的调用方式
- `SERVICE/CONFIG.md` — 转码配置（设备优先级、CPU 策略）
