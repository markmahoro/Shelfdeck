# ADR 0002: Resource Management Is Engineering Discipline

Status: amended by the accepted Helix Beta automation rebaseline on 2026-07-10.

Date: 2026-07-08

## Context

Earlier Nexora drafts proposed a top-level resource-governance domain with durable owner-domain ResourceEvents. During design review, this was judged too broad for the immediate architecture goal.

Kairox already has internal resource handling for in-library heavy operations. Nexora source observation can be handled as a lightweight Source Management cycle with debounce/backoff. A top-level resource domain would add indirection before a real cross-domain resource conflict is proven.

## Decision

Resource management is a Helix engineering discipline, not a top-level business domain.

Rules:

- Nexora owns lightweight source observation and binding validity updates.
- Kairox owns its existing heavy in-library task/resource runtime.
- Expensive, destructive, or globally contended operations must use shared engineering guardrails.
- Resource evidence never directly changes Membership, SourceBinding, or Kairox lifecycle state.

## Consequences

- No Nexora work thread is dedicated to a top-level resource-governance domain.
- Existing Kairox resource runtime remains Kairox-owned unless a concrete shared-resource conflict requires extraction.
- Destructive source cleanup still needs authorization, idempotency, and evidence.
- Source observation frequency and debounce are Nexora design concerns.

## 2026-07-10 Amendment

The full-auto Beta definition proves the concrete shared conflict anticipated above: whole-library Nexora observation and Libra reconciliation can run while Kairox metadata/optimize tasks consume Emby API, filesystem I/O, CPU/worker capacity and SQLite writes.

Resource Management remains an engineering discipline rather than a top-level business domain. However, shared capacity/permit/lease/backpressure logic must now be extracted into a Helix Resource Governor used by both automation layers. Nexora and Kairox retain their business work semantics; resource evidence still cannot change domain facts.
