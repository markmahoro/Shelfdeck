# 五项用户痛点的生产结果复验

2026-09-07 15:54–15:58 UTC（北京时间23:54–23:58）。用户要求检查是否真正解决。本轮只读访问生产HTTP、数据库、文件及进程，复核已部署代码；没有改Shelf Spec、重置数据、移动媒体或部署本地补丁。

结论：不能判五项全部解决。此前“已实施/已部署”仅代表交付状态，不代表用户结果验收完成。

| 痛点 | 结果判断 | 本次证据与缺口 |
| --- | --- | --- |
| Aftercare静默、看不见 | 部分达成 | Work API有55个Case的汇总，现有Formation表格接入CareWorkRow与详情。Top Gun确实运行FFmpeg，进度从12%推进至14%，API随后显示14%；霍比特人1仍preparing，无百分比。未观察到本轮Case完成，浏览器停在登录页，未验证登录后的实际交互。不能只凭stage未变化推断停滞。 |
| 改Spec触发雪崩 | 防护实现，生产效果未完整验收 | Store原子queued→active、默认1、FIFO和现有资源Governor保留；生产有2个部署前active Case，当前只观察到1个FFmpeg进程且属于Top Gun Aftercare。没有通过修改生产Spec造负载，也没有取得批量Case排队/终结释放/下一项自动推进的生产闭环证据。 |
| 整理与收藏响应慢 | 部分改善，未解决到可关闭 | 5轮独立API：Formation742–824ms，Collection139–460ms，Care179–600ms。但按页面加载的active/completed/ended/shelves/sync-state加Care并发请求，两轮总耗时3706ms/3238ms，全部200。页面load代码等待前5项Promise.all；这些接口最后完成分别3437ms/3044ms，仍构成明显等待。不是浏览器渲染耗时或P95数据，不能用单接口数字代替整页体验。 |
| Top Gun残留被识别为空电影 | 未解决 | 正式回收站preview返回原目录 `/media/Film/Top Gun - Maverick - IMAX (2022)` 仍有11个文件、4,015,976字节：9张图片、1个torrent、1个Thumbs.db，没有视频。回收站记录0，未执行归档，未验证Emby索引。Preview单次6969ms，也是待优化的交互等待。 |
| NFO反复拉扯/阻塞 | 阻断规则已收缩，存量闭环未完成 | 全部54份当前NFO可读非空；3份大小及内容hash仍与Inventory记录不一致。生产版本Final NFO验证已改readable_nfo，Aftercare不再调用compareMovieNfoPresentation；该函数在src只剩定义。不能由此声明3份Binding已经修复或外部持续改写场景的生产流程已全部完成。 |

## 修正前序监控判断

前序仅看到preparing/preparing_media长期未变，把2个Case笼统称为停滞，证据不足。本轮读取 `/proc` 确认唯一FFmpeg输出属于Top Gun Aftercare workspace，当前Event progress采样于15:57:40 UTC：1,098,055,292/7,814,560,000 microseconds，约14%。15:58 API也显示14%。因此Top Gun正在执行，而非已经证明卡死；霍比特人的等待原因仍需分开核查。

P7_FIELD_ACCESS_EXPIRED和P8_ACCEPTANCE_TERMINAL_CONFLICT仍重复。前者有本地139dab3b8补丁与19项测试，未部署；后者历史6条缺Receipt的范围仍待完整修复。54 Entry/451文件均存在、容器restart=0，只证明当前收藏未出现新的文件缺失。

## 下一步验收顺序

1. 分别验证旧扫描与接纳闭包恢复问题，不把所有等待归因于同一个异常；对Case追踪实际进程、最新采样、等待依据和终结结果。
2. 对整理页整组加载查询继续性能定位，历史、配置及同步状态不应无必要地拖住主要内容；以整页可用时间验收。
3. Top Gun以本次精确11文件manifest完成可恢复归档后，再验证扫描根及Emby空条目消失。当前只完成预览，不声称实际移动。
4. 在隔离环境验证批量Spec变化的Case排队和席位释放；生产观察现有改善完成及后续准入。
5. 验证外部改写NFO→保留可读内容→Binding收敛→继续上架/维护的完整闭环，再关闭NFO项。

原始证据位于忽略目录 `.codex/user-pain-verification.json`、`.codex/page-load-verification.json`、`.codex/production-monitor.jsonl`及本轮只读脚本。未提交生产导出或凭据。
