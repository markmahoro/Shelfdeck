# ShelfDeck 媒体库管家

一站式 Emby/Jellyfin 媒体库管理工具。自动分析观影记录与评分，推荐删除低分、压缩高码率、洗版到 4K——无需手动规划。

## 功能概览

- **媒体库盘点**：同步 Emby 媒体库数据，自动分析码率/分辨率/编码格式
- **豆瓣评分**：抓取豆瓣"看过"评分，辅助决策
- **策略推荐**：根据评分配置，自动推荐删除/转码/洗版操作
- **任务中心**：一键执行删除（Emby 直接删除）、转码（FFmpeg 压缩）、洗版（MoviePilot 搜索优质版本）
- **桌面客户端**：双栏浏览未观看内容 + 媒体库管理 + 播放记录

## 快速开始

### 环境要求
- Windows 10/11
- Node.js ≥ 20（部署包已自带，用户无需安装）
- Emby/Jellyfin 服务器（同一局域网）

### 安装

1. 下载最新 Release 的 `ShelfDeck-v1.0.0.zip`
2. 解压到任意目录
3. 双击 `shelfdeck_service启动器.vbs` → 系统托盘出现图标 + 浏览器打开管理页面
4. 双击 `ShelfDeck播放助手.exe` → 桌面客户端

### 首次使用

1. 浏览器打开的管理页面（`http://127.0.0.1:18080/admin`）
2. 仪表盘 → 添加媒体库
3. 填入 Emby 服务器地址、用户名、密码 → 登录
4. 选择媒体文件夹 → 配置名称、路径映射、豆瓣开关 → 完成
5. 等待媒体库刷新（通常几秒），策略推荐自动生成

## FAQ

### 为什么用"登录 Emby"而不是填 API Key？

Emby API Key 藏在服务器管理后台深处（设置 → 高级 → 安全），普通用户很难找到。用户名+密码登录更自然——和你平时在手机/网页上登录 Emby 一样。登录后 ShelfDeck 会自动获取授权，等效于 API Key 的功能。

### ShelfDeck 和 Emby 在同一台 Windows 上，需要配路径映射吗？

不需要。Emby 返回的文件路径就是 Windows 本地路径，ShelfDeck 可以直接访问。

### 什么时候需要路径映射？

ShelfDeck 在 Windows，Emby 在 NAS/Docker/Linux 上时。Emby 返回的路径是 NAS 上的（如 `/volume1/Media/Film/xxx.mkv`），Windows 访问不了。这时需要告诉 ShelfDeck 怎么"翻译"路径：
- `pathMapFrom`: `/volume1/Media`（Emby 看到的路径前缀）
- `pathMapTo`: `Z:\`（Windows 上映射的网络驱动器）

ShelfDeck 会把所有以 `/volume1/Media` 开头的路径替换为 `Z:\`。映射到网络驱动器或 UNC 路径都可以。

### 添加媒体库后，策略推荐全是"策略未覆盖"？

这是首次安装时的正常现象。媒体库刷新完成后后台需要几秒钟计算码率字段（`equivalentBitrate`），策略引擎下轮扫描才能产生推荐结果。通常 1 分钟内就会更新。如果一直不更新，去"实时日志"区域看看有没有 `Library 自算完成` 和 `策略重新计算完成` 两条日志。

### 没有 MoviePilot，能做什么？

删除和转码功能不依赖 MoviePilot，可以直接用。洗版（自动搜索高质量版本替换）需要 MoviePilot 服务。

### 托盘的"异常"状态正常吗？

托盘健康状态文字（如"ShelfDeck — 异常"）是实时检查 service、Emby、转码、洗版等 8 项服务的结果。如果某些功能你没有启用（如 MoviePilot、转码设备），对应的检查会拉低整体状态。不影响已配置功能正常使用。点开 admin web 的仪表盘可以看到每项的具体状态。

### 删除任务需要什么权限？

删除操作需要 Emby 允许该用户删除媒体的权限。如果你登录的用户可以在 Emby 网页端手动删除电影，ShelfDeck 也能删。用户密码在登录时已保存，用于删除鉴权。

### 豆瓣评分同步一直显示"跳过"？

需要先去"豆瓣集成"页面配置豆瓣用户 ID（豆瓣"看过"页 URL 中 `people/` 后面的那串数字）。如果豆瓣账户设置的是"仅自己可见"，还需要填入登录 Cookie。

### ShelfDeck 能跑在 NAS/Docker 上吗？

v1.0.0 仅提供 Windows 版。service 是纯 Node.js，理论上可以在任何平台运行（`node src/server.js`），但托盘和桌面客户端仅支持 Windows。

## 开源合规

**许可协议**：[GPL-3.0](LICENSE)

**FFmpeg**：本软件捆绑 FFmpeg（`ffmpeg-static`、`@ffprobe-installer/ffprobe`），FFmpeg 以 GPL-3.0 授权。源码：[https://ffmpeg.org/download.html](https://ffmpeg.org/download.html)

**合规风险提示**：
- **豆瓣数据抓取**：豆瓣评分通过 HTTP 获取，未获豆瓣官方授权。可禁用此功能（不配置豆瓣用户 ID）
- **Emby/Jellyfin 授权**：ShelfDeck 不含 Emby/Jellyfin 软件，用户需自备合法授权

## 开发者

### 项目结构

| 目录 | 说明 |
|------|------|
| `media-service/` | Node.js/Fastify HTTP 服务 + 内置 React 管理页面 |
| `media-desktop/` | Electron + Vite/React 桌面客户端 |

### 开发环境

```bash
# 终端 A：启动服务
cd media-service && npm start

# 终端 B：启动桌面客户端
cd media-desktop && npm run dev
```

管理页面：`http://127.0.0.1:18080/admin`

### 构建发布

```bash
node scripts/build-release.js
```

产物在 `dist-release/ShelfDeck-v1.0.0/`

### 设计文档

完整设计文档索引：[docs/v2/DOC_GOVERNANCE.md](docs/v2/DOC_GOVERNANCE.md)
