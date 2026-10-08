# Series Provider Landing多文件与稳定复验

日期：2026-10-08；基线 `a17c2bb92b06101abc924bb1e1deecb54df3de2b`。沿当前Phase外部寻源与SSOT §3.2.6完整实际覆盖合同，只有只读Landing观察，不新增交付/删除授权。

MoviePilot Series输出从同job成功Transfer History的每条明确dest文件构造成员，要求同一TMDB Series/明确Season、实际视频文件、唯一位置和1..32明确Episode Claims。支持E01-E02共文件及E01独立part；不把整季下载记录Claims分配给每个文件，不递归把同目录其他视频算进该job。目录级dest、重复成员、无Claims/重复集、错季、越界和符号链接/junction拒绝。Movie仍保留原单视频路径。

每个成员记录实际字节、SHA256、相对公共整理目录的路径和独立Claims；checksum前后核对文件类型/dev/inode/size/mtime/ctime，避免读到变动文件时产生稳定快照。公共整理目录必须位于配置Landing根内的非空子目录。中文电视剧类型现在正确产生tmdb_series身份；Season只接受明确单季，不取跨季字符串的第一个数字。

稳定性端口重新读取同job成功整理记录和实际文件，再生成完整成员manifest，不能复用原Snapshot的成员Claims。缺成员、字节变化会改变manifest，错Claims/位置拒绝。既有buildStableEvidence合同允许接收满足静默窗口和Episode范围的新快照，并不要求manifest永久等于首个Observation；本批不更改此语义，也不声称缺少仍被其他文件覆盖的part必然被该阶段拒绝。

上游字段依据：[MoviePilot History schemas](https://github.com/jxxghp/MoviePilot/blob/main/app/schemas/history.py)包含Transfer History的dest/type/tmdbid/seasons/episodes/download_hash/status。本批使用这些字段的受控HTTP响应，尚未核验用户实际MoviePilot版本的所有输出形式；不能由fixture通过宣称真实下载服务已端到端验证。

验证使用正式隔离配置/Secret/P5端口及本地真实临时文件：两个视频形成共文件+part Claims，范围外第三个视频保持不被纳入；稳定复验原manifest一致，删除记录及改字节可见；错季、缺Claims、重复Episode/记录、目录dest、根外dest、Windows junction拒绝，源文件和范围外文件保持。仅测试字节，不冒充FFmpeg媒体验证。完整p14 Provider、p5协议和p9外部流水线45项通过/0失败（26.4秒）。日志 `E:/my_project/helix-git-consolidation-20261008/series-provider-landing-regression-v2.log`；P2基线、包边界452文件/1428依赖、语义2070文件及diff检查通过。

尚需真实Provider版本验证、Series搜索逐集空间评估、Coordinator触发/后处理、多值Promotion/Offload/Arca结算及完整外部Host/恢复。未运行全架构、Linux、UI或发布验收，未部署NAS；整体Series可部署Gate继续。
