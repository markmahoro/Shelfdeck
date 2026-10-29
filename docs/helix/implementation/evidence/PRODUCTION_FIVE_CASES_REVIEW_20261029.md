# 五条生产待处理原因复核（2026-10-29）

用户指定先核查五条，再仅加入必要修复，完成电影自定义 Spec、US Adult 演员识别及积压根因后，安全停止、Fresh Reset 和标准部署同一版本。旧未入藏条目不增加兼容或自愈；用户已明确跳过真实 CIFS 验证。原 13:36 分诊和 16:18 快照见 [PRODUCTION_TRIAGE_INTEGRATION_20261029](PRODUCTION_TRIAGE_INTEGRATION_20261029.md)。

## 一次性只读证据

2026-10-29 19:15–19:28（Asia/Shanghai），SSH 经统一 `tools/nas-ssh-config.js`，在生产现有容器内以 readonly SQLite、`query_only=1`、读事务及 ROLLBACK 读取五个精确 Subject/Run、最多 40 份去重失败 Evidence，并对 DDOB 两个冲突目标做 lstat；唯一 NFO 小于 256 KiB，打开前后核对身份与大小。无生产 POST、重试、配置修改或媒体写入；数据库 `total_changes=0`。只读脚本是当前任务 ignored `.codex/five-case-review-20261029/` 中的 `inspect-remote.cjs`、`ddob-remote.cjs`、`context-remote.cjs`。

| 条目 | 新证据与结论 | 本轮判断 |
| --- | --- | --- |
| DDOB-019 | 目标 MKV 与 NFO 存在；同一现有 Shelf Entry 为 active、已有 On-deck Commit，Canonical Identity 是 `jav/DDOB-019`，当前主文件 inode/大小与登记一致，Material Control 归该 Arca Entry。当前 Subject 的 primary Binding 是不同物理身份和路径，当前 On-deck 尚未 Commit。NFO 当前有同番号；不凭番号或字节假定两个材料相同。 | 现有目标冲突保护是正确停止；不能据此覆盖、合并或删除。Reset 保留正式文件后，新的同目标冲突仍可能存在。 |
| 爱，死亡和机器人 S02 | 原三次生产 Attempt 均为 `ECONNRESET`。使用当前正式 TMDB Adapter、当前 Platform Secret Lease 和 Network Policy 按冻结标题/季号做一次只读查询，3 次正常 GET 返回成功及一个候选。 | 曾发生连接中断，当前请求成功；不能定位原始远端/代理层或断言不再复发，不追加旧任务兼容。 |
| 硅谷 S04 | 原事件只保留 `PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID`。当前按冻结标题/季号通过同生产 Adapter 两次有界复现相同错误；TMDB 搜索和 show 均 HTTP 200，show 的一个 `alternative_titles[].type` 为 159 UTF-8 bytes，旧代码要求不超过128。此字段不投影到 Alias Evidence；整个 HTTP JSON 本来有1 MiB限制。原始错误未留存字段级原因，当前受控复现不能伪称历史 response 完全相同。 | 新增 `TMDB-ALIAS-TYPE-BOUND`，修复新任务的真实可重复协议误拒。 |
| GVH-877 | 原 `JAV_SOURCE_UNAVAILABLE` 持久 diagnostics 为空；当前按已冻结站点、资源键和实际 Network Policy 只读获取精确页面一次，HTTP 200、页面解析到封面阶段；为控制范围在封面请求前主动停止，没有下载封面。 | 不能反推历史到底是网络、站点还是封面失败；新增安全诊断修复，不新增自动重试。 |
| SORA-062 | 原身份观察与资料读取分别为 `JAV_SOURCE_TIMEOUT`，后者 diagnostics 为空；当前对已选同站精确资源一次页面 HTTP 200、解析到封面阶段后主动停止。 | 同上；当前页面可访问不证明封面可访问或历史超时位置。 |

原始错误窗口的限时 Docker 日志中未找到与上述 GVH/SORA/爱死机 Event 精确相关的行；不能把未找到当作故障不存在。TMDB 实验仅调用精确 TV 搜索和结果详情/季信息，输出字段结构及安全错误码，不输出凭据、URL 或响应正文。JAV 检查各只发送一次页面请求，无 cover 下载。

## 代码根因和候选修复

`failureDiagnostics` 仅白名单 `json_request/image_request` 与 `statusCode`，而 `JavSourceError` 保存 `page/cover` 与 `status`；客户端对网络异常重包装又丢弃了安全的底层网络码。只应沿既有错误和 Owner 路径保留固定阶段、100–599 状态及已白名单网络码，不复制任意异常正文、URL 或凭据；既有生产失败 Evidence 不能追溯补造。

上述两项与五条实际故障直接相关；不把隔离构造的 On-deck 外来 Stage 误认问题等额外边界研究当作本次积压根因。当前代码、精确测试、最终集成及生产验收状态以最新 Phase/Status 为准，不以本证据声称它们已经完成。

## 定向实现与当前验证

- 在独立 Series 候选工作区 `C:/Users/markm/.codex/worktrees/shelfdeck-series-fenced-20261029/emby_third_party-helix`，提交 `9a271d317` 保持 TMDB 1 MiB 整体响应边界、业务 Alias 的独立标题上限与类型校验，把不进入 Alias Evidence 的非业务 type 字段限制绑定到整体响应上限。159 字节反例修前 Linux 定向失败、修后通过；非字符串和超过整体响应限制仍失败。
- 提交 `9ae7c1aa6` 将 JAV Source 的 page/cover、合法 HTTP status 和白名单 networkCode 传入 failure diagnostics；身份观察失败路径也携带同样的有界 diagnostics。保持已存在的错误码、来源选择及重试合同，不输出响应、URL 或凭据，不修改旧记录。
- 本机隔离 Linux Docker、只读源码、禁网，三文件共 **64 PASS / 0 FAIL / 0 skip**；身份选择与 failure diagnostics 两文件后续 **22 PASS / 0 FAIL / 0 skip**。JAV 精确真实 Host 先经历一次站点 HTTP 503，在实际 Event 的持久 failure Evidence 中验证 `{stage:'page',statusCode:503}`，**1 PASS / 74 name-filter skip**。这些是定向结果，不是完整发布资格。
- 既有完整 FC2 503→后备站→上架旅程的前两次分别在本次候选和冻结 `1d8a` 上 **0 PASS / 1 FAIL / 73 name-filter skip**，原有65秒入藏等待到期，身份及 Metadata 已成功，但未产生 On-deck Commit。复核发现两次均错误地把 `/tmp` 限为 1 GiB，而 Workspace 准入至少需要 5 GiB 加输入预算；系统正确延迟创建 Workspace。改用 Docker 自动回收的隔离匿名卷（实测可用空间充足）后，在同一候选、原65秒等待及原安全边界下重跑 **1 PASS / 74 name-filter skip**，包含三次 503 持久 Evidence 的 stage/status 断言和唯一入藏。首次失败保留，不作为代码或产品失败抹去，也不把这一项通过扩张为完整版本验收。
- 日志保存在本任务 ignored `.codex/five-case-review-20261029/`：`jav-host-linux.log`、`jav-host-baseline-linux.log`、`jav-host-volume-linux.log`、`jav-evidence-host-linux.log`、`targeted-linux.log`、`identity-linux.log`。
