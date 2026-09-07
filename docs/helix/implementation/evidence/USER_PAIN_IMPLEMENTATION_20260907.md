# 用户痛点迭代：实现与本地验证

2026-09-07。基线 `16ea06173`，用户已明确授权本任务回写精确 SSOT 调整包并继续实施、测试后部署。

| 用户痛点 | 本轮实现 | 验证与限制 |
| --- | --- | --- |
| Aftercare 不可见 | 原媒体整理表格增加 Case 行与简洁详情，呈现排队、真实目标、进度与终结结果 | 保留 Formation 详情与操作，不创建假 Libra Run；Web 回归 43 项通过 |
| 修改要求引发并发雪崩 | Case 默认全局一个执行席位；queued/active 原子准入、FIFO、重试保留席位、终结后释放；HTTP 修改只唤醒有界扫描 | Case/失效/重启/资源与原有 Aftercare 回归通过；未进行生产批量改 Spec 压测 |
| 整理和收藏响应慢 | Formation 去除重复事实水合，首屏不下载全部历史，更多按需加载、隐藏页面暂停轮询；Collection 按当前 revision 查询，普通分页只计算可见页健康状态 | 搜索与指定收藏架筛选仍可按用户请求读取历史；不宣称尚未测量的生产延迟下降 |
| 旧目录残留 | Arca 持久回收记录与 Foundation Effect Journal；移入应用数据目录的 recycle，默认保留 30 天、每日过期检查，原位恢复不覆盖 | 空目录可自动发现；非空必须核对预览清单确认；256 成员/512 MiB 的单条安全界限；大目录明确拒绝；Top Gun 非空目录尚未实际移入 |
| NFO 来回改写 | 验收/维护要求 NFO 非空、可读且有界；演员/剧情呈现差异不再阻断；外部修改可更新实际 Binding，避免改回内容 | 自有生成仍验证格式；主媒体、身份识别与物理删除守卫保留；人物事实不删除 |

## 本地证据

- Windows service：514 tests，496 pass，18 skip，0 fail。并行占用 CPU 时曾出现 FFmpeg 超时，串行重跑通过，未放宽生产超时。
- 架构全检查：1540 tests，1533 pass，7 skip，0 fail；静态边界与派生合同校验通过。
- 回收站、schema 升级与路由补充回归：24 pass。含跨盘复制中断、半文件继续复制、冲突副本拒绝、恢复目标占用、过期前不删、未知新增文件阻止清理、部分删除恢复。
- Web：13 files / 43 tests 全部通过；Admin 构建通过。
- 生产停止状态下只读下载数据库，940773376 bytes，SHA256 `55ce630b1cc024364b1d0febd990e320b0cd99c1330b917305ca1b010ef39e44`，下载前后与本地一致。
- 升级副本逐表内容摘要比对：原 186 张表只有 `platform_schema_marker` 变化，所有业务表记录和摘要一致，54 个 Shelf Entry 保留。新增回收表后 187 张；integrity_check=ok，foreign_key_check=0。
- 副本 runtime readiness=ready，187 tables / 127 routes / 17 UI surfaces。新 schema digest `74bf523b691e4a92c214e6bcd06f5ed5deba5f7d358898f88cfefbe789af9d9b`。

## 发布与回滚边界

仅使用 build-image / upload-nas-image / deploy-nas 标准流程；构建前提交，镜像 tag 绑定精确 commit。部署前保留全量 data、Compose、secret.env；失败时停止新镜像并恢复匹配的数据库和旧镜像，不用旧镜像读取新 schema。生产监控结论另行补录。`media-desktop` 未改变，本轮未打包桌面客户端。

原始 DB、副本、私有凭据与详细日志保存在 ignored `.codex` / `tests/.env.nas-*`，不进入提交或 Docker context。
