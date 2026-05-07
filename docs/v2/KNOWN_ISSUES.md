# KNOWN_ISSUES — 已知待修复问题

> 状态：v1 初稿
> 版本：1.0

---

## §1 问题列表

| # | 问题 | 严重程度 | 影响范围 | 状态 |
|---|------|---------|---------|------|
| 1 | tasks.json 膨胀导致同步 I/O 阻塞事件循环 | 高 | 所有转码任务进度上报 | 已修复 |
| 2 | 洗版 preview 文件被复制到目标媒体库目录 | 中 | 所有 upgrade 任务 | 已修复 |
| 3 | 硬件编码器未启用硬件解码，4K 转码极慢 | 高 | QSV / NVENC / AMF 转码 | 已修复 |
| 4 | QSV VBR 码率超标 + 转码后自动重复入队 | 高 | 4K 转码任务 | 已修复 |
| 5 | upgrade replace 阶段同步文件复制阻塞事件循环 | 高 | 所有 upgrade 任务的 replace 阶段 | 已修复 |
| 6 | upgrade TMDB 不匹配时直接 failed，应改为暂停等待用户修正 | 中 | 所有 upgrade 任务 | 已修复 |
| 7 | QSV hwaccel 导致 ffmpeg stderr 进度解析失效，进度卡 0% | 高 | QSV 硬件加速转码 | 已修复 |
| 8 | upgrade 盲扫 staging 文件夹取错电影 + TMDB 校验被跳过 + 重复入队 | 严重 | 所有 upgrade 任务 | 已修复 |
| 9 | season upgrade 精确搜索 meta_info 被硬编码为 null，auto mode 误触发 pauseForConfirm | 中 | season upgrade 任务 | 待修复 |

---

## §2 问题详情

### #1 — tasks.json 同步 I/O 阻塞事件循环，转码进度卡 0%

**严重程度**：高

**发现日期**：2026-05-05

**影响范围**：所有 transcode 和 upgrade 任务的进度上报。transcode 每 1% 增量触发一次同步写盘，upgrade 每 5 秒轮询一次同步写盘。

#### 现象

- tasks.json 膨胀到 2+ MB（累积数百条已完成任务，无自动清理）
- 转码任务 progress 长期为 0%，但 ffmpeg 实际在编码（CPU 172%）
- 任务 `updatedAt` 不更新，前端进度条卡住
- 排查发现 `taskStore.updateTask()` 每次调用都是同步全量读写 2 MB JSON

#### 根因

`taskStore.js` 第 105-122 行，`updateTask()` 实现：

```js
function updateTask(taskId, updates) {
  const tasks = loadTasks();          // readFileSync 读整个 2MB JSON
  // ... find & merge ...
  saveTasks(tasks);                   // writeFileSync 写 2MB → renameSync
  return tasks[idx];
}
```

问题链条：

1. ffmpeg stderr 产生进度行 → `onProgress(pct)` 回调
2. 回调中调用 `taskStore.updateTask({ progress: pct })` — **同步阻塞**
3. 2MB JSON 的读+写+rename 耗时 100-500ms（Docker bind mount 在 NAS HDD 上）
4. 这个同步操作发生在 stderr `data` 事件处理器内，阻塞了 Node.js 事件循环
5. 事件循环被阻塞期间，ffmpeg stderr 管道无人消费，缓冲区满（64KB）
6. ffmpeg 写 stderr 阻塞，编码暂停，直到事件循环恢复
7. 形成恶性循环：编码 → 进度上报 → 阻塞 → 编码暂停 → 恢复 → 下一轮

对短时长的 1080p 转码影响较小（总时长短，progress 跳变少），但对 4K 长时长转码（6000s+）影响严重——频繁的 progress 更新将编码速度大幅拖低。

**根因本质**：progress 是瞬时展示数据，根本不需要持久化到 disk。

