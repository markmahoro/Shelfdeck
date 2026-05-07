# DESIGN_SERVICE/FACE_INDEX — 人脸识别索引

> 状态：v1 草案（设计阶段，未实现）
> SSOT：本文是人脸识别子系统的唯一设计来源

---

## §1 架构定位

### 1.1 分布式分工

```
NAS (Docker Service)                     Desktop (4080S, Python sidecar)
──────────────────────                   ─────────────────────────────────
 taskScheduler                           faceWorker (独立进程)
   │ 管理 FACE_INDEX 任务                   │ 轮询待处理任务
   │                                     │
 faceIndexStore                           ffmpeg 场景检测 + 提帧
   │ 演员模板 CRUD                          │ (SMB 直读 NAS 视频文件)
   │ embedding 索引持久化                    │
   │                                     │ InsightFace (ONNX, CUDA)
 API: /v1/face/*                           │ 人脸检测 + embedding 提取
   │ 匹配查询 + 演员管理                     │
   │                                     │ 余弦相似度比对
                                         │ PATCH 结果回 Service
```

**原则：NAS 只做调度+存储+查询。Desktop 承担全部重计算（ffmpeg + AI）。**

### 1.2 与现有架构的关系

- 复用 `taskScheduler.js` 的任务调度框架，新增 `actionType: "face_index"`
- 复用 `taskStore.js` 的任务持久化
- 不新增 Flow Executor——face 任务由 Desktop Worker 直接驱动（不同于 delete/transcode/upgrade 由 Service 端 Flow 执行）
- face 任务的 `status` 流转复用现有状态机（queued → executing → done）

---

## §2 数据模型

### 2.1 演员模板

```json
{
  "actorId": "act_0001",
  "name": "演员自定义名称",
  "embedding": [0.123, -0.456, ...],  // float32[512], 多张登记照均值
  "sourceImages": ["act_0001_001.jpg", "act_0001_002.jpg"],
  "createdAt": "2026-05-06T10:00:00Z"
}
```

### 2.2 FACE_INDEX 任务

在现有 task 对象基础上扩展：

```json
{
  "taskId": "task_face_0001",
  "itemId": "emby_item_12345",
  "actionType": "face_index",
  "status": "queued",
  "faceIndex": {
    "smbPath": "\\\\192.168.12.230\\video\\movies\\xxx.mkv",
    "frameCount": null,
    "matches": []
  }
}
```

### 2.3 匹配结果

```json
{
  "actorId": "act_0001",
  "name": "演员自定义名称",
  "confidence": 0.87,
  "bestFrameIndex": 142,
  "matchCount": 35
}
```

---

## §3 API

### 3.1 演员管理（Service）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/v1/admin/face/actors` | 上传演员照片，提取 embedding 并存储 |
| GET | `/v1/admin/face/actors` | 列出所有演员模板 |
| DELETE | `/v1/admin/face/actors/:actorId` | 删除演员模板 |

### 3.2 查询（Service）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/v1/face/match` | 上传一张照片，返回匹配的演员 top-k |
| GET | `/v1/face/items/:itemId/matches` | 查询某影片的已索引匹配结果 |

### 3.3 Worker 通信

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/admin/face/tasks/pending` | Worker 轮询待处理的 face_index 任务 |
| PATCH | `/v1/admin/face/tasks/:taskId` | Worker 上传匹配结果 |

---

## §4 Desktop Worker 数据流

```
1. Worker 轮询 GET /v1/admin/face/tasks/pending → 拿到 task

2. ffmpeg 场景检测
   ffmpeg -i \\192.168.12.230\video\xxx.mkv \
     -vf "select='gt(scene,0.3)'" -vsync vfr -f null NUL
   输出: 关键帧时间戳列表

3. ffmpeg 逐帧提取到本地临时目录 (SSD)
   ffmpeg -ss <pts> -i <smbPath> -vframes 1 frame_%03d.jpg
   典型: 300-800 帧, ~60MB

4. InsightFace 批量推理 (CUDA)
   - 人脸检测 (buffalo_l, scrfd_10g)
   - embedding 提取 (w600k_r50, 512-dim)
   - 仅保留检测到 ≥1 人脸的帧

5. 余弦相似度比对
   每帧每个人脸 vs 所有演员模板
   聚合: 同一演员在 ≥3 帧中出现 → 确认匹配

6. PATCH /v1/admin/face/tasks/:taskId 上传结果
   清理本地临时帧

7. Service faceIndexStore 持久化匹配结果
```

---

## §5 技术选型

| 环节 | 选型 | 原因 |
|------|------|------|
| 人脸检测+识别 | InsightFace (ArcFace) | 遮挡/侧脸/光照变化下鲁棒性最好 |
| 推理运行时 | ONNX Runtime + CUDA | RTX 4080S 上 ~5ms/帧 |
| Worker 语言 | Python | InsightFace Python 生态最完整，CUDA 开箱即用 |
| 帧提取 | ffmpeg scene detect | 复用项目已有能力，场景切变检测比均匀采样更高效 |
| 通信协议 | HTTP REST | 复用项目现有架构，无需额外协议 |

---

## §6 待定决策

1. **Worker 生命周期**：独立 Python 进程（推荐） vs Electron subprocess
2. **SMB 路径映射**：task 中直接带 SMB 路径，还是 Worker 端做路径转换
3. **演员模板 embedding 提取位置**：Desktop Worker（GPU 加速） vs Service（简单但慢）
4. **多 Worker 支持**：单台 Desktop 够用，暂不考虑多 GPU 协调
5. **阈值策略**：余弦相似度 ≥ 0.6 视为候选，同一演员 ≥ 3 帧命中确认

---

## §7 关联文档

- `DESIGN_SERVICE/TASK_SCHEDULER.md` — 复用调度框架
- `DESIGN_SERVICE/API.md` — API 设计约定
- `DESIGN_DESKTOP.md` — Desktop 组件总览
