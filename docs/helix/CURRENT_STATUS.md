# Helix Current Status

Last updated: 2026-07-10

## State

- `Helix = Libra + Nexora + Kairox` is accepted.
- The permanent physical shape is a modular monolith inside `media-service`.
- LibraryMembership belongs to Libra.
- Nexora owns source truth and onboarding/offboarding capability.
- Kairox owns in-library maintenance and maintenanceComplete.
- Archive is removed from the Helix clean runtime; it is neither a gate, target, configuration nor completion condition.
- Physical delete belongs to Nexora execution under Libra authorization; automatic physical delete is prohibited.

## Implementation

Slice 1 is complete. The accepted contract, sole Helix plan/status, Service contracts and project memory now agree on Libra ownership and modular-monolith boundaries.

Slice 2 is complete. In-process Libra/Nexora/Kairox Facades, a single composition root and static dependency tests now exist. The Facades are not yet wired into public runtime behavior.

Slice 3 is complete. Libra now has an owned SQLite Store, LibraryMembership/phase/quarantine/admission facts, idempotent reconcile operations, event evidence, legacy membership migration input, projections and a deterministic Reconciler.

Slice 4 is complete. Emby and adult-folder observations now enter through Libra onboarding, Nexora owns source writes through its Store, SourceProjection carries a monotonic revision, and Nexora no longer writes global Membership.

Slices 5 and 6 are complete. Kairox owns admission snapshots, maintenance projection and maintenanceComplete. Libra source incidents suspend Kairox admission, interrupt active work and fence stale generations at dispatch and mutation checkpoints.

Slice 7 is complete. Public maintenance intents now enter Libra/Kairox, onboarding/offboarding Admin actions exist, library views carry Helix projections, the disposal UI distinguishes retain/detach/delete, Nexora owns physical cleanup, and public Kairox ingest/delete creation returns 410.

Slices 8 and 9 are complete as Service-boundary and controlled-canary evidence. The user selected the NAS production `公共_国产剧` library as a controlled, non-destructive canary instead of a disposable Docker business simulation. `media-desktop` is explicitly deferred to a later completeness refactor and is not part of this thread.

Helix Beta is **in progress**. The previous achieved statement was withdrawn after the completion standard was clarified: a newly created `libraryAutomationMode=auto`, `maintenanceAutomationMode=auto` library must automatically complete Nexora observation/SourceBinding, Libra onboarding/admission and Kairox basedata/metadata/optimize/required-refresh progression to `maintenanceComplete` under bounded shared resources.

Accepted 2026-07-10 rebaseline decisions:

- Automation has two business control loops: Libra Library Automation outside and Kairox Maintenance Automation inside. Nexora is bounded capability work called by the outer loop, not a third business controller.
- Kairox keeps a first-class `basedata` gate replacing ambiguous legacy `ingest`: SourceBinding remains Nexora truth; Kairox Basedata is the mechanical/technical observation used by maintenance.
- Resource Management remains infrastructure rather than a top-level business domain, but a shared Helix Resource Governor must control permits/backpressure across Nexora, Libra and Kairox.
- Kairox approval policy remains distinct from automation policy. Destructive authorization is one type of risk authorization, not a synonym for runtime approval.
- Delete is not a Kairox lifecycle gate. Kairox may publish a disposal recommendation; physical delete is Libra Offboarding `delete_source`, executed by Nexora after authorization and Kairox quiescence.
- Kairox Lifecycle is the sole owner of `nextTargetGate`, gate achievement and `maintenanceComplete`.
- Existing `automationPolicy.js` is the physical Kairox automatic-trigger policy. Existing SmartTaskEngine must become a thin bounded Automation Runner rather than coexist with a new heavy engine.
- Task Scheduler only selects and recovers already-created tasks, enforces item lock/order and dispatches to Resource Runtime. It does not create tasks, interpret gates, read automation modes, choose flows or calculate resource capacity.
- Helix Resource Governor is one process-wide infrastructure singleton outside Libra/Nexora/Kairox. It is the only capacity owner; Kairox Resource Runtime requests its permits per event.
- The clean cut has no runtime/config/API compatibility for `ingest|delete|archive`, old SmartTask fields or old schedule fields. Old state requires explicit clean initialization rather than migration or dual read.

The first attempt at the rebaselined runtime was paused before commit/deploy when the physical Kairox component boundary was challenged. Partial local Basedata/Governor/automation files are implementation work-in-progress, not accepted evidence. In particular, a newly introduced heavy `kairoxAutomationEngine.js` must not survive as a parallel business component; implementation resumes from the reinforced contract and revised Slice 12 order.

Slice 1 evidence:

- Active-contract drift search found no current document still defining `Helix = Nexora + Kairox`.
- `node --test test/kairox-rebaseline-audit.test.js` passed (4 tests).

Slice 2 evidence:

- `node --test test/helix-service-boundary.test.js test/nexora-core.test.js` passed (8 tests).
- Static audit proves only `libraCompositionRoot.js` imports both Helix capability Facades.

Slice 3 evidence:

- `node --test test/libra-core.test.js test/helix-service-boundary.test.js test/nexora-core.test.js` passed (12 tests).
- Migration leaves current media active but in onboarding with `migration_source_unresolved`; it does not silently grant maintenance admission.
- Idempotency-key payload reuse is rejected and explicit delete authorization is enforced before an offboarding operation is accepted.

Slice 4 evidence:

- `npm test` passed all 357 service tests.
- Emby and adult-folder present → missing → recovered projections increment source revision and preserve stable binding identity.
- Static tests forbid mixed legacy services from directly calling Nexora observation writers.

Slice 5 evidence:

- `maintenanceComplete` requires current admission, fresh metadata, a current passed optimize objective, no canonical refresh and no incident; archive is not required.
- The app automatic-task path rejects missing Libra admission and quarantines ingest/delete targets.

