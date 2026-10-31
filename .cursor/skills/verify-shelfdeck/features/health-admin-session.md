# Health and Admin session

A user (or agent) confirms the service is alive, exchanges a management credential for an Admin session cookie, and reaches an authenticated Admin setting that proves the session is usable.

## Sub-features

- `health-public` returns public `GET /v1/health` without credentials.
- `session-exchange` turns an API key into `shelfdeck_admin_session` via `POST /v1/admin/session`.
- `session-authed-probe` reads `GET /v1/admin/settings/security` with that cookie only.
- `session-logout` clears the session with `DELETE /v1/admin/session` and confirms cookie-only access fails.
- `admin-web-login` (optional browser) signs in at `/admin` with the same credential.

## How to get to it (user POV)

- Open `http://127.0.0.1:<port>/v1/health` (or curl it) and see a healthy status.
- Open Admin Web at `/admin`. After a 401 expires the shell session, enter the management credential under `管理凭据`, choose `进入管理台`, and land on `概览`.
- Non-browser clients may send `X-Api-Key` once to `POST /v1/admin/session`, then use the HttpOnly session cookie for Admin APIs.

## Driving it with verify-shelfdeck

Preconditions:

- `verify-shelfdeck launch` completed for this run.
- `verify-shelfdeck doctor` passes for `$VERIFY_SHELFDECK_RUN_DIR`.
- Disposable `adminApiKey` exists only in `$VERIFY_SHELFDECK_RUN_DIR/private-runtime.json` (never commit it).

- **Public health.** Run `bash .cursor/skills/verify-shelfdeck/bin/verify-shelfdeck drive health-admin-session`. The drive GETs `{baseUrl}/v1/health`. Expect HTTP 200, `status: "ok"`, a `helix-clean-*` `generation`, and `normalSupplyAllowed: true`.
- **Session exchange.** The same drive POSTs `{baseUrl}/v1/admin/session` with header `x-api-key: <adminApiKey>`. Expect HTTP 204 and a `Set-Cookie` that includes `shelfdeck_admin_session=` (cookie value redacted in evidence).
- **Authed probe (cookie only).** The drive GETs `{baseUrl}/v1/admin/settings/security` with the session cookie and without `x-api-key`. Expect HTTP 200 and `credentialConfigured: true`.
- **Wrong key.** The drive GETs the same security path with `x-api-key: wrong-key` and no session cookie. Expect HTTP 401.
- **Logout.** The drive DELETEs `{baseUrl}/v1/admin/session` with the cookie (expect 204), then GETs security cookie-only again (expect 401).
- **Optional Admin Web.** Open `{baseUrl}/admin`. The login card is not always first paint. Wait until a 401 sets session status to required, then expect heading `进入管理台`, fill label `管理凭据` (the password input has no separate aria-label), click button `进入管理台`, and expect heading `概览`. HTTP proof alone is enough for this feature's first skill proof.
- **Optional runner.** With the same `SERVICE_URL={baseUrl}`, `bash tests/runner.sh health-check tests/env/ci.env` may corroborate reachability. That flow still accepts legacy health colors and is not the Doctor standard for this skill. It does not replace session exchange proof.
- **Proof.** Evidence under `$VERIFY_SHELFDECK_EVIDENCE_DIR` includes `health.json`, `session-exchange.json` (status + cookiePresent, no secret values), `security.json` (masked), `wrong-key.json`, `after-logout.json`, and `proof.json` naming feature id `health-admin-session`.

## Gotchas

- Production NAS (`192.168.12.230:18080`) is never a valid drive target for this skill.
- A process listening is not ready. Wait for health `ok` + `helix-clean-*` generation + `normalSupplyAllowed`, and clean-init `--readiness` `state: ready`.
- Sending `x-api-key` on an Admin GET does not prove the session cookie. Auth prefers a present API key. Cookie-only probes are required.
- Do not store the plaintext API key in browser storage during verification. Prefer session cookie exchange (Helix Admin Web path).
- Legacy `/v1/admin/health` is not part of the Helix clean surface. Do not require it.
- Cleanup must keep evidence. A cleanup that deletes `$VERIFY_SHELFDECK_EVIDENCE_DIR` fails the skill.