transcode 每 1% 进度增量、upgrade 每 5 秒下载轮询，都调用 `taskStore.updateTask` 做同步全量读写。服务重启后 progress 归零是合理行为（ffmpeg 进程已死，重新编码），但代码却把它当持久状态写盘，自造阻塞。

附带的 tasks.json 膨胀（历史任务累积导致文件变大）只是让问题更明显——文件越大，每次写越慢，恶性循环越严重。但**即使文件只有 100KB，同步写盘在 stderr data handler 里也是错的**。

#### 修复方向

**核心认知**：progress 是瞬时展示数据，不是任务状态。它不需要持久化。

考虑服务重启场景：

- ffmpeg 进程已死，部分编码文件丢失
- 任务通过 `resumePoint` 恢复到 `transcode_executing` 阶段
- 重新 precheck → 重新编码 → progress 本就该从 0 开始
- **persist progress 对恢复没有帮助，只会引入阻塞**

upgrade 同理——下载进度靠 hash 追踪，重启后 resume 到 executing 阶段继续 poll MoviePilot，上次 poll 到的百分比没意义。

**真正需要持久化的数据**（disk）：

- `phase` / `resumePoint` — 流程恢复到哪一步
- `status` — created / executing / done / failed
- `itemInfo` 中的关键元数据（downloadHash、stagingFolder、sourcePath 等）
- `logs` 数组 — 排查用

**不需要持久化的数据**（memory）：

- `progress` — 瞬时百分比，重启归零

**唯一修复方案**：把 progress 从 disk 剥离到内存。

```js
// taskStore.js — 新增内存缓存
const progressCache = new Map();  // taskId → progressNumber

function setProgress(taskId, pct) {
  progressCache.set(taskId, pct);       // 内存操作，不阻塞
}

function getProgress(taskId) {
  return progressCache.get(taskId) ?? 0;
}

// 服务启动时无需恢复 progressCache（空 Map 即可，归零合理）
// 任务 done/failed 时 clean up: progressCache.delete(taskId)
```

改动点：
1. `taskStore` 新增 `setProgress` / `getProgress`，纯内存，O(1)
2. transcode flow 的 `onProgress` 回调调用 `taskStore.setProgress` 而不是 `taskStore.updateTask`
3. upgrade flow 的 `waitForDownload` 中进度更新同上
4. 任务 API 返回时 merge 内存中的 progress 字段
5. 任务 done/failed 时 `progressCache.delete(taskId)`

**为什么这样就够了**：1000 个活跃任务的 progress 数据 = 1000 × 8 bytes = 8 KB。不存在内存溢出风险。

**不需要做的事**：
- 不需要清洗旧任务（治标不治本）
- 不需要异步批量刷盘（多余——本来就不该写盘）
- 不需要拆文件（多余——progress 不该在文件里）
- 不需要换 SQLite（跟这个 bug 无关，那是另一个独立话题）

---

### #2 — 洗版 preview 文件被复制到目标媒体库目录

**严重程度**：中

**发现日期**：2026-05-05

**影响范围**：所有 upgrade（洗版）任务，替换完成后目标目录中会多出 `upgrade_preview.mp4`

#### 现象

- 洗版完成后，Emby 媒体库的目标目录中会出现 `upgrade_preview.mp4` 文件
- 该文件是 30 秒预览片段，用于洗版替换前的预览确认，不应该出现在最终媒体目录中
- 用户需手动删除该文件

#### 根因

`upgradeFlowExecutor.js` 中 preview 文件生成位置不当。

**第 786-793 行**（`runPreReplaceVerify`）：
```js
const previewFile = path.join(path.dirname(stagingMediaPath), 'upgrade_preview.mp4');
const previewResult = await require('./services/transcodeService').extractPreviewClip(config, stagingMediaPath, previewFile);
```

preview 文件 `upgrade_preview.mp4` 被创建在 **staging 文件夹内部**（与 `stagingMediaPath` 同目录）。

