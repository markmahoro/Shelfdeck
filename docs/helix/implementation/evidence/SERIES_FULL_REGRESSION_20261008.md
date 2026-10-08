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

## b78e48d9f后服务总回归修复

2026-10-08，变更前`npm --prefix media-service test`619项中579通过、13失败、27skip。逐项定位后：

- 5个页面源码断言仍要求已经由UI负责人接受版本移除的说明文案或Movie-only文案。对齐现有Series/Movie展示，继续验证后端Plan消费、不可用状态、真实评分日志读取与不触发同步；未修改页面代码或把过时文案加回产品。
- 2个Setup Readiness测试仍要求已被SSOT §9取消的全自动/关键步骤模式。改为验证持续结算授权、实际配置就绪、Provider缺失及Off-deck授权独立；未改变产品合同。
- 3个PROD-064测试的fixture按旧19列写Inventory，新表含21列。fixture改显式列；其中实际工具也使用旧19列写法，修正为显式21列并保留Artifact Scope字段。仍限定原13个incident IDs、原路径/事实/Control保护与幂等条件，隔离执行，没有运行NAS事故工具。
- 1个Quarantine fixture未给Offload互斥映射任一合法variant，现补正式单目标；保留“被引用材料不得隔离”的负向断言。
- 1个瑕疵准入fixture缺正式Spec的recordDigest，补齐输入；保留预览装饰不改变准入identity与CAS检查。
- 1个评分完整Host缺旧输入持续清理授权。经正式API设置隔离授权；保留数据库证明首次dispatch后批准已存在、事件按正常30秒input重试等待，原30秒helper先到期。仅把该helper墙钟预算改90秒，未改产品重试策略。评分Host Windows3项通过（52.54秒），验证五次评分及重启不重开既有Run。

修复后完整Windows服务619项：592通过、0失败、27既有skip，138.18秒，exit0。Linux Node20相关7文件58项全部通过、0skip，89.05秒。P2/diff检查通过。此次运行代码与测试冻结到本批提交；日志位于仓库外：`series-service-full-repaired.log`、`series-service-fixture-repair-linux.log`、`series-service-perception-repaired.log`、`series-service-repair-p2.log`；原失败和中间诊断日志保留。

另收取较早启动的`series-architecture-bfefd19ae.log`：2416项、2405通过、0失败、11skip，1091.16秒；期间进行了EpisodeDelivery源码修改及派生合同重建，不能视为bfefd19ae或本批最终冻结SHA的全架构发布Gate。

本批只改测试、历史事故工具及文档，未改Admin产品UI，不新增UI验收请求；Linux脚本/测试已验证，未重新构建服务镜像或Desktop。此前精确版本UI接受不自动扩张到未验证路径。外部后加工/进程恢复及最终发布资格仍开放，未部署生产。
