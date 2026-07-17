# P6-00 Baseline Receipt

Status: `PASS`

Date: 2026-07-17

| Field | Frozen value |
| --- | --- |
| P5 phase closure / P6 baseline | `41470e47ec6bed7ba1cf81024130870eb2e57e92` |
| Branch | `codex/helix-p6` |
| Worktree | `E:\my_project\emby_third_party-helix-p6` |
| P5 Exit scope | `P5_EXIT_AUDIT_LOCAL_PLATFORM_AND_INTEGRATIONS_ONLY` |
| P5 closure re-audit digest | `d17ace651cfea4b20a953ac4b0824e110c391d3559abbb97a17ccdb4b5d6c51f` |
| SSOT blob SHA-256 | `d5426ec79f6fcff3ef287b89804aebd63d422e6da62297507a2d4ca76265555a` |
| SSOT source-map aggregate | `fa27242e59bc670ff351877680d6e41d4905e91a26e2c87a4ef911ae22726aea` |
| P2 contract aggregate | `bcde76e0d380ead9fbe9c76c6c21293325d2de3dd97144c1357438c3d3cc8530` |
| Findings | `[]` |

Fresh checkout执行`npm run test:helix-platform-exit`：10个P5 fixture families、31个P4 recovery scenarios、63个
architecture fixture files、P3 156 tables/72 indexes/19 partial unique及18 transactions/132 fault points全部PASS；
401个P5 closure变更文件全部分类，`prohibitedActionsRun=[]`。

P6 worktree由Git共享对象数据库创建，不复制旧项目目录；原dirty workspace和`media-desktop`未被写入。P6-00未实现
Horizontal Domain代码，未运行E2E、Docker、production或真实媒体/Provider行为，也未修改SSOT。