**第 903-904 行**（`runReplace`）：
```js
copyDirSync(stagingFolder, tmpFolder);
```

`copyDirSync`（第 123-135 行）无条件递归复制整个 staging 目录到目标媒体库目录，preview 文件随之一同复制。

**对比 transcode 流程**（不受影响）：transcode 的 preview 生成在独立的任务临时目录中（`/transcode/etp-task-xxx/preview.mp4`），不会进入目标媒体目录。

#### 修复方向

**方案 A**（推荐）：在 `copyDirSync` 或 `atomicReplaceFolder` 中过滤掉 `upgrade_preview.mp4`

在 `copyDirSync` 中增加排除逻辑：
```js
const SKIP_NAMES = new Set(['upgrade_preview.mp4']);
// ...
for (const e of entries) {
  if (SKIP_NAMES.has(e.name)) continue;
  // ...
}
```

**方案 B**：将 preview 文件生成在 staging 目录外部

改用任务临时目录（如 `/upgrade/etp-task-xxx/` 或 `/transcode/etp-upgrade-xxx/`），但这需要创建额外的临时目录并在 replace 后清理。

**方案 C**：replace 完成后清理目标目录中的 preview 文件

在 `runReplace` 中 `copyDirSync` 完成后，检查并删除 `upgrade_preview.mp4`。缺点是如果 copy 阶段失败，preview 文件已经污染了 tmp 目录。

---

### #3 — 硬件编码器未启用硬件解码，4K 转码极慢

**严重程度**：高

**发现日期**：2026-05-05

**影响范围**：所有使用硬件编码器（QSV / NVENC / AMF）的 transcode 任务。对 4K HEVC/HDR 源影响尤其严重，1080p H.264 源影响较小（CPU 软解足够快）。

#### 现象

- 4K HEVC 转码任务实际编码速度极慢（飞机陷落案例：6449s 电影预计需 ~36 小时）
- ffmpeg 进程 CPU 占用高（164%+），但大部分消耗在软件解码而非编码
- GPU 编码器处于"吃不饱"状态——大部分时间在等 CPU 送解码后的帧
- 硬件型号：Intel N95（Alder Lake-N），`/dev/dri/renderD128` 可用

#### 根因

`transcodeService.js` 第 198-228 行，`buildEncodeArgs()` 对所有硬件编码器只指定了编码器（`-c:v hevc_qsv / hevc_nvenc / hevc_amf`），但**没有添加硬件解码加速 flag**：

```js
// 当前 QSV 分支（第 214-217 行）：
} else if (enc === 'qsv') {
  args.push('-c:v', 'hevc_qsv', '-preset', 'medium');
  // 缺少: -hwaccel qsv -hwaccel_output_format qsv
```

生成的 ffmpeg 命令（以飞机陷落为例）：
```
ffmpeg -y -i <4K_HEVC源> -c:v hevc_qsv -preset medium -rc vbr -b:v 10M ... <输出>
```

没有 `-hwaccel` flag，ffmpeg 使用 CPU 软件解码所有帧，然后上传到 GPU 编码。对于 4K HEVC（3840×1600），每一帧都要在 CPU 上完成 HEVC 解码 → 上传 GPU → QSV 编码 → 下载结果。在 Intel N95（4 个 E-core，6W 低功耗）上，软件 4K HEVC 解码极度缓慢。

**缺失的 flag 对照**：

| 编码器 | 缺失的 hwaccel | 缺失的 output_format |
|--------|---------------|---------------------|
| QSV (`hevc_qsv`) | `-hwaccel qsv` | `-hwaccel_output_format qsv` |
| NVENC (`hevc_nvenc`) | `-hwaccel cuda` | `-hwaccel_output_format cuda` |
| AMF (`hevc_amf`) | `-hwaccel d3d11va` 或 `vaapi` | 对应格式 |
| CPU (`libx265`) | 不受影响（无硬件加速可用） | — |

