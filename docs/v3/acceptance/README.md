# v3 Acceptance

This directory contains active or recent validation plans and reports.

## Current Files

| File | Purpose |
| --- | --- |
| `KAIROX_FRONTEND_API_E2E_PLAN.md` | Current detailed production Frontend/API E2E plan |
| `KAIROX_FRONTEND_API_E2E.md` | Current E2E report artifact; may be incomplete while a run is paused |

## Rules

- E2E should run stage by stage.
- If a stage fails, stop and diagnose that stage before continuing.
- Do not skip stages to make a later stage pass.
- Do not use old Mirex fields to bypass a Kairox semantic failure.
- Keep production destructive actions scoped to the selected canary item unless the user explicitly authorizes a broader action.
