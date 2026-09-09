# UAT-134：同根精确 Settlement 验收

2026-09-09，按当前 Oracle 独立验收关闭。运行时为已发布 `6bcfd7b33b`；本次只补重新创建端口后的重放测试，无生产文件操作。

当前合同要求仅处置精确、有授权且已验证最终成品的 Source；同根下兄弟影片、其他完整版本和未知文件不属于本次范围，不要求清空父目录。该边界不恢复旧“磁盘必须与 Inventory 全等”的扩大清理规则。当前 [172 正式授权闭环](UAT-172_AUTHORIZATION_ACCEPTANCE_20260909.md) 仍是执行前置条件。

Windows 定向 8 PASS / 0 FAIL；生产同版 Linux 镜像 8 PASS / 0 FAIL / 53 名称筛选 SKIP。Linux 禁网、仅挂载测试，执行镜像内实际实现：

- 同根同步/异步 Settlement 删除精确旧 Source，最终副本正确，兄弟目录和 notes.txt 保留。
- 其他完整版本、未知文件逐字节保留，重复调用正常返回已不存在。
- 待处置 Source 身份改变时明确拒绝，变更文件和未知文件都保留。
- 观察后、删除前授权变化时 Owner callback 拒绝，Source 与 Product 保留。
- 新增同步/异步重放：首次删除后重新创建 inventory port，使用同一冻结命令返回 absent=true、finalVerified=true；兄弟影片、独立版本、未知文件及最终副本字节完全保持。

这是临时目录真实文件副作用与端口重建验证，媒体字节为小型物理夹具，不宣称重新完成视频解码、进程崩溃或全 Host 链；正式 Owner 持久授权、重启与完整上架链另由172证据支撑。无需为目录范围验证制造生产删除。

测试：media-service/test/clean-arca-inventory-port.test.js。日志：.codex/uat134-windows.log、.codex/uat134-linux.log。生产身份引用[发布证据](UAT_RELEASE_6BCFD7B33B_20260909.md)。138的 Thumbs.db 收拢及其他恢复事项不随134关闭。