- `-hwaccel <backend>`：启用该后端的硬件解码
- `-hwaccel_output_format <backend>`：解码后的帧留在 GPU 显存中，避免 CPU↔GPU 来回拷贝

#### 性能影响估算（4K HEVC 源，6449s 电影）

| 场景 | 编码速度 | 预计耗时 |
|------|---------|---------|
| 当前（软解 + QSV 硬编） | ~0.05x 实时 | ~36 小时 |
| 修复后（QSV 硬解 + QSV 硬编） | ~0.5–1.5x 实时 | ~1–2 小时 |

#### 修复方向

在 `buildEncodeArgs` 中，为每个硬件编码器在 `-i` 之前插入对应的 hwaccel flag：

```js
const args = ['-hide_banner', '-y'];

// 插入硬件解码加速
if (enc === 'qsv') {
  args.push('-hwaccel', 'qsv', '-hwaccel_output_format', 'qsv');
} else if (enc === 'nvenc') {
  args.push('-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda');
} else if (enc === 'amf') {
  // Windows: d3d11va, Linux: vaapi
  args.push('-hwaccel', process.platform === 'win32' ? 'd3d11va' : 'vaapi');
}

args.push('-i', sourcePath, '-map', '0:v:0', '-map', '0:a?', '-map', '0:s?', '-dn');
// ... 后续编码器参数不变
```

**需要注意**：
- hwaccel flag 必须在 `-i` 之前
- `-hwaccel_output_format` 使解码帧留在 GPU 显存——如果后续需要 CPU 滤镜（如 DV tone mapping），则不能用 `_output_format`，只能用 `-hwaccel` 单独加速解码
- QSV 的 `-hwaccel_output_format qsv` 要求 ffmpeg 编译时启用 `--enable-libvpl` 或 `--enable-libmfx`
- 需要做 encoder self-test 确认 hwaccel 实际可用后再启用，不能假设总是可用

---

### #4 — QSV VBR 码率超标 + 转码后自动重复入队

**严重程度**：高

**发现日期**：2026-05-06

**影响范围**：所有 4K transcode 任务。双问题叠加导致钢铁侠 3 转码后仍超标、理论会循环重压。

#### 现象

- 钢铁侠 3：源码率 28.6M，策略 target 16M，QSV VBR 产出码率 **24M**（超标 50%）
- 转码后策略重新评估，24M > 16M 阈值，action 仍是 `transcode`
- 如无防重入 guard，48h freeze 过后会被 smartTaskEngine 再次自动入队
- 形成无限循环：转码 → 不达标 → 再次入队 → 再次转码 → …

#### 子问题 A：QSV VBR 敞口过大

**根因**：`transcodeService.js:209`，`maxrate = targetBitrate * 2`，敞口 2x。

QSV VBR 使用漏桶缓冲模型控制码率，编码器优先保画质不保码率。4K HDR 画面复杂，编码器判断不加大码率会糊，持续往 maxrate 靠。实际产出码率落在 target 的 1.3–1.5 倍（视内容复杂度）。

**修复**：将 maxrate 倍数从 2x 收紧到 1.3x：

```
transcodeService.js:209
  改前: const maxrate = bitrate ? String(targetBitrate * 2) + 'M' : null;
  改后: const maxrate = bitrate ? String(Math.round(targetBitrate * 1.3)) + 'M' : null;
```

设置 1.3x 的依据：
- 1.1x–1.25x：接近 CBR，可能伤画质
- 1.3x–1.4x：平衡区间，结果码率通常落在 target 的 1.1–1.3 倍
- 1.5x 以上：敞口过大，QSV 又会放飞
- 1.3x 作为起步值，后续根据实测微调

#### 子问题 B：转码后自动重复入队

**根因**：`smartTaskEngine.js` 仅通过 48h freeze（`lastTaskDoneAt`）拦一道，过期后同一 item 如果策略仍判 `transcode`，会再次入队。

