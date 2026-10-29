# ARCA-PATH-COMPONENT-BUDGET 本地证据（2026-10-29）

## 范围与依据

基线为 `a2bf2d6fd3271dc3a3741e28ed42f533a59d99d4`。本工作仅在隔离工作区、Linux Docker 和合成文件中验证；没有连接 NAS、操作或 Reset 生产数据，也没有修改既有生产 Decision。工作项由主整合 Phase 跟踪，不新建 UAT 编号。

此前只读排查中，HALT-094 的目录、文件名及带 `.tmp-` 后缀的文件名分别为 232、236、257 UTF-8 bytes；EMLB-094 分别为 264、268、289 bytes。六次首发异常均在 CIFS 上的临时路径 `lstat` 报 `ENAMETOOLONG`，先于复制；对应暂存目录为空，未发现放置或提交证据。每个条目各有三个 Work generation，每个 Effect 的恢复窗口约一小时；缺少提交 marker 时原通用 material-commit observer 要求 forward，重复相同路径，最终各自耗尽预算。此处不把缺少 marker 推断为没有写入。

SSOT §6.5.3、§10.5.3 由 Arca 冻结 Final Inventory Decision 并持有 Placement，SSOT JAV 约定对非法、过长或碰撞路径使用现有错误合同；已入藏 JAV Correction 不能通过自动后缀避让碰撞。路径无法安全表达时，不能静默缩短名称或改变旧 Decision 来制造成功。

## 实现和验证边界

- Arca 在形成新 Decision 和开展 Inventory Feasibility 时按 UTF-8 bytes 校验每个路径组件。当前实现以 255 bytes 为单组件上限，为 `.shelfdeck-stage-` 加 16 位后缀保留 33 bytes，为 `.restore-` 加 16 位后缀保留 25 bytes；后者也覆盖较短的 `.tmp-` 后缀。目标目录最后一个组件最多 222 bytes，最终文件名最多 230 bytes，其余路径组件最多 255 bytes。碰撞策略产生的后缀也在形成 Decision 前检查。
- 移除原来的 UTF-16 `slice(0, 180)` 静默截断，保留完整扩展名、剧集标记和可表示的 US Adult 原名；超限或无效 Unicode 明确失败。目录和文件名不自动追加 hash，不删除或覆盖冲突材料。US Adult 超限继续使用其原名不可改写的错误合同。
- `arca.acceptance.inventory_feasibility.observe@1` 是纯观察。仅在该纯观察中，Arca 将确定的目标组件错误返回为 `retryDirective: never` 的失败，并保留有界字节数字作为诊断；其他未知异常照原样传播。没有改变 Foundation 对非纯 Effect 的观察、恢复或重试判断。
- 旧 Decision 仍须通过原有完整摘要/内容比对。历史名称因取消截断而与重建结果不同，测试确认 `CLEAN_ARCA_FINAL_DECISION_DRIFT` 在创建 Slot 前拒绝；本工作不迁移、修复或重写旧条目。旧 Decision 自身超限也会被明确拒绝。
- 对极长剧名叠加大量集号、最终完整组件超限的情况，保持集号不截断并在写入前拒绝；32 集短标题的合成示例仍完整保留所有集号。

修复前，两个合成多字节案例在 Linux Docker 的实际暂存中复现 `ENAMETOOLONG`。修复后，边界内的两组合成案例完成 Stage、展示文件恢复、验证和 Placement；超限案例在写入前拒绝。相关测试覆盖同步/异步 Inventory 路径、旧 Decision、US Adult 原名、JAV Correction、目录及文件后缀边界、碰撞、不可用 Unicode、Series 集号/缩略图和未知错误传播。Linux 容器内使用本地基线镜像的 Node 20 和只读源码挂载，网络禁用；相关 12 个测试文件共 214 项通过，`git diff --check` 通过。

## 未完成项

- 这项预防性修复不使 HALT-094 或 EMLB-094 的旧 Effect 自动恢复，也不证明它们已入藏；生产上的旧状态仍须依各自事实、既有合同及单独授权处理。继续使用原冻结的超限名称将被拒绝。
- 255-byte 预算是当前实现的保守限制，不是所有 Endpoint 文件系统能力的证明；真实 CIFS 路径及生产端到端验证未执行。
- 本地修改会改变历史上曾被 180 个 UTF-16 单元截断的名称，并可能改变可见路径或报错。未做对应版本的 UI 任务走查及用户指定 UI 负责人的审查；不得声明 UI/UAT 通过。
- 完整服务测试未完成：隔离容器缺少仓库工具依赖 `tools/node_modules/ssh2`，且后续测试涉及本项之外的 Reset 逻辑，已停止该容器。本地全量尝试中的 Reset 测试仅使用隔离合成数据。部署、发布和生产验收均未进行。
