# DESIGN_TRAY/CONNECTION_WRITER — 连接配置写入（已废弃）

> 状态：已废弃
> 关联 ARCH_OVERVIEW §5

托盘不再管理连接配置。desktop 通过 electron-store 自行管理 service 地址，默认连接 `http://127.0.0.1:18080`。

> 注：`connection.json` 文件读取支持仍保留在 `media-desktop/electron/shelfdeckConnection.js` 中（作为 `readConnectionFile()` 降级路径之一），尚未完全移除。该文件不再由托盘写入，仅供桌面端兼容读取历史配置。