**修复**：`smartTaskEngine.js` 加永久防重入 guard。逻辑：

```
自动入队过滤:
  item.action === 'transcode' && item.lastTranscodeDoneAt 存在
    → skip，永久不入队

手动 POST /v1/tasks:
    → 不限，照常创建
```

具体改动 2 处：

**1）`taskScheduler.js:84`** — transcode 完成时打标记

```js
// 在现有 lastTaskDoneAt 赋值后追加：
if (status === 'done' && oldTask.actionType === 'transcode') {
  libItem.lastTranscodeDoneAt = new Date().toISOString();
}
```

**2）`smartTaskEngine.js:81`** — 自动入队过滤

```js
// 在 48h freeze 判断之后追加：
if (item.action === 'transcode' && item.lastTranscodeDoneAt) return false;
```

不需要处理"upgrade 后清除标记"的场景——当前默认策略下 upgrade 目标是 4K 高码率，完成后策略判 keep，不会落 transcode。

---

### #5 — upgrade replace 阶段同步文件复制阻塞事件循环

**严重程度**：高

**发现日期**：2026-05-06

**影响范围**：所有 upgrade（洗版）任务的 replace 阶段。复制大文件时整个服务不可用。

#### 现象

- 洗版任务进入 replace 阶段后，admin-web 完全卡死
- `curl http://<ip>:18080/v1/health` 超时
- 容器内部端口也超时
- Node.js 进程进入 **D 状态**（不可中断 I/O 等待）
- 持续数分钟后恢复（文件复制完成后）
- 实测案例："解密"洗版任务 replace 阶段卡住整个服务

#### 根因

`upgradeFlowExecutor.js:132`，`copyDirSync` 使用 `fs.copyFileSync` **同步复制**：

```js
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    const srcPath = path.join(src, e.name);
    const destPath = path.join(dest, e.name);
    if (e.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);  // ← 4K 电影 20-40GB，同步阻塞数分钟
    }
  }
}
```

调用链：
1. `runReplace`（line 909）→ `copyDirSync(stagingFolder, tmpFolder)` 
2. 或 `atomicReplaceFolder`（line 103）→ `copyDirSync(sourceDir, newDir)`

两个路径都走同步复制。4K 电影文件 20-40GB，通过 Docker bind mount 写到 NAS，`fs.copyFileSync` 阻塞整个事件循环直到复制完成。期间所有 HTTP 请求、健康检查、API 响应全部停摆。

**对比 transcode 流程**：`transcodeService.replaceSwapOnce` 使用 `fs.promises.copyFile`（异步，走 libuv 线程池），不会阻塞事件循环。

#### 修复方向

将 `copyDirSync` 改为异步，并让所有调用方 `await`：

```js
async function copyDir(src, dest) {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const srcPath = path.join(src, e.name);
    const destPath = path.join(dest, e.name);
    if (e.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}
```

需改动的位置：
- `copyDirSync` → `copyDir`（async）
- `atomicReplaceFolder` 中 `copyDirSync` → `await copyDir`
- `runReplace` 中 `copyDirSync` → `await copyDir`
- `rmSync` / `renameSync` 也一并改为 `fs.promises.rm` / `fs.promises.rename`（虽然不是主因，但顺手改掉更好）

---

### #6 — upgrade TMDB 不匹配时应暂停等待用户修正，而非直接失败

**严重程度**：中

**发现日期**：2026-05-06

**影响范围**：所有 upgrade 任务。当 MoviePilot 刮削的 TMDB 与预期不符时，当前直接 `failed_hard`，用户需要从头重跑整个洗版（重新下载）。

**实测案例**："疾速追杀：芭蕾杀姬"，MoviePilot 下载了正确的种子（TMDB 1524719），但刮削阶段 MoviePilot 自己识别错了 TMDB。任务直接失败，浪费了下载完成的好文件。

#### 根因

`upgradeFlowExecutor.js:759-765`：

