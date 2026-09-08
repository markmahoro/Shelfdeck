# UAT-119：真实 TMDB 代理验收

2026-09-08 23:45（Asia/Shanghai），逐项验收关闭。生产为 `helix-beta-20260908-696b122da4`；本项没有修改生产配置或重启服务。

- Edge 实际打开生产系统设置：TMDB 当前可用，首选语言简体中文，代理 `http://192.168.12.230:7890`，保存按钮禁用，配置没有待提交变化。
- 使用生产一致性备份中的当前 revision 1 配置及加密凭据，调用实际 TMDB adapter、Secret Lease 与 ProxyAgent，经 NAS 实际代理访问公网。Query/Handle 上下文采用只读快照适配；这是实际网络出口验证，不冒充一次完整生产事务。
- `/configuration`、连接测试 `/movie/550`、影片 metadata `/movie/550`、人物 `/person/287`、头像图片、影片 images 列表与海报图片共 7 次 GET 均为 200；逐次确认 dispatcher 存在，API 与图片共用该代理。取得 16 条人物线索、8498 字节头像和 1179737 字节海报。图片未落盘，凭据与响应缓冲已清零；记录不含密钥或查询参数。
- `node --test media-service/test/helix-architecture/p14-h1-tmdb-integration.test.js`：11 PASS / 0 FAIL，覆盖代理设置变更复用凭据、非法带账号密码代理拒绝、网络/HTTP/schema/timeout 失败不半提交与租约约束。
- 原缺口“仅替身回归、缺真实代理证据”已补齐，连接/API/人物头像/海报统一出口及非法代理拒绝满足本行关闭条件。外部服务未来可用性不属于一次验收永久保证。

本地原始材料（忽略、不提交）：`.codex/uat119-real-proxy.cjs`、`.codex/uat119-real-proxy-result.json`、`.codex/uat119-integration-regression.log`。没有新增生产媒体或修改库数据。
