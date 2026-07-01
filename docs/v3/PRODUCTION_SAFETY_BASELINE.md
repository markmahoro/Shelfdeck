# ShelfDeck v3.2.5 生产安全基线

本文记录 v3.2.5 阶段的生产安全边界。它不是产品路线图，也不是成人库数据模型设计；成人库热/冷数据治理延后到 v3.3 alpha/beta。

## Kairox 边界

- 范围：production safety、UI projection、Resource Runtime diagnostics。
- 不改变：Lifecycle facts、Task Creator / TaskAdmission、Flow、Event。
- 普通 Admin Web 不展示 DB/WAL、payload、resource bucket、I/O guard、diagnostic log。
- 后端诊断必须完整保留，但只通过内部诊断接口、日志、只读脚本和测试服务于排障。

## 当前生产事实

基线时间：2026-07-01。

当前 v3.2.4 已部署镜像：

```text
markmahoro/shelfdeck:v3.2.4-13f5bd8f
```

部署脚本最近两次生产快照后缀：

```text
20260701112533
20260701111816
```

最近一次部署后观测到的数据文件大小：

```text
config.json    45299
library.json   304208282
library.db     5226496
tasks.json     75649698
tasks.db       667033600
```

最近一次 v3 dry-run 观测：

```text
library rows: 1182
tasks rows:   720
events rows:  7381
missing columns: none
```

`scripts/production-readonly-diagnostics.js` 的只读聚合观测：

```text
library payload total: 2212173 bytes
library payload max:   2245 bytes
library.db-wal:        0 bytes
tasks.db-wal:          0 bytes
active tasks:          0
adult cache rows:      0
adult large artifacts: 0 bytes
```

成人库当前仍处于恢复前实验态：v3.2 只保证普通库和控制面可用，不把成人库恢复、adult hot/cold split、adult AI artifact 迁移混入 v3.2。JAV/US 的数据模型和历史迁移必须在 v3.3 alpha/beta 中 dry-run、备份、分批恢复。

## 只读诊断入口

生产状态排查优先使用只读脚本：

```bash
node scripts/production-readonly-diagnostics.js
```

该脚本只做这些事情：

- 读取运行镜像和 compose image。
- 调用 public `/v1/health`。
- 列出生产数据文件大小。
- 列出最近部署快照备份文件。
- 读取 `library.db` / `tasks.db` 聚合计数、payload 体积聚合、任务状态聚合。

该脚本禁止 `--apply`，不得写生产数据，不输出媒体标题、API key 或凭据。

Admin API 诊断仍然保留：

- `/v1/admin/resources`：默认 summary，轻量。
- `/v1/admin/resources?detail=full`：内部 full diagnostic，可包含 payload/resource/internal diagnostics。
- `/v1/admin/dashboard/health`：普通 dashboard 的轻量健康投影，不扫描 payload。

## 回滚边界

优先级从低风险到高风险：

1. 镜像回滚：使用上一个已知可用 tarball，仍走 `scripts/deploy-nas.js` dry-run 和 `--apply`。
2. 数据回滚：只有旧镜像无法兼容当前数据，或业务语义必须回退时才恢复数据文件。
3. 成人库实验回滚：只能从生产快照备份或更早的专门备份恢复，不在 v3.2.5 直接修复或迁移。

最近一次部署快照文件模式：

```text
/vol1/1000/docker/shelfdeck/data/<name>.pre-image-adult-20260701112533.bak
```

回滚前必须先复制当前生产 data 目录作为事故现场；不得直接覆盖或删除现有文件。

## 禁止事项

- 不直接编辑 NAS `library.db`、`tasks.db`、JSON 源文件或 WAL/SHM。
- 不在 v3.2.5 恢复 JAV/US 可见性。
- 不在 v3.2.5 引入 `library-cold.db`、cold payload migration、split/merge 或默认 cold merge。
- 不把资源视图、payload 体积、DB/WAL、慢查询、diagnostic log 放回普通前端。
- 不新增绕过 Task Creator / TaskAdmission 的自动任务入口。
