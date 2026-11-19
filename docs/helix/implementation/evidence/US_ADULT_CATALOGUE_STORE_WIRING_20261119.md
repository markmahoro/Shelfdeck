# US Adult Catalogue 决策输入装配与 Libra 边界修复验收记录（2026-11-19）

## 问题根因

1. `media-service/src/clean-service-host.js` 调用 `createHelixExecutionRuntime`（即 `createProcurementExecutionRuntime`）时不在外部 `options` 中传入 `contractValidator`（校验器在 `createProcurementExecutionRuntime` 内部构建）。
2. `media-service/src/helix/composition/create-procurement-execution-runtime.js` 原先在构造 `catalogueInputReader.compile()` 时直接 `require` Libra 私有模块 `us-adult-catalogue-decision-input`、`us-adult-catalogue-store`、`us-adult-actor-choice-store`，并将外层未提供的 `options`（`options.contractValidator === undefined`）传给 `createUsAdultCatalogueStore(options)`，导致在 People `catalogue_registration` 完成后执行 `readCatalogueRegistrationEvidence -> catalogueInputReader.compile` 时稳定抛出 `UsAdultCatalogueStoreError: Catalogue Basis persistence requires Libra storage and formal contracts.`。
3. 上述错误在 `readCatalogueRegistrationEvidence` 中被捕获并转化为 `PEOPLE_CATALOGUE_INPUT_PENDING`，使操作长期停留在 `preparing` 状态而无法收敛为 `completed` 并完成 `face_catalogue` 建档结算。

## 修复内容

- `media-service/src/helix/domains/libra/public/index.js`：
  - 引入 `../model/us-adult-catalogue-decision-input`。
  - 在 `LibraExecutionRegistration().createProcessServices(options)` 内，使用已具备 Libra 存储、读取器与形式化 `contractValidator` 的依赖装配并导出 `usAdultCatalogueDecisionInput`（当 `workResultReader`、`workspaceProductPort.readArtifactBytes`、`contractValidator` 就绪时启用，否则显式为 `null`）。
- `media-service/src/helix/composition/create-procurement-execution-runtime.js`：
  - 将默认 `catalogueInputReader.compile(request)` 收口为直接委托 `libraProcessServices.usAdultCatalogueDecisionInput.compile(request)`，缺席时保持 fail-closed（`PEOPLE_CATALOGUE_INPUT_UNWIRED`），同时移除 composition 对 Libra 私有模块的 3 处直接依赖。
- 回归测试：
  - `media-service/test/helix-architecture/us-adult-catalogue-host-wiring.test.js`：新增 `LibraExecutionRegistration` 装配与 `composition` 无私有依赖委托检查。
  - `media-service/test/helix-architecture/us-adult-catalogue-registration-host.test.js`：补充 `LibraExecutionRegistration().createProcessServices` 对 `usAdultCatalogueDecisionInput` 的导出测试，以及在刻意省略外层 `contractValidator` 与 `catalogueInputReader` 的默认 `createProcurementExecutionRuntime` 中完成 `catalogue_registration -> completed`（`Person` 写入 `currentRevision = 1`）的端到端测试。

## 验证结果（Linux worker `192.168.12.216`）

- **RED 基线复现**：在未合入修复的 `main`（`cf852a4f7`）上运行 `test/helix-architecture/us-adult-catalogue-registration-host.test.js`，7 项测试通过 5 项、失败 2 项：`LibraExecutionRegistration exposes usAdultCatalogueDecisionInput with formal contracts`（`undefined !== 'function'`）与 `default composition runtime catalogueInputReader compiles without outer contractValidator on options`（`op2.state === 'preparing' !== 'completed'`）。
- **GREEN 回归测试**：合入修复后在隔离 worktree 中运行：
  - `test/helix-architecture/us-adult-catalogue-host-wiring.test.js`
  - `test/helix-architecture/us-adult-catalogue-registration-host.test.js`
  - `test/helix-architecture/us-adult-catalogue-decision-input.test.js`
  - `test/helix-architecture/us-adult-catalogue-store.test.js`
  - `test/helix-architecture/p9-libra-run-coordinator-boundary.test.js`
  - `test/helix-architecture/package-boundary-guard.test.js`
  - `test/helix-architecture/forbidden-semantic-guard.test.js`
  - **结果：57 / 57 全部通过（0 失败）**。
- **架构边界检查**：执行 `checkPackageBoundaries`，包边界违规基线总数由 `main` 的 24 降至 **21**，`composition/create-procurement-execution-runtime.js` 中 `us-adult-catalogue-*` 违规降至 **0**。
- **Layer 1 `createCleanServiceHost` 真实启动冒烟**：在临时 `/tmp` 数据目录和 `127.0.0.1` 临时端口启动宿主（`routeCount=167`），`GET /v1/health -> 200`、`POST /v1/admin/session -> 204`（含 `Set-Cookie`）、`errors=0`，随后优雅 `close()` 并清理临时目录。
