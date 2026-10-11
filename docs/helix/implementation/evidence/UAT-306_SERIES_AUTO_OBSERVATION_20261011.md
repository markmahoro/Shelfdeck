# UAT-306 Series 自动观察

2026-10-11。用户授权修复并部署本地；明确不为历史条目添加兼容或防重复处理代码，重新处理《人世间》属于可接受预期。NAS不在本次部署范围。

## 根因与修复

国产剧总Field从未Observation；已有两个临时Series Field来自手动扫描。`field-observation-automation.js`的Movie-only判断跳过全部Series。依据SSOT §6.9.1，在既有Procurement Owner中允许Movie与Series自动观察，沿用启动、12小时周期、并发及失败节流规则。没有迁移、历史条目保护、Reset或数据修补。

## 验证

Windows自动化与Eligibility回归15项通过。95集隔离Host移除手动观察请求，仅凭自动化发布一个95成员Season Candidate，持久证据重建通过（Unit 67785字节，Structure 2022字节），46.22秒完成。既有其他Host仍保留手动入口覆盖。

Linux同源容器通过4项：Movie/Series启动周期、未扫描Series入队、95集自动扫描封包（55.69秒；36项按名称过滤跳过）。本地部署验收结果待补。此次未改变UI、Schema或Desktop；未重跑服务全套，既有UAT-304/305不因本修复关闭。
