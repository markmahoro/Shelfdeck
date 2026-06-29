# ShelfDeck v3 Goal Prompt

下面提示词可用于开启 v3 长程目标。它刻意不预设 v3 技术设计，要求 agent 先排摸再提出方案。

```text
请完成 ShelfDeck v3 全库重写升级。

v3 的升级目标：
1. 通过架构升级明确组件边界，大幅提升性能，尤其是任务、媒体库、策略、调度、持久化、外部依赖调用之间的边界。
2. 优化 service Admin Web。基于 v3 新模型，让展示层对用户更加清晰明确：配置可以简化，页面语义更清晰，媒体库字段、任务字段、状态字段、操作入口要符合用户对“媒体库管家”的理解。
3. v3 是一次完整重构升级，不是在 v2 上继续局部修补；但具体架构、数据模型、迁移方式必须由排摸结果推导，不要在开工前预设。

开始前必须阅读：
- docs/README.md
- docs/v2/PRODUCTION_BASELINE.md
- docs/v2/PRODUCTION_DEPLOYMENT.md
- docs/v2/DEVELOPMENT_WORKFLOW.md
- docs/v2/TEST_ARCHITECTURE.md
- docs/v2/DEBUG_WORKFLOW.md
- docs/v3/README.md
- docs/v3/OPERATION_CONTEXT.md
- docs/v3/BUSINESS_MODEL_NOTES.md
- docs/v3/V2_BEHAVIOR_PRESERVATION.md
- docs/v3/DISCOVERY_CHECKLIST.md

重要说明：
- 当前生产环境称为 v2。
- 本次目标版本称为 v3。
- v3 是全库重写升级，不是在 v2 上继续半改。
- 不要先假设 v3 的具体技术实现。必须先排摸代码库、生产基线、数据结构、API、Admin Web、desktop、worker、测试和部署流程，再提出架构和实施方案。
- docs/v3 只提供操作上下文，不是 v3 架构设计约束。
- BUSINESS_MODEL_NOTES.md 记录的是业务语义共识，不是技术实现方案。
- V2_BEHAVIOR_PRESERVATION.md 是防漏清单。尤其不要遗漏 v2 的 FFmpeg/FFprobe 参数、外部 API 调用、文件移动/替换/清理规则、任务状态机、审批 gate、配置默认值和 Admin Web 字段语义。

第一阶段：排摸
必须先完成：
1. 当前 v2 service 代码结构排摸。
2. 当前 v2 Admin Web 排摸。
3. 当前 v2 desktop 和 worker 边界排摸。
4. 当前 v2 持久化数据排摸，包括 library.db、tasks.db、config.json、nodes.json、people.json。
5. 当前 v2 生产部署流程和 NAS 环境排摸。
6. 当前测试和 E2E 覆盖排摸。
7. 当前生产环境实际运行镜像、容器状态和健康状态核准。
8. v2 behavior inventory：FFmpeg/FFprobe、Emby、Douban、MoviePilot、worker、成人 scraper、文件系统操作、任务状态机、配置默认值、Admin Web 字段语义。

排摸输出：
- 当前 v2 真实架构图。
- 当前 v2 数据结构说明。
- 当前 v2 性能瓶颈和边界混乱点。
- 当前 v2 service Admin Web 的信息架构、字段语义和交互问题。
- 当前 v2 关键行为 inventory，必须能回答哪些行为保留、替换、删除或迁移。
- 当前 v2 生产部署和回滚条件。
- v3 可选架构方向，不少于 2 个方案。
- 推荐方案及理由。
- 性能收益预期、用户体验收益、风险、迁移成本、测试成本、部署成本。
- 分阶段实施计划。

第二阶段：方案确认
在没有形成排摸报告和方案前，不要直接实施大规模重构。
如果方案会影响生产数据、部署流程或大范围 API，先输出计划和风险，让用户确认。
如果方案会删除或替换 v2 已有行为，尤其是 FFmpeg 命令、文件替换/删除规则、外部系统调用或 Admin Web 字段语义，必须先说明影响并让用户确认。

第三阶段：实施
按确认后的方案推进 v3。
实施中如发现方案不适合，基于代码和生产事实修正方案，不要硬套旧假设。

部署和生产要求：
- 生产部署只允许走 docs/v2/PRODUCTION_DEPLOYMENT.md 中的标准 NAS Docker 流程，除非先更新并验证新的部署流程。
- NAS SSH 通过 tools/ssh-exec.js 和 tools/nas-ssh-config.js。
- 私有凭据在 tests/TEST_ENV_CHECKLIST.md，不得泄露。
- NAS 是生产环境，不得无授权删除或重置生产数据。
- v3 生产迁移前必须 dry-run，并提供回滚方案。

最低验证：
- cd media-service && npm test
- cd media-service && npm run build:web
- bash tests/runner.sh health-check tests/env/ci.env
- 根据实际改动补充专项测试和 E2E。

完成后输出：
- 排摸报告。
- 方案选择说明。
- 架构改动摘要。
- service Admin Web 改动摘要。
- 数据迁移摘要。
- 测试结果。
- 部署结果。
- 回滚路径。
- 剩余风险。
```
