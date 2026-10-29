# US Adult：Stash Sense 2 NAS 单样本识别验证

工作项：US-ADULT-EXTERNAL-IDENTIFICATION-EVAL。日期：2026-10-28。

2026-10-28容量清理追加：安装数据库7文件和3模型完整SHA及已加载镜像身份复验通过后，NAS已移除镜像load tar和full database ZIP两个运输包；镜像、模型、运行数据库、配置、样本与证据保留，镜像tar本机副本仍在。下文工件摘要为原安装证据，不表示NAS仍保留运输包。实验容器保持停止；未来常驻方案尚未实施。见[清理记录](DEPLOYMENT_RESIDUE_CLEANUP_20261028.md)。

## 结论与授权范围

按用户要求在 NAS 独立部署 Stash Sense 2，使用 ShelfDeck 现有 **US Adult** 演员库 Skin Diamond 的正式参考图片测试。2026-10-28T11:37:34Z 发起一次原生图片识别：HTTP 200、1 张人脸、第一候选 Skin Diamond，与库内标注一致，耗时 **5.218964 秒**。

这是独立服务的单样本通路验证，不是 ShelfDeck 集成、未知演员识别率或自动确认身份的验收。没有实现新的 Actor Choice、Spec 或 People 合同；原 7 条恢复修复、容量清理及其他已暂停事项没有启动，自动观察没有重建。

## 固定部署

