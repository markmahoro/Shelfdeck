# P6-08 Reference Image Maintenance Evidence

Status: complete；依据Architecture Agent提交`f2846fd1`的精确合同派生实现；本线程未编辑SSOT。

## Traceability

| SSOT合同 | 实现与反例 |
| --- | --- |
| Person可先直接注册，Reference Image为独立事务 | Direct registration建立`current_reference_revision=NULL`与初始Projection checkpoint；不伪造Reference Fact |
| 用户只见Reference Image；必须恰好一张Face | `add_image`同时冻结Asset、唯一Face、Embedding/Model；0或多Face整体拒绝 |
| add/release使用稳定ID、expected revision/state、digest和CAS | `people_reference_assets/faces/revisions/persons`在一个Owner UoW提交；stale revision零可见写 |
| Merge后Projection展开且不搬迁Owner | source Reference仍归source Person；target只读展开继承贡献；GET不写Store |

Focused `p6-people-reference-lifecycle`为`5/5 PASS`；People Store/Registration/Public组合`26/26 PASS`；24个canonical transaction
崩溃矩阵含Direct Registration与Reference Image Commit并PASS。大图片、embedding和model payload均未进入People Store，只有handle/ref/digest。

`prohibitedActionsRun=[]`；未运行E2E、Docker、部署、真实媒体副作用，未修改`media-desktop`。
