# ADR 0002: Resource Management Is Engineering Discipline

Status: accepted for Helix / Nexora design.

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
