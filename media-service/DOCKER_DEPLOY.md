# ShelfDeck Docker 部署

## 快速开始

1. 复制 `docker-compose.example.yml` → `docker-compose.yml`
2. 按文件中注释修改路径
3. 如有 Intel 核显，取消 `devices:` 的注释
4. `docker compose pull && docker compose up -d`
5. 浏览器打开 `http://<NAS的IP>:18080`，配置 Emby 连接、转码设备池

## 完整指南

见《ShelfDeck-Docker部署指南》（含截图和常见错误速查），随发布包提供或从仓库下载。
