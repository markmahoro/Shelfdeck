# US Adult recognition journey

A western_adult title is recognized through the catalogue path: actor name lands, People reuses or creates the Person (name-first), a SelectedImage poster/reference is admitted, and the shelfable `face_catalogue` cast is what On-deck consumes for video + poster. Attention appears only for real unresolvable end states — never as a mid-pipeline false positive.

## Sub-features

- `catalogue-recognize` qualifies a catalogue winner (or decisive local identity) for a western_adult subject.
- `people-name-reuse` binds an existing Person by name (including light spelling, e.g. May→Mai); face is not the People match key.
- `people-not-found-create` creates a Person when name resolution is `not_found`, with ThePornDB-preferred image evidence when unique, else Host catalogue frame proof.
- `post-observe-settlement-continuation` after `qualified_candidate`, Host Formation continues into decision / ensure / People bind (or fail-closed Attention) — never workless `PEOPLE_CATALOGUE_PROVIDER_PENDING` idle with no decision, no ensure Work, and null Formation issue.
- `selected-image-ingress` stages a `PeopleSelectedImageHandle` that real AJV admits into `people.reference_asset.import` (nominal provenance: `source` + optional `sourceObjectId` only; `catalogue_frame` is a legal source).
- `host-buffalo-session-lifecycle` releases Event CPU sessions on Host success paths (catalogue frame/observe `finally` stop; People single-face prep is model-only).
- `shelfable-cast` settles to a `face_catalogue` cast that `assertRequiredUsAdultActor` accepts (the actor fact On-deck shelf video+poster consume).
- `attention-only-when-unresolvable` keeps Formation out of product-identity Attention while catalogue observe, local match, or People prep is still open; Attention is only for closed unmatched / truly unresolved end states. Silent post-observe idle (no prep Work, no decision) is **not** an acceptable mid-pipeline state — it is the hang class below.

## How to get to it (user POV)

- Configure a western_adult Material Field and start (or Resume) Formation for a title whose actor is in (or creatable via) the US Adult catalogue path.
- Happy: system recognizes the actor, reuses or creates the Person under People, attaches poster/reference evidence, and the title becomes shelfable for On-deck Commit (video + poster).
- Non-happy: only when the path is truly stuck at an unresolvable end state does Admin show Attention asking for confirmation — not while observe/match/prep is still running, and not for May/Mai-style name reuse or Lea-class qualified coverage.

## Claim ↔ evidence (Drive must be same-width as Happy)

| Claim | Fail-able gate evidence (in `us-adult-full-e2e.sh`) |
| --- | --- |
| `catalogue-recognize` | `us-adult-catalogue-assessment` + full-e2e recognition |
| `people-name-reuse` | `us-adult-catalogue-settlement-register` (May→Mai / reuse) |
| `people-not-found-create` | registration + registration-host / admission |
| `post-observe-settlement-continuation` | `us-adult-post-observe-settlement-hang` — fixture `post_qualified_workless_provider_pending` |
| `selected-image-ingress` | SelectedImage AJV + registration-host staging |
| `host-buffalo-session-lifecycle` | cpu-session-stop + host-wiring |
| `shelfable-cast` | actor-package + settlement → `face_catalogue` |
| `attention-only-when-unresolvable` | formation-attention-western (+ hang fixture forbids silent idle) |

Do **not** narrow Happy to match a thinner Drive. If a claim lacks a fail-able gate, deepen Drive before merge-ready.

## Driving it with verify-shelfdeck

Preconditions:

- Repo checkout includes `media-service/scripts/us-adult-full-e2e.sh` (or the current equivalent npm script `test:us-adult-full-e2e`).
- `cd media-service && npm install` already done (native modules such as `better-sqlite3` must load; missing deps are an environment gap, not a journey weaken).
- Linux / local Node ≥ 20. No production NAS. No stub or observe-isolation-only substitute.
- **Layer note.** This drive is the agent-map entry for the **true simulated full gate** (layer 2 companion). It does **not** require `verify-shelfdeck launch` (the gate is in-process `node --test`, not HTTP against a live Admin session). `launch`/`doctor` remain required for Admin HTTP features such as `health-admin-session`.
- **PR #53 dependency.** Claiming L2 green for SelectedImage AJV ingress and Host buffalo session lifecycle requires PR #53 (`cursor/us-adult-post52-prep-stuck-d7a6`) — or an equivalent merge into main — so the shell gate lists those tests and the product seams pass. On tip without #53, run the current script honestly and do **not** claim those ingress seams green.

- **Primary drive.** Run `bash .cursor/skills/verify-shelfdeck/bin/verify-shelfdeck drive us-adult-recognition`. The drive invokes exactly:

```bash
cd media-service && bash scripts/us-adult-full-e2e.sh
```

  Equivalent: `cd media-service && npm run test:us-adult-full-e2e`. Do not replace with `us-adult-catalogue-observe-isolation-e2e` alone, unit proxies, or a invented stub-green path.

