# UAT-141 / UAT-230 发布与逐项关闭

2026-09-09 03:06，source `3489ea0ccf`。

- Image：`markmahoro/shelfdeck:helix-beta-20260909-3489ea0ccf`
- NAS config Image ID：`sha256:95a4f20253de4cffd612a25c869f1fc9203b06e3119034323c413893cda4f9c6`
- Build manifest-list digest：`sha256:2bd116bce98f42f92806aa2ac1526c2dd7b97bdbed9be92971e9cf37f6a1484e`
- Tar SHA256：`d5f639ff02e940d6aa060ad0eaea5da879bde213096e49ce8de663452b1d6f37`
- StartedAt：`2026-09-08T19:04:26.98822919Z`
- 一致备份：`/vol1/1000/docker/shelfdeck/backups/uat-iteration-20260909-3489ea0ccf-predeploy`，DB SHA256 `594d677ea65146932b4d1c44a82438871d5a26362d2a09a50758a305d22e1fc3`；下载校验一致，Compose/Secret/Admin凭据和3份加密Integration envelope保留，841cbcf0c7镜像及对应备份可回滚。本次无Schema变化。
- clean release worktree构建、标准upload/checksum/dry-run/readiness/apply与原挂载验证通过；发布前60GiB可用，没有扩大清理。
- Windows Query5/Web5、真实Clean Host HTTP、Web build通过；Linux实际发布镜像Query5通过。无desktop代码变化，不重复其打包。
- 03:05六路生产GET200，71收藏、1整理中/1待处理、44维护完成/11历史结束、4回收站条目，与03:01发布前一致。生产正常继续形成新收藏，未改写其业务结果。日志仍有既有P4_EVENT_RECOVERY_INPUT_DRIFT，两条可见，继续归125/250而非忽略。

## 逐项结果

141：Edge生产新概览真实显示状态行、薄指标、两列工作面（各648px同y），左列整理片名素媛(2013)在最近进展满载时保留，右列仍有最近上架结果。点击整理需要处理进入媒体整理工作区。隔离空闲/未配置/故障和当前片名满历史场景均通过，关闭。

230：Host状态改读已有Execution Runtime readiness；侧栏和概览读取失败时不保留旧正常状态。隔离真实HTTP正常→503→faulted→unconfigured及刷新恢复通过，生产真实新资产正常状态通过。未在生产制造故障；故障/错误场景与生产字节一致资产在隔离环境完成，关闭。

生产JS `index-CoNYbSDo.js` 430705 bytes，SHA256 `a071170cc3f6b6cafd382babbd43eecd0d4fdea6de2c50e987440faf0ad2ce70`；CSS `index-B1aY6lyV.css` 53529 bytes，SHA256 `c417f1815bf87538df3965e573cf717628a015602911823818d9eba7ca37bbb9`，与隔离验证资产完全一致。

本轮累计31关闭，68开放及206取代结果核实继续执行。245仍因全量查询未关闭，不把本次响应快冒充其Oracle满足。

原始记录`.codex/uat-release-3489ea0ccf-{build,upload,preflight,backup,dry-run,apply}.log`、`uat141-linux-query.log`、`uat141-asset-parity.json`、`uat141-browser-requests.json`、`uat230-host-http.log`。实施及失败路径见[141/230验收](UAT-141_230_OVERVIEW_ACCEPTANCE_20260909.md)。
