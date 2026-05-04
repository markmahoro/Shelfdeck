# ShelfDeck Docker 部署指南

本指南从零开始，带你完成 ShelfDeck 在飞牛 NAS 上的 Docker 部署，包括转码硬件加速和洗版功能的完整配置。

## 1. 准备工作：创建文件夹

在飞牛 NAS 文件管理中，创建以下三个文件夹：

```
/vol1/1000/docker/shelfdeck/
├── data/          ← 存放配置、任务队列、日志
├── transcode/     ← 转码临时文件（转码完成后自动清理）
└── upgrade/       ← 洗版下载中转目录
```

transcode，upgrade两个文件夹也可以不放在docker文件夹下，后续docker-composer中正常映射即可。

---

## 2. 准备工作：MoviePilot 配置

> 如果你不需要洗版功能，可跳过本节。

ShelfDeck 洗版需要 MoviePilot 配合。在 MoviePilot 中配置一个新的下载目录，专供 ShelfDeck 使用。

### 操作步骤

1. 打开 MoviePilot Web 管理页

2. 进入 **设定→ 存储&目录 → 目录**

3. 按+号添加目录

   目录配置：资源目录路径 /vol1/1000/docker/shelfdeck/upgrade；整理方式"移动"；媒体库目录/vol1/1000/docker/shelfdeck/upgrade

   打开"刮削元数据"及"智能重命名"

4. 保存

**说明**：ShelfDeck 会通过 MoviePilot REST API 下发洗版任务，MoviePilot 搜种下载后，文件落入此目录，并完成刮削。刮削完成后，Shelfdeck会从这个目录中取走文件，并替换原有媒体库内的文件。

---

## 3. 修改 docker-compose.yml

将 `docker-compose.example.yml` 复制为 `docker-compose.yml`，然后根据你的硬件和路径修改。

### 3.1 文件夹路径映射

找到以下映射区域，把**冒号左边**改成你飞牛上的真实路径：

```yaml
volumes:
  # data 目录 — 改为你的 shelfdeck 上层路径
  - /vol1/1000/docker/shelfdeck/data:/app/data

  # transcode 目录 — 改为你的转码临时目录
  - /vol1/1000/docker/shelfdeck/transcode:/transcode

  # upgrade 目录 — 改为你的洗版下载目录
  - /vol1/1000/docker/shelfdeck/upgrade:/upgrade

  # 媒体文件目录
  -（Emby媒体库在飞牛中的访问路径）:/media
```

### 3.2 GPU 硬件加速

根据你的显卡类型选择，取消对应行的 `#`：

#### 我是 Intel 核显（最常用）

```yaml
    devices:
      - /dev/dri:/dev/dri
```

#### 我是 NVIDIA 独显

先装 NVIDIA Container Toolkit，然后：

```yaml
    runtime: nvidia
    environment:
      # 在下面已有的 environment 区域追加这两行
      - NVIDIA_VISIBLE_DEVICES=all
      - NVIDIA_DRIVER_CAPABILITIES=compute,video
```

#### 我是纯 CPU（不玩转码）

不需要改任何内容。

---

## 4. 启动容器

将改好的 `docker-compose.yml` 直接使用飞牛docker应用构建。

---

## 5. Shelfdeck 配置：Emby 连接 + 添加媒体库

浏览器打开 `http://<你的飞牛IP>:18080`，进入 ShelfDeck 管理控制台。

### 5.1 添加媒体库

1. 点击左侧 **「仪表盘」**
2. 点击媒体库卡片中的 **「添加媒体库」** 按钮

### 5.2 Step 1：登录 Emby

| 字段       | 填写内容                                     |
| -------- | ---------------------------------------- |
| 服务器地址    | Emby 的完整地址，如 `http://192.168.12.45:8096` |
| Emby 用户名 | 你的 Emby 登录用户名                            |
| Emby 密码  | 你的 Emby 登录密码（仅用于获取授权，不会明文存储）             |

