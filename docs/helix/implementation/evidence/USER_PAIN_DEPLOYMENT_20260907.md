# 用户痛点迭代生产部署与监控

2026-09-07。用户已明确授权精确SSOT调整、实施、本地测试后部署生产并监控。功能已部署，稳定性未关闭。

## 部署身份与保护

- NAS：192.168.12.230:18080，Compose项目/容器shelfdeck，应用根 `/vol1/1000/docker/shelfdeck`。
- 镜像 `markmahoro/shelfdeck:helix-beta-20260907-fd8a8e6f35`；source commit `fd8a8e6f35`。
- Tar SHA256：`e9615b1dc31a9ef51d7afcb9cd9090521988dc39d4f0df056e2c15aa169ddb08`。
- NAS image/config ID：`sha256:92d7a7b6468a4e8f8c66466fe6c6dcbe0cc915560942e6bf2594fd0e6c8cbc8d`。Windows Docker的OCI descriptor ID不同，已通过tar manifest Config验证是同一镜像内容。
- 标准build-image/upload-nas-image/deploy-nas dry-run及apply完成；checksum、health、Admin、QSV、媒体与持久化挂载通过，其他容器保持运行。
- 部署前完整data/compose/secret备份：`/vol1/1000/docker/shelfdeck/backups/user-pain-20260907T145500Z/`。原数据库SHA256 `55ce630b1cc024364b1d0febd990e320b0cd99c1330b917305ca1b010ef39e44`。
- 回滚须停服务并恢复匹配的旧data/compose/secret及镜像 `helix-beta-20260907-5565a03eb2`；不能让旧镜像打开新schema。未执行回滚。
- 新schema `642c62d6d55e95ce31a097435ae7052c26d0ea5b65d049d90c724522db204784`，187表、94显式索引。离线原库副本升级逐表行数和内容哈希验证：原有业务表内容不变，只有schema marker更新及新增空回收站表，integrity/FK通过。

## 验证

本地详细证据见USER_PAIN_IMPLEMENTATION_20260907.md。Service 498 PASS/18 SKIP，Architecture 1534 PASS/7 SKIP，Web 43 PASS和build通过。最后Work Supply窄投影另有29项回归通过；不能称最终commit重新完整跑过上述所有套件。

最终镜像在无媒体挂载、network none的隔离Linux文件系统运行940MB生产副本和后台执行，真实HTTP两轮：health 34–486ms、Admin 250–392ms、Formation 44–379ms、Collection 48–198ms、Care 123–150ms、Recycle 29–125ms，全部200。未将Windows跨文件系统bind mount测量作为NAS延迟结论。

生产15:33–15:37 UTC两轮：health 138–222ms、Admin 363–835ms、Formation 819–838ms、Collection 472–591ms、Care 169–235ms；均200。只代表短时样本，不代表P95或批量规格变更压力测试。

生产独立读回：54 active Shelf Entry，451当前Inventory文件全部存在，容器restart=0。未重复全片解码；文件存在不等于所有内容验收完成。

## 尚未关闭

1. `P8_ACCEPTANCE_TERMINAL_CONFLICT`持续出现。部署前未修改原库有6条accepted Delivery找不到其记录的Libra Receipt；这与PROD-066曾保留的6个被新Reservation覆盖历史闭包数量一致，但不能仅凭数量证明全部对应。已精确证明其中Offer `e7b5526d08d63654e64dd1ef8829718c2a5a90ad6f790b93830ea00b380d08b8`部署前已accepted且无Receipt/accepted Outbox；启动后为同一decision生成新Receipt，与Procurement旧Receipt冲突。不能放宽终态证据保护，也不能归因为本次schema迁移改写业务行。
2. `P7_FIELD_ACCESS_EXPIRED`持续出现。停机前Field Observation恢复路径携带过期Handle，Capability抛出未归类异常；事件 `field-observation-page-commit-event-8be2a884286e87570bf9381b855db2b9f1e99d9f`。需要验证失败收敛和后续扫描连续性，尚未修改该路径或宣称修复。
3. 部署前2个active Aftercare Case仍在preparing/preparing_media。新默认1席位阻止继续新增，但不会倒退已有2个Case为queued；尚未观察到这2个Case终结或新排队Case完整闭环。
4. Top Gun非空残留未物理移动。回收站功能已部署，路径在应用data下，30天保留；未知成员仍需具体manifest确认。未独立验证Emby实际扫描根或索引删除结果。

完整Offer清单、原库/在线对照、监控JSONL、部署日志保存在忽略目录 `.codex/`，不提交生产导出。此轮没有额外直接编辑生产业务数据，没有清除上述错误记录或伪造成功。

下一步继续只读诊断恢复闭包并准备有界修复及本地验证，保留当前54个已Commit收藏。活动包维持监控状态，不能宣称干净基线或生产全面正常。

## 后续监控与本地收尾

15:46 UTC复查6个HTTP入口均200；Formation 946ms、Collection 544ms，Case状态未变化。已创建当前任务heartbeat `shelfdeck`：每5分钟检查，24次/2小时，未变化不重复通知，期末报告并停止监控。已知恢复错误仍然开放。

本轮最后清理仅删除已淘汰的本地升级副本 `.codex/production-copy/upgraded.db` 和 `upgraded-index.db`，合计1,881,546,752字节（约1.75GiB）。删除前核对绝对路径位于该测试目录且不是链接。保留原始取证库、最终升级副本、验证日志、镜像及NAS完整回滚备份。未清理原始媒体或其他任务工作区。
