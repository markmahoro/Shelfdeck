# P9-00 Baseline Receipt

Status: PASS

- Baseline commit: `3184ef4573cb3663e4a1fae87fc65b4d1c270b38`
- Branch/worktree: `codex/helix-p9` / `E:\my_project\emby_third_party-helix-p9`
- P8 Exit Audit: `ok=true`, `findings=[]`, `prohibitedActionsRun=[]`
- Audited P8 Evidence digest: `58ed09503f1a11542679d568e7109d540f85a378565138d0c7558e04aad7f811`
- Approved Architecture commit: `72df5a9df1791a9566656ba93c3167d357abd89e`
- SSOT aggregate: `09125cb6395ed29b4d587e95198de5f81c22087d4020ed42407cf6d9ce5ecf62`
- P2 contract aggregate: `2603935143e3e38dc928c7a42e0e006c5216c3e0707ff685ee33b8d41309be69`
- Contract inventory: 112 Capability / 97 Result family / 169 table / 38 canonical transaction
- External actions run: none

首次执行因新worktree没有`node_modules`而缺少`better-sqlite3`，属于环境准备失败而非产品回归；建立到P8已验证依赖目录的本地
untracked junction后，未修改lockfile或源码，clean-tree基线复验PASS。
