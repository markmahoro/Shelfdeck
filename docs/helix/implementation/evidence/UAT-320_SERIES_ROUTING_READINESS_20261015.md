# UAT-320：剧集路由缺配置与摩登家庭停滞

2026-10-15用户要求排查整理中的两条《摩登家庭》，并授权处理，后续与席位/来源公平功能合并验证升级。

## 现场与根因

- 来源为“剧集”，Field `media-field-f238ed0b-e35b-4198-bd90-6fbf3f571d53`，路径 `/media/Series`。两项分别为S02与S03，各24个主文件，10月13日已经完成Intake Acceptance，保留来源token，但没有Routing Work、Spec或Run。
- `libra_routing_policy_revisions`中该Field为0行。`routingCoordinator.reconcile`返回`unresolved/routing_policy_unavailable`，没有伪造Routing Decision；缺配置阻止推进本身正确。
- Formation只凭已生成的Routing Decision判定unresolved，没有Decision时显示`preparing/in_progress`。因此界面看似持续准备、需要处理数量为0，实际却需要配置。
- 两个Subject分别为`libra-subject-ac441ff7ff8c4ada23d5c150e71725ad7c613d78`（S02）与`libra-subject-543720ec1b961c2df87fd7bf7df41140dd22c26c`（S03）。第三个同源条目“校园之外”有独立Intake失败，不能以修复本项自动宣布其恢复。

## 正式配置修复

只读核对来源与现有active“剧集”Shelf `media-shelf-b9803b56-3b89-4dd7-928b-9900321b70a7`均为`/media/Series`，Shelf具有正式Series标准与Placement。通过正式Routing preview取得resolved及确切Shelf，随后PATCH发布direct策略revision1，幂等键`modern-family-routing-20261015`。策略digest为`3bc1b5bcd7256f99295ef43d29b465b82efb5099ecde56b9a189cc7dc4a15b7d`。没有手工SQL、Reset、Control释放、重建Subject或覆盖视频。

2026-10-15T14:07:03–04Z，两个公开Formation详情均为routing resolved、目标“剧集”，已创建active Run并执行身份核对：S02 `35201b9aca9c898fc5edf993cb02c1a66b09a549562287d4b1f02b4aad552ac7`，S03 `3584095356cef02cdfcdc9b2eded52366807ed4057b23b0bc7e9c12235ec2e00`。这证明原停滞点解除，不等同于整季完成或上架。

后续公开详情复核两季均currentIdentityRevision=1、无identity issue，已从核对身份推进到取得海报阶段；没有将新阶段的资源等待解释成原Routing停滞仍在。

## 相关部署准备与边界

用户另要求NAS `/vol02/1000-0-24018892`提供容器`/adult`。已核实宿主是现有Adult CIFS共享；标准`deploy-nas.js`增加该绑定，同时保留`/adult_media`及其余既有绑定，运行后检查两个根的device/inode一致。生产dry-run测试验证实际生成Compose、全部既有绑定及Secret不输出，3项通过。当前尚未recreate生产容器，实际生效留待用户授权的合并升级。

本机Docker使用实际037592bef4 Linux镜像，network none/read-only，同一task-owned fixture分别RO绑定`/adult`与`/adult_media`，两个根device/inode及文件内容一致。临时容器已自动退出；未在NAS创建额外Linux测试容器，未把本机fixture记为生产真实挂载验收。部署准备与现场记录提交`0f30e924b`。

缺配置的正式readiness及工作区可达动作由席位功能聊天承接，必须避免从UI Projection反向授权转区；具体代码、实际版本UI及回归证据后补。UAT-320保持开放。

## 2026-10-15 独立本地修复

Libra `routingPreparationReadiness` 统一表达已有 `routing_policy_unavailable`，Routing Coordinator 与
Formation 只读投影复用；没有生成虚假 Routing Decision/Run、释放 token 或修改 Control。投影从
冻结 Intake anchor 取得 source_field_id，按批查询 Libra 自有 routing head（每批最多100个来源），
不逐条读取完整策略，不扫描 Procurement/Foundation。仅没有 Routing Decision 且没有任何 Run 的
准备态适用这个检查；既有 Run、已交付和历史 Decision 保留原语义。

