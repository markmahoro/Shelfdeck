# P5-09 Material Access Handle and Fence Evidence

Status: **PASS / COMPLETE**

Audit date: 2026-07-17

## 1. SSOT traceability

| SSOT contract | Implementation evidence |
| --- | --- |
| §7.6.1 Capability只通过typed handle访问Material | `PhysicalMaterialReadHandle`与`WorkspaceMaterialHandle`从Owner projection签发，冻结Identity、Binding/Workspace revision、Control revision slice、permission、containment、Basis、expiry和Event Fence |
| §4.8.4 / §7.6.1 Related不建立独立Control | Related可签发read-only Physical Handle；Control resolver不会被调用；Primary与Related destructive operation互相不可替代 |
| §8.6.2 / §8.6.18 mandatory nominal handle | 输出严格匹配checked-in Handle schema；Workspace Handle缺少公开expiry字段时，invocation expiry由Foundation authority内部强制，未向schema添加私有字段 |
| §7.5.3 Effect Class不得执行时升级 | catalog的`pure_observation|workspace_write|material_commit|destructive_commit`分别要求read、Workspace scope、Arca Target Commit Slot、Approval/Authorization；不存在通用write |
| §10.8.3 commit-capable filesystem safety | 每次Grant签发和P5-07 adapter dispatch前重新解析Owner projection并调用typed Reality verifier；验证Binding/Control/Auth/Fence revision、relative containment、identity/stat/hash、mount/symlink/root overlap及transaction path |
| §10.8.4 irreversible safety | Input Settlement只接受Event-scoped Approval；Off-deck只接受immutable Authorization；source Handle集合一并交给Authority重验，Grant单次消费且过期拒绝 |

## 2. Implementation result

- `foundation/execution/material-access-authority.js`是无Store的invocation authority；它组合Owner发布的resolver和current
  authority，不拥有或复制Domain Binding、Material Control、Workspace、Approval、Authorization或Target Slot事实；
- Physical Handle签发时冻结exact Domain Binding snapshot、Basis、filesystem expectation及Primary Control revision；使用前再次
  比较完整snapshot，能够拒绝“Control变更后又回到同一Owner”的ABA情形；
- Related reference只有read authority。它不访问Control resolver，也不能进入Primary delete、Input Settlement或Material commit；
- Workspace Handle只允许`read|workspace-write`。cleanup必须使用同一active Workspace的write Handle；新输出只能由受控相对路径
  解析到当前Workspace root，不能输入裸absolute target或`..`；
- Workspace import的Grant同时列出read-only source root与write target root，P5-07仍逐路径执行containment；列出source root不授予
  source mutation，Effect Class和target derivation继续限制写入只发生在Workspace；
- Material commit仅允许Arca、current Target Commit Slot及每个Workspace input的revisioned commit-authority slice；
- Input Settlement Approval与Off-deck Authorization是不同互斥凭据。Approval必须绑定Event；Authorization必须由Arca Owner
  authority按operation及exact source set重验；
- Operation Grant绑定Event、Owner、operation、Effect Class、source/target、controlled roots、authority slices及≤60秒expiry，
  P5-07调用`verify`时再次重验并单次消费；过期、篡改、重复调用或current projection漂移均在adapter effect前失败；
- `PathAuthority.resolveContained`新增跨POSIX/Windows的pure相对路径原语；真实realpath、symlink、mount和same/cross-volume检查
  仍属于注入的Reality verifier，不由字符串工具冒充filesystem Reality。

## 3. Legacy reuse disposition

旧Runtime的Source Access map、Task path helper、全局SourceBinding、raw path payload和Executor内fallback均未导入clean root。
P5-09仅复用P5-03 normalized path primitive、P3 Control authority contract、P4 Event Fence以及P5-07 nominal media-tool ports。
没有旧wrapper、compatibility alias、dual-read/write/run或Runtime fallback。

## 4. Machine evidence

```text
node --test test/helix-architecture/p5-*.test.js
→ 71/71 PASS

P5-09 focused + P5-03/P5-07 integration fixtures
→ 26/26 PASS

npm run test:helix-architecture
→ fixture files: 61
→ packageCount: 47
→ dependency files/dependencies: 53/63；findings: []
→ semantic files: 1435；findings: []
→ P2 aggregate unchanged: bcde76e0d380ead9fbe9c76c6c21293325d2de3dd97144c1357438c3d3cc8530
→ SSOT component digest unchanged: fa27242e59bc670ff351877680d6e41d4905e91a26e2c87a4ef911ae22726aea
→ prohibitedActionsRun: []

npm run test:helix-persistence
→ 156 tables / 72 indexes / 19 partial unique
→ DDL digest: 29a8e6b6c857ab551b25197231ef6e37feb1e5ea4ee469f31d50ba181a4db7b5
→ 18 canonical transactions / 132 crash points
→ prohibitedActionsRun: []

npm run test:helix-runtime
→ 7 Effect Classes / 31 cross-process crash scenarios
→ prohibitedActionsRun: []
```

Negative fixtures cover broad physical permission、wrong Owner、Related→Primary escalation、stale Binding/Control/Fence/Workspace/
Target/Auth、ABA Control revision、scope escape、read-only cleanup、wrong Approval/Authorization family、commit authority drift、Grant
tamper/expiry/replay、Reality drift，以及Domain Store/filesystem/process/legacy dependency。

## 5. Boundary and safety proof

- Owner resolvers、Control/Auth authorities和Reality verifier全部为deterministic fakes；没有访问真实filesystem或媒体；
- 没有运行E2E、Docker、service startup、FFmpeg/FFprobe、网络、Worker、production或`media-desktop`；
- 没有新增Persistence table、global Material ID、cross-domain Store或第二个Control/Fence Owner；
- SSOT未修改，component digest保持不变。

## 6. Decision

P5-09 satisfies Done。P5-10可以把P5-01–P5-09的registries、handles、ports、redaction、containment和synthetic
protocol wiring收束为一个cross-platform isolated verification command；不得在该Harness中接入真实媒体、副作用或旧Runtime。
