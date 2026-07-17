# P5-07 Filesystem、Hash、Probe and FFmpeg Protocol Evidence

Status: **PASS / COMPLETE**

Audit date: 2026-07-17

## 1. SSOT traceability

| SSOT contract | Implementation evidence |
| --- | --- |
| §7.5.2 one Capability has one independently recoverable effect | observation、Workspace write、Material commit and destructive commit use separate nominal ports and operation atoms |
| §7.5.3 Effect Class cannot escalate during execution | 20 catalog rows bind one exact Capability ref、port and immutable Effect Class；cross-port invocation is rejected before adapter dispatch |
| §8.5.6 external filesystem/process effects use Effect Journal semantics | every non-pure result is an exact P4 Effect Receipt bound to effect ID、idempotency key、intent digest and verification digest |
| §8.5.7 filesystem space is responsibility-scoped | an expiring verified Operation Grant freezes controlled roots and exact source/target locations；every path must remain contained |
| §8.6.3 / §8.6.7 probe/hash/transcode contracts | filesystem identity/layout、full SHA-256、FFprobe summary、frames、remux and transcode have closed typed atoms |
| §8.6.10 Inventory and On-deck contracts | target slot、staging、atomic placement switch and destructive settlement/delete cannot execute through Workspace write |
| §8.3.5 ResourceGovernor is the only capacity Owner | protocol does not create an FFmpeg pool、queue、semaphore or fallback device selector |

## 2. Protocol result

- the operation catalog contains 20 unique versioned operation IDs and reverse-validates every row against the checked-in Capability
  manifest's exact `capabilityRef` and `effectClass`；
- P5-01's port audit found a real implementation omission: `WorkspaceFileEffectPort(workspace_write)` cannot legally carry Arca
  `material_commit` or `destructive_commit`. Two exact ports were added, with no alias or legacy route；
- Operation Grants bind event、Owner、operation、Effect Class、authority digest、expiry、controlled roots and exact source/target paths；
- every non-pure request recomputes its immutable intent digest over Capability、operation、Effect、event、grant、authority、paths and
  closed profile before dispatch；
- FFprobe and FFmpeg receive fixed executable identity plus argv arrays only. Callers cannot provide executable、shell string、raw argv、
  filter graph or overwrite flag；FFmpeg atoms use explicit `-n`；
- typed profiles use bounded allowlists for containers、codecs、rate-control、dimensions、bitrate and frame samples；
- process stdout/stderr and filesystem evidence are bounded；probe JSON is normalized and digest-verified；errors are redacted；
- non-pure results match P4 Effect Journal receipt fields and do not claim Business completion or write Domain Facts。

## 3. Legacy reuse disposition

旧`services/transcodeService.js`与`transcodeDevicePlan.js`未导入clean root。前者把直接`fs`/`child_process`、环境变量及
bundled binary探测、自建device pool、旧Task恢复、fallback、probe、encode和文件替换混在一起；后者仍包含内部fallback
attempt选择。可复用的只有“remux/transcode参数需要有界映射”这一底层意图，已重新表达为closed profile和固定argv atom。
没有wrapper、dual path、旧Runtime fallback或旧并发Owner。

## 4. Machine evidence

```text
node --test p5-media-tool-protocol.test.js + p5-public-ports.test.js
→ 13/13 PASS（9 protocol counterexamples + 4 nominal-port fixtures）

npm run test:helix-architecture
→ fixture files: 58
→ packageCount: 47
→ dependency files/dependencies: 49/60；findings: []
→ semantic files: 1430；findings: []
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

Machine counterexamples cover wrong port/Capability/Effect、pure/non-pure binding confusion、stale/rejected grant、path escape、
source overwrite、open profile/raw argv、wrong authorization scope digest、intent drift、invalid probe JSON/digest、unbounded process
result、adapter error leakage and direct process/filesystem/legacy imports。

## 5. Boundary and safety proof

- all process and filesystem adapters were deterministic fakes；no installed FFmpeg/FFprobe was invoked；
- no real media、production data、ambient credential、network、service startup、E2E、Docker or deployment was touched；
- no Adapter imports Domain Repository、writes Domain Fact、selects Business outcome or owns Resource capacity；
- SSOT and `media-desktop` were not modified。

## 6. Decision

P5-07 satisfies Done. P5-08 may supply validated device/Resource and passive Worker handles to these atoms；it must not reintroduce an
FFmpeg-local capacity pool、automatic device fallback、generic process command or Worker-owned Work queue。