```js
if (expectedTmdbId && scrapeTmdbId) {
  if (expectedTmdbId !== scrapeTmdbId) {
    appendLog(taskId, 'error', `TMDB mismatch: ...`);
    scheduler.reportStatus(taskId, 'failed_hard');
    setPhase(taskId, 'failed_hard');
    return;
  }
```

遇到 TMDB 不匹配直接硬失败。但此时 staging 文件夹里的文件是正确的（种子下对了），只是 MoviePilot 刮削时元数据标错了。用户在 MoviePilot 里手动重新识别/刮削后文件就对了，应该允许继续。

#### 修复方向

不匹配时改为暂停等用户确认：

```js
if (expectedTmdbId && scrapeTmdbId) {
  if (expectedTmdbId !== scrapeTmdbId) {
    appendLog(taskId, 'warn',
      `TMDB mismatch: expected ${expectedTmdbId}, got ${scrapeTmdbId}. ` +
      `Please re-identify the media in MoviePilot, then confirm to continue.`);
    scheduler.pauseForConfirm(taskId, 'upgrade_pre_replace_verify');
    return;
  }
```

**流程**：

```
TMDB 不匹配
    ↓
status → awaiting_user_confirm（停住，保留 staging 文件）
    ↓
用户去 MoviePilot 手动重新识别/刮削
    ↓
MoviePilot 更新 staging 文件夹中的 NFO（TMDB 现在对了）
    ↓
用户在 ShelfDeck 点"确认继续"
    ↓
resumePoint = 'upgrade_pre_replace_verify' → 重新跑 runPreReplaceVerify
    ↓
重新读 NFO → TMDB 现在匹配 ✓ → 进入 replace
```

**关键设计点**：
- `resumePoint = 'upgrade_pre_replace_verify'`，确认后**重跑整个 verify 阶段**（重新读 NFO、重新生成 preview），而不是跳过校验直接 replace
- 如果用户在 MoviePilot 修正后 TMDB 还是不匹配 → 再次暂停，不进入死循环
- 用户也可以在 confirm UI 中选择取消（cancel），清理 staging 文件

---

### #7 — QSV hwaccel 导致 ffmpeg stderr 进度解析失效

**严重程度**：高

**发现日期**：2026-05-06

**影响范围**：所有使用 QSV 硬件加速（`-hwaccel qsv -hwaccel_output_format qsv`）的转码任务。部分任务进度永久卡 0%。

**实测案例**：攻壳机动队 (1995)，ffmpeg 跑了 30+ 分钟，CPU 14.4%（硬件在干活），但进度 0%。

**对比**：钢铁侠2 同样的代码/hwaccel 正常出了 8%。说明不是代码阻断，是 ffmpeg stderr 输出格式在不同源文件/场景下存在差异。

#### 根因推测

`transcodeService.js:245`，`parseFfmpegTimeMs` 正则：

```js
const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(line);
```

要求 `time=HH:MM:SS.xx`（必须有小数点）。`-hwaccel_output_format qsv` 全 GPU 管线下，QSV 运行时（VPL/libmfx）的进度输出格式可能与软解不同，比如不输出小数点部分（`time=00:05:30`），导致正则失配。

#### 修复方向

1. **放宽正则**，兼容无小数点格式：

```js
// 改前
const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(line);
// 改后
const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
```

2. **加 debug 日志**：每 5 分钟将未匹配的 stderr 行取样写入 `shelfdeck.log`，方便未来排查其他格式问题。

### #8 — upgrade 盲扫 staging 文件夹取错电影 + TMDB 校验被跳过 + 重复入队

**严重程度**：严重

**发现日期**：2026-05-07

**影响范围**：所有 upgrade 任务。当 `/upgrade/` 中存在残留文件夹时，可能把其他电影拷贝到目标媒体目录，覆盖掉正确的电影文件。

