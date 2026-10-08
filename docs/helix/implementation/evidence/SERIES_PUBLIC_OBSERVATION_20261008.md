# Series正式Admin观察入口

日期：2026-10-08；基线 `60ea2e0affa33c022441585f50fbe03b3d8f6cc9`。当前Phase来源入口及发布回归工作项。

## 实现和授权依据

用户已授权Series开发；UI负责人2026-10-08只读设计衔接明确指出后台观察入口拒绝非电影是正式来源入口阻塞（任务 `01a0912a-0086-74e2-88ab-536c59d3862a`，turn `01a117bd-5062-76a1-b73d-70e5b2986e77`）。本批沿该设计接通现有 `POST /v1/admin/material-fields/:fieldId/actions/observe` 的movie/series准入，保持同一Procurement命令、Field快照、revision和幂等协议；jav/western_adult/mixed仍明确拒绝。不增加新Owner、命令或自动观察副作用。

不支持类型的错误码保持 `ADMIN_MEDIA_PROFILE_UNSUPPORTED`，展示文字改为简短的“暂不支持该媒体类型。”，去掉已过时的Milestone/Movie限定。前端类型选择、浏览器/键盘/窄屏走查及UI负责人对最终版本接受仍未完成，本批没有UI PASS，不关闭涉及用户表面的节点。

## 实测

- 变更前，普通Series Host切换到正式HTTP入口，立即收到 `ADMIN_MEDIA_PROFILE_UNSUPPORTED`，复现了真实入口阻塞。
- 修复后，两集Direct/Remux完整上架经正式HTTP入口通过37.1秒。
- E01/E02首次观察及E03追加均经正式HTTP入口，94.1秒通过：同Season Entry扩充、旧Inventory/Fact及原批次保护使用既有完整断言。两个来源并发非重叠E03也经公开入口实测通过93.6秒，保持唯一Season Entry及两次Commit/独立冻结Run。
- 9项真实SQLite Admin专项通过：Movie/Series恰创建一个Work、同幂等重放同一Work、过期Access revision明确冲突且不新增Work；其他三个Profile零Work且不唤醒Runtime。初次测试误断言通用拒绝码，按正式 `ADMIN_FIELD_CONFLICT/FIELD_OBSERVATION_ADMIN_FENCE_CONFLICT` 修正Oracle，产品行为未放宽。
- 新diff的P2、架构458文件/1450依赖、语义2077文件及diff检查通过。

本批同时核对当前容量合同：SSOT §8.6.18明确限制seriesSpaceBasis为32个物理成员和64 KiB Candidate输入；不是可以直接调大代码的笔误。1024上游容量不能证明整个生产链同样支持1024；未改变合同，也不把24集通过外推到长Season。

本轮先对基线启动完整架构回归，再实施本入口增量；基线结果单独记录，不冒充最终diff的全量。基线Admin Web发布构建成功（123模块）；原生Probe/FFmpeg/Arca文件端口128项中126通过、2既有skip（Windows FFprobe崩溃测试、缺少真实BDMV STREAM），不能视为这两项已验证。生成dist未入Git。

日志在 `E:/my_project/helix-git-consolidation-20261008/`：`series-public-observe-before.log`、`series-public-observe-after.log`、`series-public-observe-append.log`、`series-public-observe-unit.log`、`series-public-observe-unit-v2.log`、`series-public-observe-p2.log`、`series-web-build-60ea2e0af.log`、`series-native-runtime-60ea2e0af.log`、`series-full-architecture-60ea2e0af.log`。

未操作NAS；EpisodeDelivery合同缺口、完整外部获取/后加工、恢复矩阵、UI/Linux/升级回退等发布Gate继续。

## 基线全量回归发现及复验

完整架构基线277文件：2,401项，2,384通过、7失败、10既有skip；包边界/语义/manifest/P2全部通过。7个失败均已定位到前面已确认的Offload扩展未更新的测试数据/固定断言：

- P2 aggregate固定值更新为正式validator重建的 `dbd056a337f651680a1edc15d0ccc3c15e3ceb601b09f06c609c0a7af474f768`；原有两次重建一致及跨库存完整检查保留。
- Libra application类型39（新增已确认LibraOffloadProductMaterialKeys），表JSON列69（新增多目标列）；逐项生成物/注册表/摘要校验保留。
- 历史witness的“当前合同已不同”清单加入Final Product Verification及两个Settlement消费者；原witness文件和固定摘要未改，不允许旧witness为新Series合同授权。
- 通用事务fixture仍走单目标variant，将新多目标JSON/schemaRef设为NULL；之前通用生成器同时填了两种variant，被正式互斥CHECK提前拒绝，未真正跑到故障注入点。修复fixture后继续验证参与者前后/COMMIT前回滚、stale Material Control CAS零写入及post-COMMIT完整Fact Set，不弱化DDL或测试断言。

5个受影响文件共231项复验全部通过（50.4秒），日志 `series-full-regression-repair.log`；原全量失败记录保留。最终增量另有9项Admin专项及三项正式HTTP Host通过；未声称修复后重新跑过整个277文件命令。当前代码尚有后续UI/外部功能工作，最终发布冻结SHA须重新完成适用全量验收。
