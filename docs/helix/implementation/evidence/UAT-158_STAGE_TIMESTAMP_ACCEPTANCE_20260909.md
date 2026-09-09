# UAT-158：Stage 时间戳误判验收

2026-09-09，独立验收关闭。已发布运行时 `6bcfd7b33b`，本次只新增测试。

原问题 PROD-015 是 Arca product.stage 采样刚复制的临时文件时，mtime/ctime 变化被错误当作材料身份变化。现行有界 fingerprint 身份门禁为 inode+size；内容仍按 Package 的 bounded fingerprint 对照。读取 NFO 内容快照的 stable-snapshot 合同是另一场景，不因本项改变。

新增隔离真实文件测试执行 prepareSlot → stage → verifyStaged → switchPlacement：先改变 Source 时间戳；实际复制函数写出新临时文件后赋不同时间戳；在真实 computeBoundedMaterialFingerprint 的 onRead 回调中再次触摸临时文件 mtime，并断言该动作确实发生。Stage、独立 staged verification 和最终 Placement 全部完成，最终文件与 Source 字节一致且时间戳不同，临时 Slot 收尾。

负向把 Source 改为相同大小的不同内容：Stage 明确 CLEAN_ARCA_PRODUCT_SOURCE_DRIFT，未生成最终目标，原文件保留。结合原有 inode/size 采样漂移拒绝用例，未放宽真实材料变化。

Windows 定向11 PASS；生产同版 Linux 11 PASS / 68 名称筛选 SKIP / 0 FAIL。Linux 禁网，仅挂载测试，使用实际镜像源码。日志：.codex/uat158-windows.log、uat158-linux.log。测试文件 clean-arca-inventory-port.test.js 与 helix-architecture/bounded-material-fingerprint.test.js。

这是物理 Stage/验证/Placement 流程，不宣称真实视频转码、Event 进程恢复或旧《怦然心动》实例重放；相关正式全 Host 上架与重启证据见[172](UAT-172_AUTHORIZATION_ACCEPTANCE_20260909.md)。旧失败事实未改写，无生产媒体操作，无 API/UI/Desktop 修改。生产身份见[发布证据](UAT_RELEASE_6BCFD7B33B_20260909.md)。