- 上游：[AnonTester/stash-sense2](https://github.com/AnonTester/stash-sense2)，版本 `0.48.1`，源码 commit `7a690aa80c390a69d64934c6201076ae05f94e59`，使用原生 CPU 镜像，未修改上游代码。
- NAS：`192.168.12.230`；SSH 使用仓库 `tools/nas-ssh-config.js`，用户 `gezhu`。
- 独立目录 `/vol1/1000/docker/stash-sense2-eval`，Compose project/container `stash-sense2-eval`；唯一挂载 `./data:/data`，UID/GID `1000:1001`。
- 端口仅 NAS loopback：`127.0.0.1:16960 -> 5000`。不是客户端电脑的 localhost，也未开放 LAN 接口。
- 最终限额 CPU 2、内存 4 GiB、禁止额外 swap、PIDs 256、restart `no`、drop ALL capabilities、no-new-privileges、日志轮转。
- `STASH_URL`/`STASH_API_KEY` 为空，不连接 Stash 或 ShelfDeck 数据库，不配置 ShelfDeck 写入凭据。图片仅发给 NAS 自建服务；GitHub 下载使用已有代理，未更改 Docker daemon/global proxy。
- 成功验证时容器 `479ce00d53ac4960937b7e46a7062eb6723ffafb2415527be1b2fa4a8b1af381`，Restart 0、OOM false，真实 `/health` 为 healthy 且 `database_loaded=true`。
- **验证后主动停止此独立测试容器释放内存；部署、模型和数据库保留。** 未停止或重启 ShelfDeck。后续启动仍使用上述独立 Compose，不需要重新下载。
- 停止后状态 exited/Restart 0/OOM false，NAS MemAvailable 回到 4,441,536 KiB；ShelfDeck health 仍 ok/normalSupplyAllowed true。

| 工件 | 固定身份 |
| --- | --- |
| 镜像 tag | `ghcr.io/anontester/stash-sense2:0.48.1` |
| OCI index digest | `sha256:7dbcfa0332dc3206d5c0ffe983f9495e14475806c7d235177cca0e576b5ae572` |
| linux/amd64 manifest | `sha256:9dd764dd54fa0d9ac9b17b4cfee2939be1a4a3ce15c9df46015e2f374386dd68` |
| 实际 Docker image ID | `sha256:42f90b994c4bf47004b8cd83b62d0c4697753aeefbc3134afa5309b1506afed0` |
| Docker load tar | 1,707,735,040 bytes；SHA256 `a971427f449673acb49907a03530cb1207e5688fa1d3ff4d582ed0b1ff87916c` |
| 最终 Compose SHA256 | `e7421ff105c64adb08ac23970ab389049be897af89e92cf6836a511ca4b90368` |

## 数据库与模型

固定官方 full database **2026.10.09**，没有应用 latest 2026.10.20 delta。最低 sidecar 0.47.3，当前 0.48.1 满足要求。发布 ZIP 中 8 个文件安全解压，7 个 manifest 数据文件 checksum 全部通过；SQLite `integrity_check=ok`。没有将样本或演员姓名预灌入识别库。

| 工件 | 字节数 | SHA256 |
| --- | ---: | --- |
| full database ZIP | 1,484,197,621 | `d1b8600835c04b4bbbf791b735372358c59bbd1ff18b2e2b50e85091de124491` |
| CR-FIQA(S) quality | 174,407,204 | `1620db9d4b03113328e34979a97efbb1f1397b86b6b013b3d6142768cfb997d7` |
| buffalo_l detection | 16,923,827 | `5838f7fe053675b1c7a08b633df49e7af5495cee0493c7dcf6697200b85b5b91` |
| buffalo_l recognition | 174,383,860 | `4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43` |

数据解压 2,715,402,822 bytes；manifest 声明 440,725 performers / 1,076,145 faces，服务实际加载 440,725 performers / 1,076,150 index entries。上游两处统计相差 5，保留原始值，未修改数据库或将其描述为一致；本轮没有审计整个人脸数据集的内容质量。已弃用 gender/age 模型没有下载。

## 样本与真实返回

样本通过 ShelfDeck 只读 People API 获取：

- Person `person-2ff9f46812a460e866c5c63e28d232b9a85d11f1`，`libraryKind=us_adult`，canonicalName `Skin Diamond`。
- Person revision 1、Reference revision 1、Reference projection revision 2。
- Projection digest `6d83ae499be66687a8eb5736fc4e9222cc492013c082487faa21d8498fada23c`。
- JPEG 441,131 bytes；SHA256 `eb9959967b507a4c20728f3b546aa4ea056ecca2028555f23aec6173d1b861c1`。
- `POST /identify` 只传 `image_base64`、`top_k=5`、`max_distance=0.6`、`min_face_confidence=0.5`，未传姓名、Person ID 或其他期望答案。
- 请求 SHA256 `b3d1ccce609241d6d3ad0a2ef41d2160b5b9dde53957e83f5735e6349dd3613e`；响应 SHA256 `900464ec4ac075a7108bef218442051e9dbda7c28efc2a95449497a66cb80c53`。

人脸检测 confidence `0.8420831561`，box `(591,132,296,416)`。阈值内返回两项：

| 排名 | 返回姓名 | API confidence | distance |
| --- | --- | ---: | ---: |
| 1 | Skin Diamond | 0.6974130273 | 0.3025869727 |
| 2 | Corinne Harrison | 0.4228259921 | 0.5771740079 |

第一项 `universal_id=stashdb.org:4b116d7d-58c1-46a1-b880-6fdfe4fbe502`，matched embedding index `754261`。API confidence 是上游距离转换后的匹配分数，不是统计正确概率或整体准确率。没有为获得命中调低阈值、换图或重建识别库。

## 失败、资源及保护核验

1. NAS 首次直拉镜像 300 秒超时，保留日志。之后通过已有代理下载官方 OCI blobs，逐项校验压缩 digest 和解压 diff_id，封装 load tar 并在 NAS 再校验后加载；未换用不明镜像。
2. 首次数据库准备脚本的 SQLite 只读连接生成 WAL/SHM，已完成内容校验和搬入新应用 data 后，空目录清理失败。改用 `mode=ro&immutable=1` 重新检查全部 checksum 和 integrity，通过后才启动服务。两个 0/32,768-byte 临时文件保留在该应用 bootstrap 目录，原失败日志未抹去。
3. 初始 3 GiB 限额不足，Docker events 明确记录 `oom` 和 exit 137，共三次自动重启。停止独立容器并禁用自动重启后，将限额改为 4 GiB；没有修改生产服务资源配置。最终模型/索引加载 25.98 秒，测试后 cgroup memory.current 3,546,800,128 bytes，扣 inactive_file 为 3,522,236,416 bytes，约 3.28 GiB；新容器无 OOM/重启。
4. 成功样本时 NAS 可用内存约 1.1 GiB，swap 空余很少。为避免实验长期占用生产 NAS 内存，测试和证据采集结束后停止独立容器；这不是持续负载或常驻部署资格结论。
5. 11:38:14Z 对 Person 完整响应逐字段比较保持一致，参考 JPEG SHA256 不变。ShelfDeck 原容器 ID、image、StartedAt 保持，Restart 0/OOM false，health ok/normalSupplyAllowed true；没有执行 ShelfDeck deploy、Reset、任务 retry/cancel、演员事实回写或媒体操作。其他既有容器运行状态未见变化，flight-tracker 的 unhealthy 为前置已存在状态。
6. `/vol1` 成功测试后可用 69,755,932,672 bytes；所有下载、模型、数据库和证据位于独立应用目录及 Docker 正常 image storage，没有清理其他应用或旧备份。

原始证据保存在 NAS `/vol1/1000/docker/stash-sense2-eval/evidence/`；本机忽略目录 `E:/my_project/emby_third_party-helix/.codex/stash-sense2-eval-20261028/` 保存下载、首次失败、重验、部署、响应及保护记录。图片/base64、数据库、镜像包和运行 JSON 不加入仓库。

手动再次启动或停止仅操作此项目：

```sh
cd /vol1/1000/docker/stash-sense2-eval
docker compose -p stash-sense2-eval -f compose.yaml up -d --no-build --pull never
# After evaluation, release the experimental service's memory:
docker compose -p stash-sense2-eval -f compose.yaml stop --timeout 10
```

没有进行视频抽帧、多角度/模糊脸/多人/库外演员、误识别率或持续并发验证。单张公共参考图可能与上游参考集重叠，不能把本次成功外推为任意影片演员都可识别。

## 内存驻留机制（用户追加询问）

已核对固定版本 `api/main.py`、`settings.py`、`resource_manager.py` 和 `identification_router.py`：启动时后台加载模型和索引；`idle_unload_minutes` 默认 60，0 表示禁用卸载，后台每 60 秒检查空闲并清除识别资源引用、执行 GC；下一次识别请求自动加载并等待。服务进程及基础框架仍驻留，因此不能把“卸载模型”理解成零内存。本次没有等待空闲卸载或量测卸载后的 RSS，也没有修改该设置；实测约 26 秒是一次启动加载耗时，5.219 秒是加载完成后的单次图片请求，未独立验证空闲后的整次冷请求延迟。

当前 Compose 探针要求 `database_loaded=true`。以后若改为持续运行并启用空闲卸载，需先区分进程存活与模型就绪，避免正常空闲卸载被持续标为 unhealthy；不能仅凭 Docker health 或 HTTP 200 判断可直接识别。当前容器停止，不产生循环重启。短空闲卸载/按需启动是后续集成选项，尚未设计或实施 ShelfDeck 调度。
