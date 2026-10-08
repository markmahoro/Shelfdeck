# Series PQ/BT.2020 真实媒体Host验证

日期：2026-10-08；基线`d0ac42fcf0d846d9f3f772699e3fb93dfbfd6986`，当前Phase跨平台真实媒体验证工作项。

## 范围

既有Series隔离Host添加显式`HELIX_SERIES_HDR_MEDIA=1`测试选项，正常默认测试不变。对真实媒体fixture产生3秒1080p 10-bit PQ/BT.2020：HEVC MP4覆盖E01/E02共文件，H.264 MKV是E01另一个part。正常正式观察、身份/资料、全Run验收、Remux/CPU Transcode、Handoff与Arca上架/源结算继续沿原测试断言。

生成后先以独立FFprobe确认源为yuv420p10le、PQ、BT.2020，再启动Host。正式Source Probe必须认作hdr10_compatible/10-bit/PQ。最终Inventory每个实际文件独立FFprobe检查HEVC、yuv420p10le、limited range、BT.2020 primaries/matrix、SMPTE2084 transfer；诊断同时输出该物理文件覆盖的Episode keys。没有从文件名推断HDR，没有更改业务准入或运行时代码。

## 结果

- Linux：原本地测试镜像`shelfdeck-series-test:372768b68`、Node20，只读挂载当前test目录；1个目标Host通过/29个名称过滤skip，42.23秒。实际Remux及software_cpu encode，24样本Assessment通过。E001/E002共文件及E001 part两成品颜色/位深断言通过。
- Windows：当前本地Runtime，1个目标Host通过/0skip，44.08秒，同样确认全部实际成品与Claims。
- 初次Linux测试失败保留：FFmpeg仅设置输出色彩参数时，合成源缺失PQ/BT.2020字段，正式Probe因此正确返回unknown；并非业务HDR分类错误。改为生成帧使用setparams色彩属性，加启动前源探测断言，并使用正式Probe归一化后的pq值，复验通过。未弱化最终FFprobe断言。
- 日志在仓库外`E:/my_project/helix-git-consolidation-20261008/`：初次`series-hdr-host.log`、成功`series-hdr-host-frame.log`和`series-hdr-host-windows.log`。临时容器自动删除，未触及NAS。

复验入口：设置`HELIX_SERIES_REAL_MEDIA=1`与`HELIX_SERIES_HDR_MEDIA=1`，运行`node --test --test-name-pattern="with real N:M Remux Transcode$" media-service/test/helix-architecture/series-routing-run.test.js`；容器中路径为`test/helix-architecture/series-routing-run.test.js`。

## 限制与后续

短黑色合成PQ流仅证明位深/色彩信令和正式生产链，不证明真实长剧集画质、复杂HDR10静态元数据、HLG或Dolby Vision。无音轨素材不覆盖HDR音画同步或音轨保留。没有每集空间上限，不冒充bounded compression证据。完整外部链路仍受用户暂缓的EpisodeDelivery摘要合同影响；最终全量、升级/回退和其余恢复/用户旅程门槛保持开放，不声明Series可部署。
