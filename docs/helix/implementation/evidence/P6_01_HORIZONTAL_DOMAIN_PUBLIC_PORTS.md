# P6-01 Horizontal Domain Public Ports Evidence

Status: `PASS`

Date: 2026-07-17

## SSOT traceability

| SSOT | Implemented contract |
| --- | --- |
| §3.6、§8.2.4 | `PerceptionCommandFacade`只追加Record/请求Acquisition；`PerceptionResolutionFacade`只执行single-kind Resolution |
| §3.7、§8.2.5 | `PeopleCommandFacade`只维护Person/Candidate/Preference/Reference；`PersonReferenceQueryFacade`只读Person Reference Projection |
| §4.6.2–4.6.3、§8.4.4 | 四个Facade为Owner发布的进程内versioned nominal boundary；无internal HTTP或跨域Store访问 |
| §5.9.1–5.9.5 | Resolution仅`found|not_found`语义；People出口没有Media-Cast、Content Identity、Shelf Entry或consumer command authority |

## Implementation result

- 新增唯一`p6-horizontal-domain-public-contracts.json`，精确登记4个Facade、12个named methods、Owner、kind和允许authority；
- Perception public entry精确导出`PACKAGE_ID`及2个Facade factory；People public entry精确导出`PACKAGE_ID`及2个Facade factory；
- factory要求实现对象与合同method集合完全相等，额外method、generic query或Media-Cast写入口fail closed；
- 返回port冻结，只转发调用，不持有Repository、Store、Transaction、Planner、Runtime或跨域写权限；
- P1 skeleton反例由“所有Domain只能有PACKAGE_ID”收紧为每个Domain精确出口allowlist，其他三个Domain仍只有`PACKAGE_ID`。

## Machine evidence

- P6 public port专项：3/3 PASS；
- P1 skeleton + P6专项：8/8 PASS；
- architecture aggregate：64 fixture files PASS；47 packages、53 files、65 dependencies，findings=0；
- semantic guard：1436 files、12 exact exemptions，findings=0；
- P2 contracts：112/96/156/18，aggregate
  `bcde76e0d380ead9fbe9c76c6c21293325d2de3dd97144c1357438c3d3cc8530`；
- P5 regression：10 fixture families、31 recovery scenarios、4 named boundaries，全部PASS；
- `prohibitedActionsRun=[]`。

未接product startup、HTTP/API/UI、真实Provider/媒体、E2E、Docker、production或`media-desktop`；本线程未修改SSOT。
