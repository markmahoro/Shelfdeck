# Series Linux Docker 验证（2026-10-08）

归属CURRENT_PHASE节点1–5。受测源码提交`372768b681fa769e70b381b50e2a42e78839fa3d`，Windows主工作区当时干净且与origin/main一致。本批仅记录验证，不修改运行代码。

## 环境与镜像

本机Docker Desktop Engine已恢复，先前Inference socket阻塞不再存在。本批没有重置Docker或操作NAS。Docker Desktop4.71.0、Engine29.4.1，Linux/amd64，镜像内Node20.20.2。

使用仓库原始Dockerfile本地构建：

```powershell
docker build -f media-service/Dockerfile -t shelfdeck-series-test:372768b68 .
```

镜像ID（docker image inspect）：`sha256:6dc883f1dbb2189b299675f7d674b4a8a72198a1166eb9cfdfb8764e6c43604b`。这是本地测试镜像，不是发布tag、已上传包或生产部署身份。

所有容器使用`--rm`，未映射NAS、生产目录或宿主服务端口。只挂载仓库test目录为`/app/test:ro`；需要测试专用代码时另挂载scripts与web/src只读。服务运行源码与原生node_modules始终来自构建镜像，临时媒体/SQLite位于容器内部。结束后确认任务容器已退出。

## 结果

| 范围 | 结果与边界 |
| --- | --- |
| 原始Dockerfile及Admin Web构建 | 通过，未复用Windows原生模块 |
| Series专项32文件 | 438通过，0失败/skip，28.25秒；选择`helix-architecture/series-*.test.js`但排除routing-run和单独运行的offdeck-process-recovery |
| 显式Series anchor E03追加Host | 1通过，约93.5秒；Node20另外27项因名称筛选skip，不计业务通过。正式HTTP Formation只显示E03，Collection累计三集，旧文件/历史断言保持 |
| 真实N:M Remux/Transcode Host | 1通过，42.22秒；CPU software_cpu转码+Remux、两集共文件及part映射、逐集验收到Arca上架；其余29项名称筛选skip。短1080p SDR，不代表长片/HDR/硬件编码 |
| Series Off-deck进程恢复Host | 1通过，99.70秒；实际删除、注入EPERM、终态提交前退出73、新Host恢复与第三次启动结果一致，范围外sentinel不变 |
| Movie外部获取回归 | 4通过，0失败/skip，120.34秒：实测不合格拒绝、Transcode、Remux、native4k上架。Provider网络受控，不是实网MoviePilot下载 |
| 原生文件/SQLite/Formation/Collection专项8文件 | 初跑163通过，2测试环境失败；缺少测试专用build-helix-movie-test-library脚本与Formation TSX源码，不是镜像运行时依赖。补只读scripts/web/src挂载后受影响2文件45通过、1既有live BDMV素材缺失skip。已通过的其他文件不重复计数 |

主要命令在相同只读test挂载下执行：

```text
node --test --test-name-pattern="^Isolated Host schedules 2 Episodes through metadata and Direct On-deck Commit and appends E03 from an explicit Series anchor$" test/helix-architecture/series-routing-run.test.js
HELIX_SERIES_REAL_MEDIA=1 node --test --test-name-pattern="with real N:M Remux Transcode$" test/helix-architecture/series-routing-run.test.js
HELIX_SERIES_OFFDECK_RESTART=1 node --test test/helix-architecture/series-offdeck-process-recovery.test.js
node --test test/helix-libra-external-handoff-b-e2e.test.js
```

专项8文件为`clean-arca-inventory-port`、`clean-media-production-effect-port`、`formation-process-projection`、`helix-formation-projection`、`helix-collection-query`以及architecture下`series-episode-space`、`series-offload-schema-upgrade`、`series-settlement-completion`。

仓库外日志：`E:/my_project/helix-git-consolidation-20261008/series-linux-{build,contracts,append-host,real-media,recovery,movie-regression,units,recheck}.log`。contracts日志首行保存完整32文件清单。

## 未关闭门槛

本批解除Linux测试环境阻塞，并提供上述场景的Linux证据；不是全部Phase/Linux矩阵通过。仍需完整Series外部替换/后加工（用户暂缓EpisodeDelivery多part摘要合同）、UI负责人具体版本验收、长片/HDR/跨设备与剩余故障矩阵、生产副本升级回退、最终全量Movie回归。没有改变首次Series范围或宣称可部署，不操作NAS生产。
