# VPN 接入本地 NAS（Cloud Agent 用）

Cloud Agent 运行在云端 VM，无法直连家庭内网的 NAS（私网地址 `192.168.12.230`）。
`tools/vpn-connect.sh` 用 OpenVPN 建立**拆分隧道（split-tunnel）**：只把 NAS 所在网段
`192.168.12.0/24` 走 VPN，其余流量（Cursor / GitHub）仍走云端本地出口，避免 agent 自身断连。

## 前置：Secrets 面板配置

在 Cursor 右侧 **Secrets** 面板添加（值仅在 **新 run 启动时**注入为环境变量，运行中的会话添加后需重开一次 run 才生效）：

| Secret | 必填 | 说明 |
|--------|------|------|
| `OPENVPN_CONFIG` | 是 | 完整 `.ovpn` profile 内容（含内联 `ca`/`cert`/`key`/`tls-auth`）。**含私钥，切勿提交到仓库。** |
| `OPENVPN_AUTH_USERNAME` | 是 | OpenVPN 连接用户名 |
| `OPENVPN_AUTH_PASSWORD` | 是 | OpenVPN 连接密码 |
| `SHELFDECK_NAS_USER` | 是 | 隧道建好后 SSH 登录 NAS 的用户名 |
| `SHELFDECK_NAS_PASSWORD` 或 `SHELFDECK_NAS_KEY` | 二选一 | NAS SSH 密码，或私钥内容（加密私钥再加 `SHELFDECK_NAS_KEY_PASSPHRASE`） |

脚本会自动把 `remote` 改写为 DDNS 域名、注释掉 `redirect-gateway`（全局路由），
并补上 `route-nopull` + `route 192.168.12.0 255.255.255.0`。

可选覆盖：`NAS_VPN_REMOTE_HOST`（默认 `a.markmahoro.top`）、`NAS_VPN_REMOTE_PORT`（默认 `1194`）、
`NAS_VPN_ROUTE_NET` / `NAS_VPN_ROUTE_MASK`。

## 用法

```bash
sudo apt-get install -y openvpn        # 若未安装
bash tools/vpn-connect.sh              # 建立隧道，等待 "VPN UP"
node tools/ssh-exec.js "uname -a"      # 隧道通后即可查 NAS
```

连接日志：`$HOME/vpn/openvpn.log`。断开：`sudo kill $(cat $HOME/vpn/openvpn.pid)`。
