# ShelfDeck verification map

Maintained source for verifying user-facing ShelfDeck behavior. Read this index, then the matching feature file.

## Baseline preconditions

- Launch via `bash .cursor/skills/verify-shelfdeck/bin/verify-shelfdeck launch` (isolated `127.0.0.1` port + disposable data dir).
- Run `bash .cursor/skills/verify-shelfdeck/bin/verify-shelfdeck doctor` and require the recorded URL, data dir, and process ownership.
- Never drive an instance this run did not start. Never target production NAS (`192.168.12.230:18080`).
- Keep disposable admin API keys in the private run dir only. Do not copy `tests/TEST_ENV_CHECKLIST.md` contents into evidence or commits.
- Platform is Linux / local Node or Linux Docker. Windows is out of scope.

## Driving conventions

- Prefer HTTP handles from SKILL.md for agent runs. Use Admin Web ARIA names when browser-driving.
- Treat every command as literal. Keep quoted names and flags unchanged.
- Restore disposable run state with `cleanup`. Do not remove proof artifacts.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final response.
- HTTP proof includes status, redacted headers, and body fields named in the feature file.
- Mutation proof includes a second read of the resulting state.
- Record the feature ID and entry point in every artifact set.
- Report an unreachable path with the unmet precondition. Do not call a skipped entry point verified through a different path.

## Feature entry contract

Each feature file starts with an H1 and one paragraph of user-visible behavior, then exactly these H2s in order:

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it with verify-shelfdeck`
4. `Gotchas`

## Features

- [Health and Admin session](./health-admin-session.md) covers public health, API-key → Admin session exchange, and an authenticated Admin probe (first proved feature).
- [US Adult recognition journey](./us-adult-recognition.md) covers catalogue recognize → People name bind/create → SelectedImage poster/reference → shelfable `face_catalogue` cast, plus Attention only for real unresolvable cases. Drive with `bash .cursor/skills/verify-shelfdeck/bin/verify-shelfdeck drive us-adult-recognition` (invokes `media-service/scripts/us-adult-full-e2e.sh`). Do not invent a stub-green path. PR #53 must land before claiming L2 green on AJV ingress / Host session lifecycle.
