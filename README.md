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