- **Happy expectations (must appear in the gate suite).** Catalogue qualify → name reuse **or** not_found create → settled `face_catalogue` cast → package actor guard. Fuzzy May→Mai reuses without `registerCataloguePerson`. Create path stages real SelectedImage evidence (provider bytes preferred; frame when required). Post-observe settlement must continue into decision / ensure Work / People bind (or fail-closed Attention) — not stall on workless provider pending.

- **Non-happy expectations.** Formation Attention tests prove open catalogue frame work, in-progress observation, open People image prep, and open local analysis do **not** raise product-identity Attention; closed match without a winner may Attention as unmatched / unresolved. No May/Mai false miss; no Lea-style pseudo insufficiency when coverage qualifies. Workless `PEOPLE_CATALOGUE_PROVIDER_PENDING` after `qualified_candidate` with 0 decisions / 0 ensure ops / null Formation issue is a **defect hang**, not an acceptable non-happy or mid-pipeline state.

- **Ingress expectations (when #53 gate files are present).** After real `assembleEvidence` / admission staging, `validator.validate(PeopleSelectedImageHandle)` accepts the staged handle; undeclared provenance extras stay rejected. Catalogue Host factories call `stopSession` in `finally` on success; People buffalo prep does not attach the catalogue index for model-only work.

- **Post-observe settlement hang (fixture `post_qualified_workless_provider_pending`).** Stub catalogue provider observation to `{ kind:'waiting', pendingCode:'PEOPLE_CATALOGUE_PROVIDER_PENDING' }` with **no** `workId` (tip ThePornDB HTTP 5xx silent-catch shape). After `qualified_candidate`, tip settlement/product stays pending without Work, writes **no** decision, opens **no** People image op, and Formation western issue stays **null**. The gate suite **must fail** that compound idle on unfixed tip (RED-first). GREEN later requires fail-closed Attention, durable `workId` pending, or provider failure that does not silent-swallow — product fix PR, not this map alone.

- **Proof.** Evidence under `$VERIFY_SHELFDECK_EVIDENCE_DIR` includes `e2e-log.txt` (full runner output), `e2e-summary.json` (exitCode, successLinePresent, test file list when parseable), and `proof.json` naming feature id `us-adult-recognition` and entry point `media-service/scripts/us-adult-full-e2e.sh`. Expect exit 0 and a success line containing `Attention gate passed` (current script) or the documented success string of the current equivalent — **only after** the hang fixture and all Happy claims are green. On tip with the hang class present, Drive must exit non-zero.

- **Optional Host file proof.** When `SHELFDECK_FACE_MODEL_ROOT` and `SHELFDECK_FACE_TEST_IMAGE` are set, Host formation-host may additionally cover real `mkv` + `nfo` + `poster.jpg`. Absence of those pins is an honest skip, not a green claim for live shelf file write.

- **Production.** Production NAS is diagnosis-only for this journey. Never use this drive against `192.168.12.230:18080`. Do not deploy, Reset, or mutate production from this skill.

## Gotchas

- **RED-first.** Before treating a product fix as proven, the deepened gate must **fail** on tip with the known hole present (no product fix). Post-#52 dig classes: SelectedImage / provenance AJV reject on legal `catalogue_frame` or extra provenance fields; Host Event CPU session not released on success (hung prep / session pressure). Post-#59 hang class: **`post_qualified_workless_provider_pending`** (observe → qualified → workless ThePornDB `PROVIDER_PENDING` → 0 decisions / 0 ensure Work / Formation idle). A gate that only goes green after the fix, without a prior RED on the unfixed tip, is a placebo — reject it (see nail-pulling retrospective / post-52 red-green evidence).
- **Map Happy stays wide.** Do not shrink Happy to “observe only” or “settlement coordinator unit only”. Widen Drive/gates until each Happy claim has a fail-able gate; claim↔evidence required before merge-ready.
- **No stub-only green.** Observe-isolation E2E, schema-copy alone, or Host wiring stubs without the full shell list are not acceptance for this feature.
- **PR #53 before L2 ingress green.** Map landing ≠ claiming AJV/session L2 green. Land or merge #53 (true E2E ingress + product seams) with or before that claim.
- **Attention false positives.** Mid-pipeline `us_adult_catalogue_unresolved` Attention is a defect relative to this journey, not an acceptable non-happy outcome. Conversely, post-observe workless provider pending with null issue is a defect hang, not “still organizing”.
- **Name-first.** People bind/create matches on name (fuzzy allowed). Buffalo reference images are evidence for create/import, not the Person match key. Do not reintroduce `buffalo_reference_required` as a hang gate for name-bound Persons.
- **Production is diagnosis-only.** Digs and read-only verify on NAS may motivate gate deepening; they never replace RED-first isolation proof, and this skill never authorizes production write/deploy.
- **Evidence must survive cleanup.** Keep `$VERIFY_SHELFDECK_EVIDENCE_DIR` outside the disposable run dir. No API keys or `TEST_ENV_CHECKLIST` secrets in artifacts.