**实测案例**：新蝙蝠侠 (2022)，经历两次 upgrade 任务：
- 任务#1 (`b70c7e6bd31c2630`)：盲扫取到 `Dune.2021.*` 文件夹
- 任务#2 (`0df4ccd00d408d2a`)：盲扫取到 `Ballerina (2025)` 文件夹，TMDB 校验被跳过，最终把 Ballerina 拷贝进新蝙蝠侠目录

#### 现象

1. MoviePilot transfer 正确完成了（dest 路径正确、TMDB 正确）
2. ShelfDeck 的 `runPreReplaceVerify` 没有使用 transfer dest 定位 staging，而是盲扫 `/upgrade/`
3. 盲扫按文件系统顺序取第一个含 `.mkv` 的文件夹，拿到的是残留的其他电影
4. TMDB 校验因 `expectedTmdbId` 为 null 被跳过（条件 `expectedTmdbId && scrapeTmdbId` 为 false）
5. 新蝙蝠侠被 Ballerina (2025) 覆盖

#### 根因（三层）

**A. 盲扫 staging 定位（主因）**

`upgradeFlowExecutor.js` 的 `runPreReplaceVerify`：

```js
// 旧代码 — 纯盲扫，无身份校验
const entries = fs.readdirSync(stagingRoot, { withFileTypes: true });
for (const e of entries) {
  if (e.isDirectory() && !e.name.startsWith('.')) {
    // 取第一个含媒体文件的目录 ← 完全随机，取决于残留文件
    ...
  }
}
```

`waitForScraping` 超时或无法匹配 transfer 时，代码静默降级到盲扫。盲扫不区分"本次任务下载的"和"其他任务残留的"文件夹。

commit `b798818` (2026-05-05) 已部分修复：通过 `resolveStagingFromTransfer` 使用 MoviePilot transfer dest 精确定位。但 **Docker 容器未重建**，仍运行旧代码。且以下路径尚未覆盖：
- `waitForScraping` 超时时不存 `stagingTransferDest`，仍降级到盲扫
- 盲扫 fallback 分支没有移除

**B. TMDB 校验被跳过**

```js
if (expectedTmdbId && scrapeTmdbId) {
  if (expectedTmdbId !== scrapeTmdbId) { ... }
}
```

当 `task.itemInfo` 中没有 `tmdbId` 字段时，`expectedTmdbId` 为 null，整段校验被跳过。代码尝试通过 MoviePilot 的 `searchMediaByTitle` 动态解析，但任务创建时未携带 `tmdbId` 字段（`smartTaskEngine.createTask` 的 `itemInfo` 不含 `tmdbId`），动态解析在特定情况下也可能失败。

**C. 重复自动入队**

`smartTaskEngine.js:78-81` 的 48h freeze 依赖 `lastTaskDoneAt`：

```js
if (item.lastTaskDoneAt) {
  const freezeUntil = new Date(item.lastTaskDoneAt).getTime() + 48 * 3600 * 1000;
  if (now < freezeUntil) return false;
}
```

`taskScheduler.js` 的 `reportStatus` 中 `lastTaskDoneAt` 更新逻辑存在缺陷，任务#1 完成后未正确写入 library.json 中的对应 item。导致仅 17 小时后任务#2 就自动入队。

#### 修复方向

**1. 消除盲扫 fallback**：

```js
// runPreReplaceVerify — 当无法精确定位 staging 时，不应降级到盲扫
if (transferDest && mpConfig) {
  const localPath = resolveStagingFromTransfer(transferDest, mpConfig.savePath, stagingRoot);
  if (localPath && fs.existsSync(localPath)) {
    // 使用精确路径
  } else {
    // 不应 fallback 到盲扫 — staging 残留无法区分来源
    appendLog(taskId, 'error', '无法定位 transfer dest，可能有残留文件夹干扰');
    scheduler.pauseForConfirm(taskId, 'upgrade_pre_replace_verify');
    return;
  }
}
```

**2. 强化 TMDB 校验**：

