# UAT-141 / UAT-230 概览逐项验收

2026-09-09 03:01。本地修正已通过，发布与关闭尚待完成。

## UAT-141

生产841cbcf0c7实际截图显示：状态词与默认收起的后台检查在一行，薄指标、左右工作面同高且各648px，两列横坐标732/1404。正常状态不占大绿色块、无标题导语；待办指向媒体整理/人物。但真实正在整理计数1而片名为空：Query先放5条完成和5条近期，再添加进行中，最后slice(0,8)把进行中全部挤掉。

修正仍保持ledger最多8条，优先保留最多5个当前整理标题，再填最近进展；UI继续将两类分别显示在左右栏，没有新增统计或业务事实。新增满历史回归证明当前片名不会被截断；真实Query驱动的18203浏览器有1部正在整理+10条历史输入，左栏片名和右栏7条历史同时可见。空待办一行、空进展一行；未配置待办实际点击到文件来源。

## UAT-230

RailStatus和Overview共用实际overview Query，但原来忽略refetch error，因此cached正常可以在503后仍显示。现在读取失败显示状态读取失败，概览保留明确接口错误与刷新提示；恢复后依据最新响应显示，不把网络故障冒充业务故障。Host的Overview readHealth原为固定ready，改为读取已有Execution Runtime Host的readiness.state，没有修改或推测Domain失败为整机故障。

18203浏览器真实刷新完成正常→503→faulted→unconfigured，侧栏和概览一致，503后没有正常运行词；刷新成功清除错误。Query测试的故障/未配置/目录不可用口径保持。

## 验证与边界

- Service Overview Query 5 PASS；Web Overview 5 PASS（包含缓存正常→错误→恢复faulted）；TypeScript/build PASS。
- 实际Clean Host HTTP 6.09秒PASS，含真实鉴权、三态概览/零收藏、后台状态和退出清理；没有在生产注入运行故障。faulted映射由真实Query加隔离HTTP响应验证，未声称强制破坏真实Runtime来制造故障。
- 顺便更新该Web文件中旧Offdeck首屏mock为246已发布的精简接口，不修改Offdeck业务。
- 本地JS `index-CoNYbSDo.js`、CSS `index-B1aY6lyV.css`；隔离请求`.codex/uat141-browser-requests.json`，HTTP记录`.codex/uat230-host-http.log`。
- 245仍开放：Host概览使用完整Collection index/active IDs与healthReaderMany、旧全候选读取等，不能用本项5/5测试或HTTP响应快来宣称其有界读取已关闭。

## 发布后关闭

03:06，3489ea0ccf标准发布及生产新资产核对通过，Linux Query5通过。实际新概览左栏显示素媛(2013)，两列与待办跳转符合；错误/故障场景以相同资产的隔离HTTP验证。141与230分别关闭，245保持开放。[发布/备份/字节证据](UAT_RELEASE_3489EA0CCF_20260909.md)。
