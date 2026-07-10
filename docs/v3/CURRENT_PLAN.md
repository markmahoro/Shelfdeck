# ShelfDeck v3 Current Plan

Last updated: 2026-07-08

## Current Objective

Close and archive the Kairox phase.

`Kairox Beta` has been accepted as achieved. The production Frontend/API E2E run passed Stage 0-15 on the canary item, and the Kairox Beta production runtime was intentionally taken down and cleaned up after acceptance.

There is no active Kairox implementation plan after this closure.

## Kairox Closure

Kairox is now a completed transitional architecture phase. It remains useful as engineering legacy and implementation evidence, especially for:

- `object + targetGate + gateObjective` task identity.
- Flow Planner separation from task identity.
- canonical facts / staged facts / event evidence separation.
- TaskAdmission discipline.
- Resource Runtime as the prototype for resource-event execution.

Kairox no longer defines ShelfDeck's future full business architecture.

The previously planned post-Beta Kairox goals are cancelled:

- `Kairox Usable`
- `Kairox Performance`
- `Kairox GA Candidate`
- `Kairox GA`

These names must not be used as future worktree scope, release goal, roadmap title, Docker image milestone, or product acceptance target.

## Nexora Handoff

The next architecture is named `Nexora`.

Nexora is not yet an active implementation plan. Before implementation starts, it must define its own architecture contract, release goals, status, and acceptance boundary.

Nexora design should start from a clean business architecture boundary instead of extending Kairox lifecycle-first assumptions:

```text
Onboarding
In-Library Lifecycle
Offboarding
Global Resource Management
```

Kairox documents may be used as historical input, but they must not override Nexora once the Nexora contract is written.

## Active Evidence

Kairox Beta evidence remains in:

```text
docs/v3/acceptance/KAIROX_FRONTEND_API_E2E_PLAN.md
docs/v3/acceptance/KAIROX_FRONTEND_API_E2E.md
docs/v3/acceptance/KAIROX_PRODUCTION_AUTOMATION_AUDIT.md
```

The production automation audit is follow-up evidence, not a Kairox Beta blocker. Its findings should be reinterpreted during Nexora design, especially the `source_missing` ingest loop and the `delete` / source-destruction boundary.

## Explicit Non-Goals

- Do not implement new runtime changes as part of Kairox closure.
- Do not start `Kairox Usable`, `Kairox Performance`, `Kairox GA Candidate`, or `Kairox GA`.
- Do not create a `Kairox Governance` architecture or release goal.
- Do not create another active v3 plan document.
- Do not use archived Kairox or v3.x roadmap documents as implementation guidance.
- Do not carry Kairox's lifecycle-first `ingest/delete` boundary into Nexora without explicit redesign.

## Next Recommended Action

Start Nexora architecture design in discussion first.

When Nexora boundaries are accepted, update the existing current documents instead of creating parallel active plans:

- `docs/v3/CURRENT_PLAN.md`
- `docs/v3/CURRENT_STATUS.md`
- `docs/v3/RELEASE_GOALS.md`
- `docs/v3/VERSIONING.md`
- architecture contract / ADR documents as needed
