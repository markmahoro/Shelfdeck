# P6 Phase Exit Audit Evidence

Status: formal clean-tree audit pending evidence commit.

## Scope

- Baseline: `41470e47ec6bed7ba1cf81024130870eb2e57e92`（P5 exact phase closure）。
- Phase: P6 Horizontal Domains，仅限本地实现与isolated fixture。
- SSOT：最终文件必须与Architecture Agent提交`f2846fd1`中的原始blob逐字节一致；本线程不解释或修改SSOT。
- 禁止动作：E2E、Docker、Canary、production、真实Provider/媒体副作用和`media-desktop`。

## Independent gates

正式命令为：

~~~text
npm run test:helix-horizontal-exit
~~~

该命令组合执行：

1. 完整P6 horizontal isolated harness；
2. architecture dependency/semantic/contract gates；
3. P3 persistence与24项canonical transaction回归；
4. baseline后changed-path allowlist与禁区反例；
5. SSOT exact approved blob、SSOT commit allowlist、source-map与P2 aggregate校验；
6. P6-00至P6-12 Evidence完整性与clean worktree校验。

## Frozen contract baseline

- Capability：112；Result Family：96；Table：161；canonical transaction：24。
- Shared Type：28；Domain Input：92；referenced type refs：197；unresolved：0。
- P2 aggregate：`d94a53f8b7741aefa8bd0d245db4aafcc70100e2ac3d42d1ee7eb2685261cc70`。
- SSOT source-map aggregate：`9dbf0c63b3849e6fd80b28974808690ab9053d2090edee0154d601e1f316015f`。
- P3 DDL digest：`9ccd87f0907f5b66f691fa6828b4345c50dda2a66da7f886e3d449474a33ccbb`。

## Expected closure

只有正式clean-tree命令返回`ok=true`、`findings=[]`和`prohibitedActionsRun=[]`后，本Evidence才可冻结，P6才可归档并自动进入P7。测试通过不替代SSOT Owner/边界反向审计。
