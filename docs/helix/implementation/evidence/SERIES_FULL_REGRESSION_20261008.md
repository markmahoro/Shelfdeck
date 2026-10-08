# Series 完整架构回归与入口等待（2026-10-08）

277个`media-service/test/helix-architecture/*.test.js`在`0eea37925`启动，原运行保持到终态，没有因观察超时重启。期间只提交无默认行为变化的跨设备测试/证据，运行源码未修改。

## 完整结果

2,407项：2,396通过、1失败、10既有可选/历史skip，917.56秒。唯一失败为`formal node entrypoint starts, authenticates and shuts down through public HTTP`，错误`service health timeout`，stderr为空。原helper最多400次25ms轮询（约10秒），没有单次HTTP请求上限；测试子进程在健康检查通过前仍存活。独立原版同场景7.65秒通过，未以隔离通过覆写原失败。

## 测试修正与复验

将测试等待改为单调时钟30秒启动预算、每次GET最多1秒，提前检查子进程退出；超时保留耗时、最后HTTP状态与传输错误类型。非200响应释放body。仍必须200并完成原有generation、Admin页面、认证、凭据配置、Field登记/查询及关闭检查。不修改生产启动行为、业务合同、HTTP成功条件或重试业务操作。

相关完整三文件（入口、Capability Contract Validator、Bounded Catalog Transition）83通过、2既有skip，32.65秒；正式入口本身11.33秒通过。另与重型Domain Input Schema负向校验并发运行，3项通过、0skip，13.82秒。复验覆盖修正后的helper，但不是修正后的新277文件全量PASS；后续最终冻结版本仍需完整回归。

命令：

```text
node --test --test-concurrency=4 test/helix-architecture/p14-clean-service-entrypoint.test.js test/helix-architecture/capability-contract-validator.test.js test/helix-architecture/p4-bounded-catalog-transition.test.js
node --test --test-concurrency=4 --test-name-pattern="formal node entrypoint starts|rejects contract drift|rejects duplicate registry entries" test/helix-architecture/p14-clean-service-entrypoint.test.js test/helix-architecture/domain-input-schema-validator.test.js
```

仓库外日志`E:/my_project/helix-git-consolidation-20261008/series-architecture-0eea37925.log`、`series-entrypoint-isolated.log`、`series-entrypoint-loaded-recheck.log`及`series-entrypoint-contract-load.log`。完整测试原失败保留，不声称所有skip已覆盖。未部署NAS。

## UI验收衔接

用户本轮明确授权发送并跟进UI负责人验收，已提交冻结SHA`76ed35e32ed5eb404791dd268d46b540cb225485`及7份UI证据。负责人任务`01a0912a-0086-74e2-88ab-536c59d3862a`、验收turn`01a11ac3-56f4-7d73-b690-a9b9995c7319`仍在审查；8项双视口自动测试通过，但补充走查已报告Series TMDB分拣仍提交Movie类型、规则/收藏弹窗焦点与Escape缺口，尚未给UI通过。接续修复必须遵循其正式结论并重新交验受影响版本。

## 修复冻结版本全量通过

2026-10-08，冻结源码`06a8ce7c04f18f22ab30a2433283cf2be2a10392`，Windows Node25完整278文件：2412项、2402通过、0失败、10既有skip，893.98秒，终态exit 0。日志`E:/my_project/helix-git-consolidation-20261008/series-architecture-06a8ce7c0.log`。入口30秒墙钟/单请求1秒上限修复与Stage目录范围修复在完整负载下通过。

该运行已在后续long-media/Aftercare-restart测试编辑前加载对应测试文件；没有运行时业务代码变更，后续新增的显式专项分别记录，不把本次全量覆盖外推到尚未完成的新测试。10skip保持原可选场景语义，并非新失败；Series完整外部替换的合同缺口与生产副本升级/回退、完整用户旅程等门槛仍开放。
