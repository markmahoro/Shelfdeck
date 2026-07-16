# Nexora Work Threads

> 2026-07-12 superseded scope: 本文仅作旧Nexora实施切片记录。Nexora现在只属于Libra
> Pre-deck组织，整个ShelfDeck的当前业务结构以`../ARCHITECTURE.md`为准。

Status: paused historical execution plan.

Last updated: 2026-07-09

The previous Nexora execution plan used three threads:

```text
1. Nexora Core + Nexora E2E
2. Nexora + Kairox Integration
3. Full Business E2E
```

This plan is paused and must not be used as the active implementation sequence.

## Why This Plan Is Paused

The three-thread plan assumed:

```text
Helix = Nexora + Kairox
```

The later discussion found that this misses a top-level Library Management owner. Without that owner, Nexora and Kairox integration risks becoming a tick-tock coordination problem:

```text
Nexora projects source eligibility
Kairox consumes it later
Kairox reports source incident
Nexora diagnoses it later
```

The current draft direction is:

```text
Helix = Libra + Nexora + Kairox
```

Where:

```text
Libra  = Library Management / orchestration / reconciler
Nexora = source / binding / membership capability
Kairox = objective-based maintenance capability
```

This is a discussion draft, not an accepted architecture contract.

## Parked Thread Summaries

### 1. Nexora Core + Nexora E2E

Original goal:

```text
Build Nexora facts and source validity, then pass Nexora-only E2E.
```

Parked status:

- Fact-model work produced useful experimental evidence.
- Do not continue from this thread until Nexora Service boundaries are accepted.

### 2. Nexora + Kairox Integration

Original goal:

```text
Make Kairox automatic task creation depend on Nexora eligibility.
```

Parked status:

- Do not implement this as a direct Nexora -> Kairox eligibility bridge.
- Re-discuss it as Library Management orchestration after Nexora/Kairox service contracts are clear.

### 3. Full Business E2E

Original goal:

```text
Prove the complete Nexora + Kairox business flow.
```

Parked status:

- Full E2E must be redesigned around onboarding / maintenance / offboarding.
- Maintenance should be proven through Kairox objective-based `maintenance complete`, not through source admission or old `archive` assumptions.

## Next Work

Do not open Thread 2 from the paused plan.

Next discussion should define:

```text
1. Nexora Service contract
2. Kairox Service contract
3. Then Libra / Library Management reconciler contract
```

## Common Report Format

If a future Helix thread resumes after the service boundaries are accepted, completion reports should still include:

```text
Scope
Changed files
Contract impact
Legacy impact
Audit evidence
Open questions
```
