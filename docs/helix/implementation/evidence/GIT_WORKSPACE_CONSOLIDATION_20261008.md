# Git 分支与工作区整合

日期：2026-10-08。用户要求整理项目、废弃无效工作区并合并 Git 分支。本次为本地工程整合，不是新功能节点验收，不分配 UAT 编号，不部署生产。

## 当前入口与合并结果

- 唯一 Series 开发入口回到 `E:/my_project/emby_third_party-helix` 的 `main`。
- `main` 从 `2d9d458bb` fast-forward 到 `1d998a43c`，纳入 Movie Beta 收尾、工程清理及 Series 节点1已有交付。
- 合并已发布的维护分支 `eb0bd08a3`，merge commit 为 `2c2998827`。源代码自动合并；三个状态/台账文件冲突人工按证据整合，保留 Series Phase、Movie 收尾及原 UAT 记录，只追加 UAT-281，不恢复维护分支的旧 Movie 活动计划。
- 最新已记录生产为 UAT-281 的 `helix-beta-20260930-8e197b3c36`；Series 分支原来只记录9月28日版本，已纠正。此次没有查询实时生产或更新生产镜像。
- Series 仍在节点1：逐Primary产品验证/加工和交付关联待完成，未完成首批完整上架、UI验收或发布资格。

## 工作区与分支退役

核查前11个Git工作区、25个本地分支；核查后保留2个工作区、2个本地分支：

| 工作区 | 分支 | 保留原因 |
| --- | --- | --- |
| `E:/my_project/emby_third_party-helix` | `main` | 统一开发与当前Series Phase |
| `C:/Users/markm/.codex/worktrees/db87/emby_third_party-helix` | `codex/uat267-physical-gate-db87` | `ab1db1844`含未合入的只读clone preflight脚本、测试和独立隔离证据；不以整理名义直接发布或宣称验收 |

其余9个工作区整体移动到同磁盘归档目录，再清除失效Git worktree登记。没有递归删除其文件，也没有沿junction清理依赖。原未提交/ignored文件留在完整目录中；这是退役和可恢复归档，不是磁盘空间回收。

23个旧本地分支名已删除，原25个分支tip全部保存为 `refs/archive/20261008/heads/<原分支名>`；9个退役工作区HEAD另存 `refs/archive/20261008/worktrees/<目录名>`。没有创建release tag，也没有推送或删除远程分支。

旧分支中既有已合并祖先，也有被cherry-pick/后续实现承接的提交和历史文档差异。已核对如care-clarity的patch等价、accepted-defects对应后续同代码提交、UI测试patch等价等。**退役不表示所有旧分支的独有diff均已采纳**：无法证明应直接进入现行合同的历史差异完整保存在archive refs与bundle，未使用ours merge伪造全部合并，也未把旧实现反向覆盖新代码。

## 修改保护与恢复

仓库外备份：`E:/my_project/helix-git-consolidation-20261008/`。

- `all-refs.bundle`：整合前所有Git refs，已验证完整历史。
- `consolidated-refs.bundle`：第一次整合后Git refs，含archive refs及主工作区stash，已验证。
- `worktree-retirement.json`：9个原路径、归档路径、HEAD、分支及原dirty文件列表；逐项核验原目录已移走、归档存在。
- `recovery-refs.txt`：精确恢复ref与SHA。
- E盘工作区保存在该目录的 `worktrees/`；C盘工作区保存在 `C:/Users/markm/.codex/worktree-archives/20261008/`。

主工作区原内容保存在stash commit `7150bb9848383dfd58e735e299a1437a1a6331bf`。原AGENTS/Playbook独有UI要求已与新治理规则合并，未回退部署职责和Series节点规则；Beta baseline相关改动已由新分支承接。UX-039历史记录和Movie UAT检查项恢复。原未跟踪 `EMPIRE_OF_THE_SUN_ONDECK_DIAGNOSIS_20260910.md` 恢复在主工作区，保持未提交，不夹带为新验收。最初本轮制作的跨工作区入口草稿仅留在stash中，已由真正整合后的相对文档入口取代。

原iteration和failure-release-check的dirty修改仍保存在其整体归档内，没有将未审查代码混入main。恢复时先用archive ref创建独立工作区，再从对应归档提取所需dirty/ignored文件；归档内旧`.git`指针已随登记清理失效，不直接当活动仓库运行。

恢复分支示例（仅在需要时执行）：

```powershell
git branch codex/restored-series refs/archive/20261008/heads/codex/beta-closeout-series
git worktree add E:/my_project/helix-restored-series codex/restored-series
```

## 验证与限制

- 第一次完整架构检查：248文件，2000通过、2失败、9跳过。两处失败在原Series提交`1d998a43c`单独复测均复现（66项中64通过、2失败），不是UAT-281合并引入。
- 根因：Series已修改合同图和schema closure，但两个精确测试Oracle仍停留在此前合同。P2 validator及全部结构/边界检查本身通过。同步现行聚合digest与8个Series受影响Capability差异项，保留精确集合比较、历史witness固定digest及负向校验；没有更改runtime合同、迁移历史witness或弱化门禁。
- 最终官方 `helix-architecture-verify.js`：248文件fixture通过，dependency、semantic、manifests、contracts全部通过，整体`ok:true`。原始输出在备份目录的`architecture-final.json`；初始失败及原分支复测分别保存。
- 媒体Probe/构建定向4项：3通过、1跳过；跳过原因为缺少`HELIX_DELAYED_HEADER_FIXTURE`，不声称重跑真实蓝光回归。
- `git diff --check`通过；两个Git bundle验证通过，9个归档路径核验通过。主Service及Web依赖为本地普通目录，未通过删除工作区沿junction破坏依赖。
- 未运行完整Service/Desktop、Linux/Docker、浏览器或真实Series E2E；没有新增UI交付、生产部署、Reset或媒体操作。此检查只支持本地分支整合，不关闭Series节点或遗留UAT。
