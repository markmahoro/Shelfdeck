# ShelfDeck Release Goals

Last updated: 2026-07-08

本文档记录 Kairox 阶段的 release goal closure，并为后续 Nexora release goal 留出重新定义空间。

## Current Rule

Kairox release line is closed.

`Kairox Beta` is the only accepted Kairox release goal. The previously planned post-Beta Kairox goals are cancelled and must not be used as active roadmap or implementation scope.

Nexora will define its own release goals after its architecture boundary is accepted.

## Kairox Closure State

| Goal | Status | Meaning |
| --- | --- | --- |
| `Kairox Beta` | Achieved | Transitional Kairox architecture proved the in-library management chain on a production sample |
| `Kairox Usable` | Cancelled | Superseded by Nexora architecture reset |
| `Kairox Performance` | Cancelled | Superseded by Nexora architecture reset |
| `Kairox GA Candidate` | Cancelled | Superseded by Nexora architecture reset |
| `Kairox GA` | Cancelled | Superseded by Nexora architecture reset |

## Kairox Beta

### Goal

Kairox Beta proved the Kairox business chain in production:

```text
media facts + user perception
-> lifecycle objective / gate projection
-> targetGate task
-> Flow Planner selection
-> Resource Runtime execution
-> gate facts
-> archive
-> delete review
```

### Acceptance Result

Accepted on 2026-07-08.

Production Frontend/API E2E Stage 0-15 passed on the canary item:

```text
公共 国产剧库 / 81945 / 爱很美味 / Season 1
```

The accepted evidence is recorded in:

```text
docs/v3/acceptance/KAIROX_FRONTEND_API_E2E.md
```

### Historical Value

Kairox leaves durable engineering assets:

- task identity as `object + targetGate + gateObjective`.
- Flow Planner owning implementation path selection.
- TaskAdmission as the unified creation gate.
- Resource Runtime as the first resource-event execution layer.
- canonical facts, staged facts, event evidence, and fact freshness separation.
- delete review separated from optimize flow.

### Known Limitation

Kairox Beta proved the In-Library Lifecycle chain. It did not settle ShelfDeck's full business architecture.

The final production automation audit found that Onboarding and Offboarding were not modeled clearly enough:

- `source_missing` items could repeatedly consume automatic `targetGate=ingest` creation capacity.
- `delete` mixed source destruction and leaving ShelfDeck management.
- Resource Runtime remained lifecycle-first instead of global.

These limitations are not Kairox Beta blockers. They are architecture inputs for Nexora.

## Cancelled Kairox Goals

The following sections are intentionally not retained as future requirements:

- `Kairox Usable`
- `Kairox Performance`
- `Kairox GA Candidate`
- `Kairox GA`

Do not quote old archived descriptions of these goals as current acceptance criteria.

If similar user-value stages are needed later, define them under Nexora with new names, new scope, and new acceptance criteria.

## Nexora Placeholder

Nexora is the next-generation ShelfDeck business architecture.

Nexora release goals are not defined yet. They should be created only after the Nexora architecture contract has settled the business domains:

```text
Onboarding
In-Library Lifecycle
Offboarding
Global Resource Management
```

Until then, the project has no active post-Kairox release goal.
