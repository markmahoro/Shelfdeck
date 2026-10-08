# Series 20分钟真实编码Host验证

日期：2026-10-08；基线`06a8ce7c04f18f22ab30a2433283cf2be2a10392`，当前Phase真实媒体/平台验证。

## 方法与范围

显式`HELIX_SERIES_LONG_MEDIA=1`用于既有真实N:M生产Host：3秒1080p视频加AAC 48 kHz音轨，以stream copy循环为1200秒真实可解码文件。覆盖E01/E02的HEVC MP4共文件执行Remux，E01另一个H.264 MKV part执行正式设备选择后的HEVC Encode（Linux software_cpu、Windows nvidia_nvenc）。延长文件只是测试素材准备，产品仍实际编码全文件，不跳过生产、播放抽样、完整Result/Claims、Handoff或正式Arca上架/源结算。

此显式专项的外层test预算900秒、Host等待800秒；正常默认测试和产品运行时超时不变。禁止把该开关用于bounded Aftercare素材，保持原20秒空间压缩验收Oracle。Source Probe要求实际时长距1200秒小于500ms且一个AAC音轨；最终每个实际Inventory文件由FFprobe检查相同时长容差、单AAC 48 kHz音轨，并保留原N:M映射/24样本Assessment/成品codec等断言。

## 已取得证据

Linux Node20本地镜像`372768b68`挂载当前测试，目标Host1通过/29名称过滤skip，181.85秒。两份Inventory成品分别1200.042秒和1200.201秒，均AAC音轨，覆盖E001与E001/E002，实际Remux和CPU encode成功。容器自动删除。

Windows同一路径1项通过/0skip，183.57秒。正式设备选择为nvidia_nvenc；两成品分别1200.18秒和1200.034秒，AAC 48 kHz及Claims断言通过。日志位于仓库外`E:/my_project/helix-git-consolidation-20261008/series-long-host.log`与`series-long-host-windows.log`。

复验：设置`HELIX_SERIES_REAL_MEDIA=1`、`HELIX_SERIES_LONG_MEDIA=1`，运行`node --test --test-name-pattern="with real N:M Remux Transcode$" media-service/test/helix-architecture/series-routing-run.test.js`。

## 未覆盖

循环黑色合成内容不是复杂画面，以上不证明真实长剧集的主观质量、连续运动/字幕同步、音频逐packet无损、HDR长片或多音轨策略。仅对时长、音轨存在/格式及真实正式生产链提供证据，不关闭全部技术资格或Series发布门槛。没有NAS或生产数据操作；UI源码保持已接受版本。
