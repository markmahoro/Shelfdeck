# JAV 首次入藏长标题候选：本地验证与中断发现

日期：2026-10-29。状态：**未通过发布门禁；继续修复中断恢复**。

## 对象与范围

- 代码提交 `619ffc464b710310e46cef8dd38cba792b127a68`，基于 `2a58c16061295ebd0e8c6c35f579a686d9677b80`；被验证的固定 tree 为 `6d11158f3a14193190a7bd7901e08737ee777359`。
- 依赖主整合分支现有的长标题 SSOT 及机器映射（来源提交 `3e707a033`）；此代码提交不包含该合同。
- 仅涉及未冻结 Decision 的首次 JAV single On-deck：完整 typed 番号、原 Metadata、真实扩展名及共用 Primary/NFO stem；不改 Movie、Series、Correction 或 Aftercare 的命名合同。
- 所有实验使用隔离本机目录、合成源和 Linux 容器。没有操作生产数据。按用户要求本轮未跑真实 CIFS；这不是通过 CIFS 资格的证据。

## 固定 tree 的正向与冲突证据

容器镜像 `shelfdeck-series-gate:bc4f5c952` 的 image ID 为 `sha256:74da21e78cdc90ef5b0ba5e1b2577f56203a30970a9f1a5a993857d75b23c921`，固定 tree 只读挂载，`unicode-segmenter@0.17.3` 由独立依赖目录提供。

| 验证 | 结果 | 原始日志 SHA256 |
| --- | --- | --- |
| Linux 定向：长标题规则、Stage/Placement、Formation、Correction 和 Series Aftercare | 132 通过，0 失败、0 跳过 | `823330b440dc415fa6e2e2b947bd4a90d58e668d616ed2f3c7b0da06a5d4280b` |
| Linux 实际 Host：完整 JAV 长标题；外来目标冲突后由用户处理并重新检查 | 2 通过，75 因名称过滤跳过；两个场景各取得唯一 On-deck Commit | `b7a2489f0ed4ee9b8f523373fc432fed71909ddad788b481e7a7aa971b7f6b5a` |
| Windows Node v25.9.0：固定 Unicode 分段 | 10 通过 | `25a1b4198230a98db8b4171e6c467ecd8b64520537748ec97811aab59623e628` |
| Windows Node：短路径真实 Stage/Placement | 10 通过、1 跳过；目录 symlink 创建需额外 Windows 权限 | `870c13917c4bf8f76b87423a7d7356374cd30ca3e636b0795577b7acd75a8a0d` |
| Web 定向 Vitest | 6 通过 | `26a3e407e944a0e0c4ad4da99338ee075794e1950e5a0eb582fd4e913a93936b` |
| Web build 后 Vite preview，Playwright 宽/窄屏与键盘 | 2 通过 | `242113deb7a1ff8b71e3dc8a5ff6f3bdb00039ca2fdec0d96762412a96225446` |
| Helix 语义检查 | 通过、0 findings | `16ca600cdf2e5f5af7362c41dbd5fdf39a4fb077afac7d0a9b6835fbb86034ea` |

Host 的长标题场景使用真实 FFmpeg、Host、SQLite、Provider fixture、Libra、Arca 和文件系统，确认完整番号、固定 Decision、Primary/NFO 同 stem、事实中保留完整标题和唯一提交。目标冲突场景先确认外来哨兵文件 inode/字节未变、0 Commit，再由测试扮演用户移除该隔离哨兵并通过真实 Admin API 重新检查，最终唯一 Commit；这不是生产恢复验收。

固定 tree 的包边界检查报两处已有 Perception planning → application/persistence 越界，日志 SHA256 `28d2b90e76714981c5c39019e123e6810c8ee916ee192a0827eafcb283e4c0df`。把主线程提交 `f253017d2` 的四个 Perception 文件叠加到单独的只读验证副本后，包边界检查为 0 findings，日志 SHA256 `b8bba4ea76917d7265a4c0ad9d89bff2d1022f43ebe77721d4eedf1ea5e08a1d`；该叠加不是最终整合树，不能代替整合门禁。初次检查还发现本补丁直接从 domain model 导入外部依赖，已通过由 service 根部注入固定分段器修正；上述固定 tree 不再有该 finding。

Web 默认 E2E 服务第一次因本机 Windows 未安装 `better-sqlite3` 未启动，未执行测试；使用已有 `jav-playwright.config.ts` 的 Vite preview 后，上述两条浏览器交互通过。集成版本仍需用户指定的 UI owner 审核，截图和组件测试不是该审核的替代。

## 实际进程中断：三处未闭合

注入脚本在固定 tree 的真实 Host 中分别于指定回执提交前 `process.exit(79)`；Node 测试进程的失败为刻意注入。随后在同一隔离容器、同一数据库及文件系统重启 Host，观察约 20 秒，逐文件比较路径、inode、大小和 SHA256。结果均为 **0 On-deck Commit**；观察窗口内文件均保留且物理身份和字节未变，不代表最终恢复成功。

| 中断时点 | 重启后的事实 | 重启日志 SHA256 |
| --- | --- | --- |
| Stage 物理写完、Stage 接口返回后、回执提交前 | 4 个 Stage 文件不变；Stage Event executing、Effect intended；运行时报告 `CLEAN_ARCA_SHORT_STAGE_UNCERTAIN` | `90df303db64bd6b7302ad53f2a6b9deaa7175591cc9a2fee80f10584539d14f8` |
| Stage 已提交、Verify 执行前 | 4 个 Stage 文件不变；Verify 记录 `stage_precondition` 失败，但出现后继 Stage executing / Effect reconcile_required，运行时重复报告不确定错误 | `cebaaf795a270ed0eecd6872e35592921dac932619938b53d50a3bf12b226ea9` |
| Placement 文件写完、回执提交前 | 4 个最终文件不变；Placement Event executing、Effect intended，提示 Stage slot 已不存在 | `00a553e34dcfe8938759e3996aa5ad3388fe9376e28a5a6b96aac60fa04653a3` |

此版本用进程内文件描述符证明 Stage 连续性，最多持有一小时；重启、租约到期和部分 Placement 发生后无法自动恢复原责任。20 秒观察不能证明后续一定终止，也不能证明安全可用的用户恢复入口。按当前合同须继续在原 Owner 内闭合并复验，主线程已被告知将它视为发布阻断。

## 其余限制与日志

- 固定版本不是最终集成版本，尚未跑最终完整发布门禁、生产验收或 UI owner 审核；小文件 fixture 不证明大视频复制吞吐。真实 Endpoint 的更小组件限制、大小写/Unicode 等价及并发路径竞争未取得完整资格。
- 早期定向首跑 99 通过/2 失败，均为 fixture 缺少 `packageDigest` 等输入导致 `P3_JCS_NON_JSON_VALUE`；修正 fixture 后重测。另一轮 128 通过/1 失败是测试断言在进程内租约释放后的错误码，修正为实际的 `CLEAN_ARCA_SHORT_STAGE_UNCERTAIN` 后重测。它们不是最终固定树的通过结果。
- 原始日志、隔离脚本和浏览器截图暂存本地工作树的 `.codex/` 忽略目录，不在代码提交中；上表给出摘要以关联精确记录。该目录不是长期证据仓库，归档或删除工作树前应保留。
