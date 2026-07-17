# P6-11 Isolated Horizontal Harness Evidence

Status: complete.

单一命令：`node media-service/scripts/helix-p6-horizontal-verify.js`。

最终结果：`ok=true`；Architecture fixture files `74`；P2基线`112/96/161/24`、Domain input `92`、type refs `197/0 unresolved`；
P3 disposable SQLite为`161 tables / 74 indexes / 20 partial unique`；canonical transaction为`24 contracts / 25 crash fixtures / 10 Control CAS`。
Dependency、semantic、manifest、Persistence和Runtime回归均`findings=[]`，`prohibitedActionsRun=[]`。

Harness只使用Node、owned temp DB、fake ports和synthetic evidence；未启动Service、socket、真实Provider/Worker、E2E、Docker或部署。