工作区以 `attention_required / 尚未配置收藏去向` 显示，当前 DTO 增加 optional
`routingConfigurationFieldId`，它只提供导航、不授予写入权。列表、筛选、计数及详情读取当前
Owner 事实；按钮跳到对应来源并展开、滚动到分拣策略。用户仍通过原正式 preview/publish API
配置，发布后缺配置提示消失、恢复正常准备，读取本身不创建 Run。来源页面新增 Router 上下文
依赖，相应单测已用 MemoryRouter 提供真实路由上下文，没有生产 fallback。

本地验证：

- `node --test test/helix-formation-projection.test.js test/formation-process-projection.test.js test/helix-architecture/p14-formation-truth.test.js`：68 pass，0 fail/skip。含无 Decision/Run、批量查询/只读、发布前后、冻结 Decision 保持及旧投影的列表/筛选/计数修正。
- Web `npm test -- --run test/routing-policy-loading.test.tsx test/material-field-scan.test.tsx`：12 pass，0 fail；首次补跑暴露测试缺 Router，补足测试上下文后通过。
- `npx playwright test e2e/routing-readiness.spec.ts --project=desktop --project=narrow`：1440×900 与390×844两项通过，命令内 tsc/Vite build 通过。使用受控 API fixture，覆盖需要处理→对应来源配置→发布成功→返回工作区恢复；不是生产UI、真实API配置旅程或UI负责人接受。首次 locator 精确 label 匹配失败，改用实际 accessible combobox role 后通过；产品行为未放宽。
- 已查看最终宽/窄配置页截图；文件在 ignored `media-service/web/test-results/routing-readiness-missing--99ff2-nd-clears-after-publication-{desktop,narrow}/routing-configuration.png`，同目录保存恢复后截图。
- 额外启动完整 `series-routing-run.test.js` 范围过大且初轮工具会话输出未保留 session ID，重复启动一次；确认两组均为本任务进程后停止剩余场景。保存日志的一轮已通过同名多季 Direct Commit、完整Placement migration两条真实隔离Host，不能记整个Series suite PASS。未完成场景不计通过；本修复的必需专项结果以上述68项为准。
- `git diff --check` 通过；Playwright管理的18181测试服务已停止。没有运行完整Service、Desktop或Linux构建，本次不涉及平台/文件Effect行为。

尚待：具体实现版本的用户指定 UI 负责人审核、统一发布和上线验收；UAT-320保持开放。二号转区及
来源公平的两个合同选择仍待用户确认，不包含于此修复；不改变两季任务的升级保护要求。

## 2026-10-16 具体版本 UI 接受与交付

上述“合同待确认/UI审核待完成”为独立修复切片的历史状态。用户随后已确认按 Subject 整体转入二号及最小通用 Foundation 接口；两个开发工作项的实现、后端验证和升级 Operator 见 [Libra 审查 Evidence](LIBRA_WORKSHOP_FAIRNESS_INTERFACE_AUDIT_20261015.md)。

用户授权后，已任命“UI负责人”对 `1f36d9ed85e1ec48f6d91c14d78617f3df2668af` 的冻结构建给出 **PASS，无阻断项**。独立浏览器 8/8 包含本项宽/窄的缺配置→对应来源配置→发布→待办消失；补充多来源只打开目标来源、特殊字符 ID、配置读取失败恢复和键盘路径。9项源文件/产物 SHA256 与精确提交一致；具体冻结资产、原始审核路径及边界见上述 Evidence。

具体 UI 门禁已闭合，实现/验证/Operator 已回传原聊天。统一发布、上线验收及含受保护 S02/S03 和新增事实的新鲜生产副本资格仍未完成；不以 UI 接受关闭 UAT-320，不清场或替换原 Subject/Run。


## 2026-10-16 已随dc7dcddbaf上线

readiness展示修复随已获UI负责人接受的1f36d9ed8资产部署至dc7dcddbaf。最新用户明确跳过NAS完整Host演练并要求升级，标准204→210结构复制/203表2,236,865行、完整备份及实际生产Host检查通过，不将skip记PASS。两季原Run `35201b9aca9c898fc5edf993cb02c1a66b09a549562287d4b1f02b4aad552ac7` / `3584095356cef02cdfcdc9b2eded52366807ed4057b23b0bc7e9c12235ec2e00`，原Subject、执行Basis/Scope和2个Workspace根/Scope身份保持，未Reset/取消/重建这些业务责任。UTC18:25:27仍active，当前Plan分别确认处理方式/处理视频、等待处理资源；保留现有排队，不宣称整季完成。本UAT继续开放至自身完整用户验收；二号/公平短窗口激活不代替两季交付。
