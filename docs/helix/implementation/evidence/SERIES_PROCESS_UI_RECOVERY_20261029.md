# Series 恢复失败反馈与过程弹窗焦点（2026-10-29）

本记录属于本轮 Series 修复的专属 Evidence；不替代唯一活动 Phase、最终固定候选 UI 负责人复验或生产验收。实现线程只使用本机隔离工作区，没有访问 NAS 生产或改写主整合工作区。

## 复现与范围

UI 负责人在精确候选 `1d8a45843f9c8982c91bb0a367eb0adfa1c5c310` 的四视口记录两项 P2（原始 `findings.json` 和截图位于 `E:/my_project/helix-git-consolidation-20261008/series-ui-review-1d8a45843f-20261029/`）：

1. Foundation 已有界终结的 `P4_EVENT_RECOVERY_OBSERVATION_UNAVAILABLE`，在“查看过程”的“写入剧集资料”失败节点仅显示“具体失败原因暂不可用”，而原任务仍有“重试上架”入口。这个案例以真实 Linux Engine 的失败码/消息替换真实 Host 失败 DTO 对应节点，**不是**完整 Host 观察预算耗尽旅程；原有等待、普通失败和重试 Host 旅程分别验证。
2. 使用实际失败过程 DTO，通过键盘打开“查看过程”，从最后一个可见控件按 Tab，焦点落到背景 BODY；这是本轮发现的既有问题。原 28 条浏览器正常场景 PASS，新增 8 条失败（两种情境各四视口）。

`1d8a45843f` 是本 worktree 的父提交。纯 UI 修复 `60f123a71af02b59f7a0afd6c646f8a34f26f764` 只改 `media-service/web/src/helix/ProcessStages.tsx`、`error-labels.ts` 和定向单测；浏览器回归提交 `567ad89ca` 增加 `media-service/web/e2e/formation-process-recovery.spec.ts`。没有修改后端、Effect、Owner、API、Schema、DDL、运行状态或生产文件。

## 根因与修复

- `ProcessNodeRow` 收到失败代码并调用 `processFailureLabel`，但该映射缺少此精确代码；英文或不可展示的原始消息落入通用文案。新增单一代码的短提示“未能在规定时间内核对文件状态”，不推断权限、网络或真实文件冲突，不改自动恢复或重试规则。未知代码和 EPERM 的现有区分仍有负例。列表中原有“重试上架”可达，不增加说明段落或新业务动作。
- `ProcessDialog` 原来只处理 Escape 和关闭时返焦，没有 Tab 围栏。局部增加可见、可用控件的焦点循环，包括原生 `details/summary`，按展开状态重新计算；过滤隐藏、禁用及 inert 控件，外部程序性聚焦回到弹窗，关闭后返回触发点。原生嵌套 `<dialog>` 打开时继续由其处理 Tab/Escape。已有 `useModalFocus` 不纳入 `summary` 和折叠 `details` 的可见范围，因此没有直接用于本场景或扩大全局 Hook 语义。
- 浏览器实际检查覆盖正向/反向 Tab、展开后更新最后控件、外部 focus、关闭返焦和真实嵌套重试确认；不提交重试命令。保留原隐藏控件、焦点标签和原有确认后果。

## 验证与失败保留

工作区为 `C:/Users/markm/.codex/worktrees/shelfdeck-series-parallel-20261029/emby_third_party-helix`，分支 `codex/series-recovery-parallel-20261029`。所有执行和日志位于该目录；`.codex/series-process-feedback-20261029/` 是 ignored 证据目录，不含生产导出。测试用独立 loopback 静态服务与受控 API fixture，结束后服务退出。

| 验证 | 结果 |
| --- | --- |
| 原生红例 | `vitest-red.log`：3 项中 2 项按预期失败，分别复现缺失原因和 Tab 越界；嵌套确认负例通过。 |
| 首轮修复验证 | `vitest-first.log`：26 PASS / 1 FAIL。新增测试误以为未知代码会无视已有中文消息；修正测试输入为无可展示中文的未知消息，保留现有产品回退。 |
| 构建首轮 | `native-build.log`：TypeScript 对局部 `parent` 推导报 TS7022/TS18046；仅补 `HTMLElement|null` 类型标注，`native-build-repaired.log` 通过。原构建的 500 kB chunk 提示保留。 |
| 本机定向 | `vitest-final.log`：5 文件、27 PASS；含诊断文案、双向焦点、动态折叠、外部 focus、返焦、原生确认及既有重试/维护路径。 |
| 实际 Linux Web | `linux-web-tests.log`：49 文件、274 PASS / 0 FAIL；`linux-web-build.log`：`tsc && vite build` 通过。基底 `shelfdeck-series-web-gate:1d8a45843f`，image ID `sha256:a209f3518c2d544e8ab8a2cae59bf29291b7932e2b7b069db41782852dbdf7c1`；源码/测试只读挂载、`--network none`、2 CPU/3 GiB、本机容器自动退出。 |
| 真实浏览器 | `browser/browser.log`：44 PASS / 0 FAIL，四视口为 1920×1080、1280×800、1024×768、390×844。其中 36 项为 UI 负责人原 9 场景原样复跑；8 项为仓库新增两条浏览器回归。实际浏览器在本机运行，截图与轨迹保存在 `browser/results/`。 |

浏览器读取本次构建后的静态资源；`linux-build-hashes.log` 与浏览器所用本机构建的 `index.html`、CSS、JS SHA256 **逐项一致**（分别 `e3bb7e0f402a6fa76f077004db403e2206f880c8de1151e5bb4b9a000bd13364`、`63de529c9047822c61c48af024aa2ccd802f8bffd1cf99bd7394e14be146934c`、`a0eef3c49618a5329bdd3475ce1dbf37fcd41c81af40d908b46fd07045b67c06`）。这不是最终生产镜像资格。

UI 负责人原 spec 与四份输入 fixture 在本工作区仅作复制，已逐字节等于其证据原件；新增仓库 spec 的浏览器副本与提交文件逐字节一致。`feedback.json` 显示精确代码及新短提示；`focus.json` 显示 `inside=true`、焦点为关闭按钮。该复制测试脚本内 `source` 字段原有的“unmodified ProcessDialog”是复现阶段的固定文字，本次运行实际加载上述修复版资源，不将其当作源码身份凭据。

## 集成与重验

主整合应在其新的 Series 最终候选上纳入 `60f123a71` 和 `567ad89ca`（以及本 Evidence 提交），在冲突时保留精确错误语义及嵌套确认保护。重验工作区需处理行、普通重试入口、观察等待/超时失败与完成、剧图/单集资料展示；过程弹窗需重验四视口下可见控件正反向 Tab、展开/折叠、Escape、原生确认和触发点返焦。该最终候选同时包含后端可见行为变化，仍需 UI 负责人对**具体最终版本及镜像**给出结论；本线程 44 项开发走查不替代该门禁。当前 NAS 不可用窗口由主整合管理，真实 CIFS、标准部署与七条生产恢复验收仍开放。
