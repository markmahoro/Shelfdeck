# UAT-129 Retry Intent 重启验收

2026-09-09。Oracle：Intent 提交后中断，不靠用户再次发送 HTTP，由 Procurement consumer 恢复冻结 Admission；一个 Intent 最多一个新 Run，Outbox/Inbox 技术重放不产生自动连锁重试。

## 根因与修正

此前 consumer 单测已存在，但完整 Host 测试仍跳过。将旧同步 Observation / 自定义未登记 Plan 夹具替换为当前异步 Observation 和真实 Procurement 失败封存链后，稳定复现 `UNKNOWN_EVENT_CONTRACT:retry-admission-event-*`：通用异步执行恢复先于 Outbox 启动，阻断了同步 Owner 命令的 consumer。

启动先定向消费已提交的 Procurement Retry Intent 消息，再做通用 Event 恢复，最后开启普通 Outbox 与工作供应。恢复仍由既有 consumer 验证消息摘要、Owner Intent、精确冻结 Plan、Admission freshness / CAS，完成原有事务和 Inbox/ACK；没有新增 Intent，没有弱化通用目录校验，没有 Reset、迁移或兼容读取。定向恢复不消费其他领域消息；已失败投递的退避时间不阻碍本次启动恢复，任何消费异常直接阻断启动。

另修正 HTTP 幂等重放的 Admission input schema 名称，使其与首次冻结的 `retry-admission-plan-input/v1` 一致；此前重发会出现 `SYNCHRONOUS_WORK_PLAN_CONFLICT`。

## 本地证据

- 当前真实 Host / SQLite / HTTP：注册临时 Field，异步观察；注入明确的 `not_media` probe 结果，由当前 Procurement 流程形成 failed sealed Run。素材字节保持不变；此用例验证消息恢复，不冒充真实电影媒体验收。
- 仅在隔离数据库安装测试 trigger，阻断新 Run INSERT。HTTP 返回明确错误后，Intent open、Intent Event succeeded、Admission Event executing、一个原 Run、一个 Intent commit marker 均持久存在。
- 关闭 Host、移除故障 trigger、重建 Host；在任何 session / 重发 HTTP 之前，Intent consumed、恰好一个新 Run、Outbox fully_acked、一个 Inbox receipt。随后两次 HTTP 重放、再次 Host 重启和重放返回同一 Admission Result；冲突请求拒绝，原片源字节不变。
- 相关回归36/36：Retry eligibility / stale freshness、Owner consumer、Outbox Inbox、通用 startup fail-closed。投递退避和 ACK 丢失重放均覆盖，Inbox 不重复。
- 完整 clean Host 文件15通过、2既有跳过（Observation 旧路径及独立 Handoff B 场景）；其中实际节点入口启动/鉴权/停止也通过。原始记录 `.codex/uat129-regression.log`、`.codex/uat129-host-suite.log`。

状态：本地通过，等待实际 Linux 镜像验证及标准生产发布后关闭。UAT-125/250 的 Libra 输入漂移和 UAT-251 的用户终局仍保持开放，不由本项代替。