Slice 6 evidence:

- `npm test` passed all 363 service tests.
- Admission fence tests cover current, suspended and stale generations.
- Resource dispatch plus transcode/upgrade replace, scrape metadata write, archive finalize and legacy delete mutation checkpoints validate the task generation.

Slice 7 evidence:

- Helix Admin API test covers active projection, retain source, detach source, explicit delete authorization, physical folder deletion, closed membership and manual maintenance rejection after close.
- `node --test test/helix-api.test.js test/api-inject.test.js` passed all 132 tests after legacy API tests were rebaselined.
- Admin Web TypeScript/Vite build passed with Helix media facts and three offboarding actions.

Slice 8 evidence:

- `npm test` passed all 370 Service tests after the maintenance-state ownership correction.
- `npm run build:web` passed the Admin Web TypeScript/Vite production build.
- Static audit confirms only `libraCompositionRoot.js` imports both Nexora and Kairox capability Facades.
- Sublibrary removal is now gated by a Libra batch `retain_source` operation; direct removal with active Membership returns `409 LIBRA_SUBLIBRARY_OFFBOARDING_REQUIRED`.
- The sublibrary batch API forbids `detach_source` and `delete_source`; tests prove retained source files are unchanged.
- Nexora observation can be woken after a runtime source configuration change.
- `helix-data-preflight.js` performs a read-only production schema/count plan before startup migration.
- Production read-only diagnostics on 2026-07-10 confirmed the `shelfdeck` container is absent while compose and runtime data remain present.

Production deployment and canary:

- `公共_国产剧` retain-source offboarding, re-add, 44 current Emby source observations, admission and restart recovery passed without Emby/media mutation.
- The old ShelfDeck configuration contained 46 cached items; the re-added source observed the current Emby inventory of 44 manageable seasons. This was treated as source reality, not silently backfilled from stale ShelfDeck cache.
- All 46 old Memberships completed `retain_source` offboarding and all 44 current observations reached active Membership, source ready, `phase=maintenance` and current Kairox admission.
- Restart recovery preserved all 44 admissions and did not create automatic tasks while the library remained in `manual` / `full_manual` mode with all auto-execution and auto-replace switches disabled.
- One non-destructive Kairox metadata task `8c23743ec5ef903c` completed for item `26e1170d-8540-43e8-87cf-8b531e6da09c`, using admission generation 1. It only read Emby/media state and updated ShelfDeck facts.
- The task exposed and then verified the maintenance ownership correction: Libra remained `phase=maintenance`; the live Kairox projection became `metadataPassed=true`, `optimizePassed=true`, `maintenanceState=complete` and `maintenanceComplete=true` without another media operation.
- Libra startup/periodic reconcile was green after deployment and reconciled 2620 Memberships; GET projection remained side-effect free.
- No optimize/delete task was run. Emby Library configuration, Emby metadata and media files were not modified.

Production build record:

- Production URL: `http://192.168.12.230:18080`
- Image: `markmahoro/shelfdeck:helix-maintenance-state-20260710-1af2afee`
- Source commit: `1af2afee Clarify Helix maintenance state ownership`
- Image tar SHA256: `dd728cd6d725b9cf25c6a4c640632468e5cc543d160a9bb8a87bfe25f28819bb`
- Deployment time: `2026-07-10 15:13 Asia/Shanghai`
- Health: green, including Nexora observation and Libra Reconciler runtime status
- Production E2E: passed within the explicitly authorized non-destructive scope

## Current Runtime Gaps Against Rebaselined Beta

- Nexora observation, Libra reconcile and Kairox SmartTask currently run as three independent timers rather than two explicit business automation loops.
- Nexora observation can scan and commit a whole library without cursor/time budget or a shared resource permit; Libra periodic reconcile can also perform a full Membership scan.
- Current adapters publish Kairox-consumed source facts during onboarding, so there is no independent Basedata Gate on the Helix path.
- Post-optimize canonical refresh can project legacy `nextTargetGate=ingest`, while the Helix admission provider rejects all new ingest tasks. This can prevent full-auto convergence after a mutating optimize flow.
- Current `maintenanceComplete` does not yet require current Basedata.
- Kairox has useful queue caps, resource capacities, item locks and pressure projections, but shared permits/leases do not yet govern Nexora/Libra workloads.
- Current Task Scheduler still reads legacy execution-mode configuration and maintains resource counters. Both responsibilities must move out: automatic-trigger policy belongs to Kairox Automation Policy, while all capacity belongs to the shared Governor.
- Current Automation Policy is still a target allow-list and SmartTaskEngine still mixes scan, policy and resource pressure. They have not yet been refactored to the accepted Policy/Runner boundary.

## Preserved Experimental Evidence

- Existing Nexora fact-model work remains useful input and is not treated as an accepted runtime boundary by itself.
- The focused Nexora/Kairox audit tests passed before Helix implementation started.

## Open Risks

- Legacy Kairox ingest/delete executors remain only for historical/rollback tests; public and automatic Helix paths cannot create them.
- The current deployed image is safe evidence but does not meet the rebaselined full-auto Beta completion standard.
- Existing experimental Nexora Membership migration and legacy schema/config readers must be removed from the clean runtime; production cutover requires a separately confirmed clean initialization.
- Production `detach_source`, authorized `delete_source`, source missing/recovery/rebind and stale-generation fencing were intentionally not exercised against real media. Automated tests cover them; a future production destructive test still requires a separately named episode and explicit authorization.
- The production canary permits ShelfDeck fact/task/config mutations only. Emby Library, Emby metadata and media files remain read-only.
- `media-desktop` still speaks legacy task intent and is intentionally outside this thread.
