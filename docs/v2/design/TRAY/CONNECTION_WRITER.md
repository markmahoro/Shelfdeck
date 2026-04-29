# DESIGN_TRAY/CONNECTION_WRITER — 连接配置写入（已废弃）

> 状态：已废弃
> 关联 ARCH_OVERVIEW §5

托盘不再管理连接配置。desktop 通过 electron-store 自行管理 service 地址，默认连接 `http://127.0.0.1:18080`。