- `smartTaskEngine.createTask` 时把 `item.tmdbId` (Emby ProviderIds.Tmdb) 写入 `itemInfo.tmdbId`
- 当 `expectedTmdbId` 为 null 且 `scrapeTmdbId` 存在时，不应静默跳过——至少 warn 并 pauseForConfirm

**3. 在 `waitForScraping` 超时路径中存储 stagingTransferDest**：

commit `b798818` 中 `waitForScraping` 正常匹配分支已存 `stagingTransferDest`，但超时返回 null 的路径也应当查找 transfer history 中最近一条匹配 download_hash 的记录并存储——即使超时了，转移记录可能仍然存在。

**4. 修复 `lastTaskDoneAt` 写入**：

在 `taskScheduler.reportStatus` 中，任务 done 时确保 `lastTaskDoneAt` 正确写入 library item。

**5. 重建 Docker 容器**：

当前 Docker 运行的是 commit `9d425a2` 或 `b798818` 之前的版本。commit `b798818` 的部分修复尚未部署。

#### 文件涉及

| 文件 | 改动点 |
|------|--------|
| `upgradeFlowExecutor.js` | `runPreReplaceVerify` — 移除盲扫 fallback；强化 TMDB 校验 |
| `upgradeFlowExecutor.js` | `waitForScraping` — 超时路径也存 stagingTransferDest |
| `smartTaskEngine.js` | `createTask` — 写入 `tmdbId` |
| `taskScheduler.js` | `reportStatus` — 确保 `lastTaskDoneAt` 写入 |

---

### #9 — season upgrade 精确搜索 meta_info 被硬编码为 null，auto mode 误触发用户确认

**严重程度**：中

**发现日期**：2026-05-07

**影响范围**：所有 season (剧集) upgrade 任务。精确搜索返回的 candidates 被硬编码 `meta_info: null`，导致：
1. `hasMetaInfo` 检查为 false，强制进入 `pauseForConfirm`
2. 如果用户确认后进入 `runExecuting`，auto mode 下 `getRankedPool` 因无 meta_info 过滤掉所有 candidate，`retryPool` 为空 → `failed_hard`

#### 根因

`upgradeFlowExecutor.js:386`，精确搜索结果映射时将 `meta_info` 写死为 null：

```js
candidates = exactRes.data.map((t) => ({ torrent_info: t, meta_info: null }));
//                                                              ^^^^^^^^^^^^
```

`searchTorrents`（fuzzy search）返回的每项已经是 `{ torrent_info, meta_info }` 结构。`searchMediaById`（精确搜索 `/api/v1/search/media/{id}`）返回结构**未调研**——不知道返回的数据中是否包含 `video_encode` / `resource_pix` 等字段，也不知道这些字段是否在 `torrent_info` 内部还是在独立字段中。需要实调 MoviePilot API 确认。

#### 修复方向

1. **调研**：打一个 `GET /api/v1/search/media/tmdb:xxx?season=1` 请求，检查返回 JSON 结构
2. 如果返回数据中包含编码/分辨率/音轨等信息 → 正确映射到 `meta_info`
3. 如果返回数据不包含 → 对 season 精确搜索 + auto mode 不进入 `pauseForConfirm`，降级到 fuzzy search 获取 meta_info

#### 文件涉及

| 文件 | 改动点 |
|------|--------|
| `upgradeFlowExecutor.js` | `runPlanning` — 修复 season 精确搜索结果映射，区分 auto/manual mode |

---

## §3 关联文档

- `design/SERVICE/TRANSCODE_FLOW.md` — Transcode Flow 执行器设计
- `design/SERVICE/TRANSCODE.md` — 转码执行层设计
- `design/SERVICE/UPGRADE_FLOW.md` — Upgrade Flow 执行器设计
- `design/SERVICE/TASK_SCHEDULER.md` — 任务调度引擎
- `DEBUG_WORKFLOW.md` — 排查工作流
