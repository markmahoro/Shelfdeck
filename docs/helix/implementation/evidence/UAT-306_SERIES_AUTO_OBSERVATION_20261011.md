# UAT-306 Series 自动观察

2026-10-11。用户授权修复并部署本地；明确不为历史条目添加兼容或防重复处理代码，重新处理《人世间》属于可接受预期。NAS不在本次部署范围。

## 根因与修复

国产剧总Field从未Observation；已有两个临时Series Field来自手动扫描。`field-observation-automation.js`的Movie-only判断跳过全部Series。依据SSOT §6.9.1，在既有Procurement Owner中允许Movie与Series自动观察，沿用启动、12小时周期、并发及失败节流规则。没有迁移、历史条目保护、Reset或数据修补。

## 验证

Windows自动化与Eligibility回归15项通过。95集隔离Host移除手动观察请求，仅凭自动化发布一个95成员Season Candidate，持久证据重建通过（Unit 67785字节，Structure 2022字节），46.22秒完成。既有其他Host仍保留手动入口覆盖。

Linux同源容器通过4项：Movie/Series启动周期、未扫描Series入队、95集自动扫描封包（55.69秒；36项按名称过滤跳过）。本地部署记录见下。此次未改变UI、Schema或Desktop；未重跑服务全套，既有UAT-304/305不因本修复关闭。

## 本地加载

代码提交`525469601`已于19:28加载到`http://127.0.0.1:18081`，PID8704；health 200、status ok、normalSupplyAllowed=true。核对旧PID/监听后按持续授权快速重启，停机SQLite备份SHA256 `7f150f937120c8d6421dc067dca3b12fe175af55769afc998ea05f1502f17b00`。

未手动调用Observation。国产剧总Field自动创建`periodic-field-observation:media-field-a834d484-4bf8-4798-982b-f00ac28f46cc:access-1:observation-0:period-41474`，原无观察记录现已持续分页发现文件；两个临时Field亦正常自动观察。未注销临时Field、未改历史状态、未Reset。失败历史保持，运行日志无新错误。

19:31现场验收：国产剧总Field Observation `succeeded`，发现4955个文件；自动建立2个active Procurement Run，分别选择986/656个Material、24/16个Scope，总1642个Material、40个Scope。其他剧集已实际进入采购；最终封包、整理、上架继续异步执行，不作为本次自动观察缺陷的整体上架声明。UAT-306按自动观察并进入Procurement的自身条件关闭。