点击 **「登录 Emby」** 按钮。

### 5.3 Step 2：选择媒体文件夹

从下拉列表中选择要同步的 Emby 媒体文件夹（如"电影"）。

### 5.4 Step 3：媒体库详细配置

| 字段       | 填写说明                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 媒体库名称    | 默认已填，可自定义                                                                                                                         |
| 启用豆瓣评分同步 | 建议勾选（自动拉取豆瓣评分）                                                                                                                    |
| 路径映射     | 左边是Emby中的媒体库目录（我个人的Emby是部署在群晖上的，所以目录名称是/volume1/Media/Film），右边是容器内访问这个媒体库文件的目录（/media/Film），注意：在docker配置环节，我们已经完成了从飞牛内访问到容器内访问的映射 |
| 策略模板     | 策略模板是指："什么样的情况下会触发转码或者洗版"。本docker自带一个默认策略模板，也可以在策略模板配置中对于模板进行修改。                                                                  |

点击 **「完成添加」**。

等待片刻，左侧仪表盘会显示已同步的媒体数量。

---

## 6. Shelfdeck 配置：转码 + 设备池

### 6.1 基本设置

点击左侧 **「转码设置」**，进入转码配置页。

| 字段   | Docker 环境下的值 |
| ---- | ------------ |
| 临时目录 | `/transcode` |

### 6.2 检测设备

点击 **「检测设备」** 按钮。

如果配置了 GPU 加速，检测结果中会出现 `Intel Quick Sync（QSV）` 或 `NVIDIA NVENC`：

| 你的硬件      | 检测结果                            |
| --------- | ------------------------------- |
| Intel 核显  | `qsv:0` — Intel Quick Sync（QSV） |
| NVIDIA 独显 | `nvenc:0` — NVIDIA NVENC        |
| 纯 CPU     | `cpu:libx265` — CPU 软件编码        |

### 6.3 配置设备池

在编码设备池表格中：

1. 勾选你需要的设备的 **「入池」** 复选框
2. 设置优先级（数字越小优先级越高，建议 QSV/NVENC=100, CPU=200）
3. 设置槽位数（核显建议 1，独显可设 2-3）
4. 点击 **「保存设备池」**

---

## 7. Shelfdeck 配置：洗版 (MoviePilot)

> 如果你不需要洗版功能，可跳过本节。

点击左侧 **「洗版设置」**。

### 7.1 MoviePilot 连接

| 字段        | 填写内容                                         |
| --------- | -------------------------------------------- |
| 服务地址      | MoviePilot 地址，如 `http://192.168.12.230:3000` |
| API Token | MoviePilot 的 API 密钥（在 MP 设置→API 中获取）         |

### 7.2 路径映射

| 字段             | 填写内容              | 说明                                  |
| -------------- | ----------------- | ----------------------------------- |
| 容器内下载目录        | MoviePilot 下载目录   | /vol1/1000/docker/shelfdeck/upgrade |
| 容器内 Staging 目录 | Moviepilot下载后移动目录 | /vol1/1000/docker/shelfdeck/upgrade |
| 本地 Staging 路径  | `/upgrade`        | 上述路径在shelfdeck中映射的路径。               |

---

### 8 Shelfdeck配置：任务调度

每一个媒体库可以选择3中任务调度模式

全自动模式：依据策略自动生成任务，任务完成后自动替换原文件。

自定义模式：可设定人工介入的节点。

全手动模式：所有节点需要人工介入。

---

## 8. 验证：任务测试

### 8.1 发起转码任务

1. 点击左侧 **「媒体库」**
2. 点击刷新媒体库管理策略
3. 在媒体库中找到一部电影
4. 点击 **「转码」**
5. 切换到 **「任务监控」** 页面查看进度

如果状态变为 **「已完成」** 且没有报错，恭喜，部署成功！

---

## 附录：docker-compose.example.yml

文件位置：`docker-compose.example.yml`（和本指南在同一个目录下）

复制后按第 3 节内容修改即可。
