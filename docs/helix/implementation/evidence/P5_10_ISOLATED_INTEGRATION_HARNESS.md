# P5-10 Cross-platform Isolated Integration Harness Evidence

Status: **PASS / COMPLETE**

Audit date: 2026-07-17

## 1. SSOT and work-package traceability

| Contract | Implementation evidence |
| --- | --- |
| P5-10 one local isolated verification command | `npm run test:helix-platform` executes the exact ten P5 fixture families plus accepted P4 cross-process recovery |
| §7.4.1 / §7.6.5 durable recovery | harness reuses the P4 crash worker and Effect reconciliation matrix；it does not create a second Runtime or recovery model |
| §7.5.3 / §7.6 Effect and Material boundaries | fixture set covers nominal ports、Secret、Location、Identity、Artifact、Provider、media tools、Resource/Worker and Material Access Fence |
| P5-10 staged/observed/promoted/receipt crash boundaries | four named boundary projections map to accepted P4 crash points and each converges with exactly one fake dispatch |
| §10.8 security boundary | runner accepts only an exact local fixture allowlist and an owned OS temp root；no service startup、port bind、credential、network、real binary or non-temp media path |

## 2. Harness result

- one Node command works through `process.execPath` and `path.join` on Windows/POSIX without Bash assumptions；
- exact fixture allowlist covers all P5-01–P5-09 implementation families. Missing、extra or escaped fixture paths fail closed；
- the harness uses an owned `os.tmpdir()` directory and deletes it in `finally`；service root or arbitrary database roots are rejected；
- P4's already accepted cross-process crash worker remains the only recovery verifier. P5 adds no Effect Journal、scheduler、retry or
  reconciliation state；
- the four P5 boundary views are:
  - `workspace_staged` → `workspace_write/after_fake_effect` → `continue_forward`；
  - `workspace_observed` → `workspace_write/after_observation` → `continue_forward`；
  - `material_promoted` → `material_commit/after_fake_effect` → `already_committed`；
  - `external_receipt` → `external_request/after_fake_effect` → `already_committed`；
- every boundary requires `dispatchCount=1`. Missing scenario、wrong decision or duplicate dispatch fails the command；
- output is one bounded JSON receipt with fixture count、scenario count、boundary decisions and `prohibitedActionsRun=[]`。

## 3. Machine evidence

```text
npm run test:helix-platform
→ scope: P5_LOCAL_CROSS_PLATFORM_ISOLATED_INTEGRATION
→ exact P5 fixture families: 10
→ accepted P4 recovery scenarios: 31
→ named P5 recovery boundaries: 4
→ every named boundary dispatchCount: 1
→ prohibitedActionsRun: []

node --test p5-integration-verifier.test.js
→ 4/4 PASS

npm run test:helix-architecture
→ fixture files: 62
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

Negative fixtures cover wrong temp root、wrong fixture set、missing recovery boundary、wrong recovery decision、duplicate dispatch，
以及product startup、port binding、ambient provider credential、shell、Docker、legacy Runtime、real FFmpeg/network imports。

## 4. Safety and legacy disposition

- only synthetic probes/transports/secrets/paths and owned temporary SQLite/ledger files were used；
- no E2E、service startup、Docker、network、real Worker、FFmpeg/FFprobe、real media、production or `media-desktop` action occurred；
- harness does not import old Task/Kairox Runtime and does not become a production startup or compatibility path；
- SSOT was not modified。

## 5. Decision

P5-10 satisfies Done。P5-11 must audit the complete P5 changed-path set、SSOT traceability、machine counterexamples、legacy disposition、
protected paths and all aggregate gates before P5 may be archived and P6 opened。
