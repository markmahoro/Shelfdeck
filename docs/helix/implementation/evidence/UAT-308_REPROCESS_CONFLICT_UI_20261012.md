# UAT-308：重新整理冲突的具体版本 UI 验收

2026-10-12，UI负责人对 `cd274f8a6c478651fa2dd22f5d932ffa2626ad5d` 的受影响路径接受。此结论限定于本项实际浏览器、HTTP、幂等与文件保护证据，不代替生产升级资格或《大江大河》33集现场复验。

后端根因与修复基线见 [UAT-308 原 Evidence](UAT-308_REPROCESS_OBSERVATION_CONFLICT_20261012.md)。后端提交 `7b01826c9ef5b05193429cdf853062347099eb62` 保持 Observation 准入，将来源占用映射为 HTTP 409；本次没有修改该 Owner 合同。

## 用户路径与变更

从“媒体整理工作区 → 已结束 → 查看过程 → 重新整理”进入原确认框。来源正在扫描时，就地显示“来源扫描尚未结束，稍后再试。”，沿用 `form-error` 的字号、边框和语义配色；保持确认按钮可重试，不显示成功。仅精确的 `409 / ADMIN_FIELD_CONFLICT / FIELD_OBSERVATION_WORK_DEFERRED` 使用此原因，其他错误保留原未确认成功反馈。

确认框取消或 Esc 只关闭内层确认，外层过程详情保留，焦点返回“重新整理”。修复 `ProcessDialog` 的 document Escape handler，使存在内层原生 dialog 时不关闭外层；确认框的 cancel event 也不向外传播。没有改变媒体整理列表、页面数量、按钮体系或业务权限。

重试沿用组件原有 idempotency key。收到 202 后才显示“已提交重新整理”。409 前已经持久化的意图保持，由原有 Owner 重放；未添加回退、迁移、数据修复或兼容路径。

实施提交：`d1c40fcdaa8f4bc3caa3c1844d47c1956a2799fb`（冲突反馈、嵌套确认与回归）；`d5001c591582418f6bf819e83904e7e45da61c3f`（统一错误样式）；`cd274f8a6c478651fa2dd22f5d932ffa2626ad5d`（浏览器测试读取正式 Observation receipt envelope）。

## 冻结源码与验证

共享工作区另有并行合同修改，最终验证从指定提交的 `git archive` 副本构建和启动，没有读取这些未提交修改。审计目录：`E:/my_project/helix-git-consolidation-20261008/uat308-20261012/`。

- 源码包：`source-cd274f8a6c.zip`，SHA256 `4a32afdd3fe40c0edff778dce61340076317bf9c5405a49083f2ded4b4100aaf`。
- 前端：28文件、144测试通过；TypeScript/Vite 构建通过，产物 `index--m8OvhRG.js`。日志 `web-frozen-cd274.log`、`build-frozen-cd274.log`。
- 准入回归：`p14-field-access-binding-probe.test.js` 14通过、0失败、0跳过；日志 `admission-frozen-cd274.log`。
- 实际 Host/Chromium：`uat308-reprocess-browser.test.js` 1通过、0失败、0跳过，场景33.22秒；日志 `host-frozen-cd274.log`。

实际 Host 使用独立临时 data/source/shelf、随机 `127.0.0.1` 端口和正常 Admin session。两集 Series 输入通过真实 Observation、Candidate、Libra 与终局生命周期生成 `processing_failed` outcome；未直接写数据库制造状态。配置由正式 API 预置。TMDB、probe、播放检查和 compute 是受控 fixture，来源枚举使用真实枚举器；通过等待该 effect port 制造一个真实仍未结束的 Observation，不拦截浏览器 API。

浏览器从正常页面入口提交，交叉只读数据库与源文件证明：

1. 首次响应409及精确 Owner reason，确认框就地报错、按钮恢复可用，没有“已提交”反馈。
2. 1920×1080、390×844 确认内容与按钮可见，确认框没有横向溢出；Esc 保留外层详情并恢复触发按钮焦点。
3. 409后已有一条持久化意图。取消不改意图，原文件字节、inode、mtime、ctime 均保持。
4. 原占用 Observation 正常结束后，重新打开并提交完全相同 request body，响应202、`replayed=true`、相同 intentId；确认关闭并显示“已提交重新整理”。
5. 再次重放正式接口，得到相同 intentId 和 observationWorkId；意图仅1条，对应 `libra-reprocess:<intentId>` 的 Work 仅1条，原终局记录不变。
6. 两集原始文件全程保持，Shelf Entry 仍为0；foreign_key_check 无结果。重新整理被接收不冒充重新整理完成或上架。

截图在 `browser-frozen-cd274/`：`01-conflict-desktop.png`、`01-conflict-narrow.png`、`02-replayed-narrow.png`，已逐张目检。错误配色、统一按钮、错误原因、取消与接收反馈符合 Playbook §11.1/§12.3；未新增常驻说明或技术标识。

## 失败记录与边界

前序失败日志均保留，不拼接为最终 PASS：v1 为测试变量遮蔽 `process`；v2–v5 的媒体/设备 fixture 未能通过正式生命周期形成失败终局；v6–v7 实际浏览器发现 Esc 关闭两层的问题，后续修复并补真实 `ProcessDialog` 单测；v8 共享工作区合同修改期间 Host readiness 拒绝启动，因此改用冻结副本。`host-frozen-d1c40.log` 中 Esc 已通过，但测试错误地读取了顶层 observationWorkId，正式 receipt 实际在 observation envelope，最终提交修正此 Oracle 并重跑完整路径通过。

本项没有重启或处置本地18081真实媒体任务，没有 NAS 操作、Reset、生产数据写入、真实 Provider/FFmpeg 验收或 Docker/desktop 平台资格声明。后续改变用户表面或 Owner 响应时，应按新版本重验本路径；UAT-308 的现场关闭由主任务按原接受条件记录。
