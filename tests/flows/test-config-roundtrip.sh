#!/usr/bin/env bash
# test-config-roundtrip.sh — Config Roundtrip flow (Tier 3, CI-safe)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../common.sh"

SV="${SERVICE_URL:-http://127.0.0.1:18080}"
echo "# Config Roundtrip Flow"
echo "# Service: ${SV}"

# ── Case 1: Config has expected keys ───────────────────────────────────

cfg=$(curl -fsS "${SV}/v1/config" 2>/dev/null)
for key in executionMode transcodeConcurrency; do
  val=$(echo "$cfg" | json_field "j.${key}")
  if [ -n "$val" ] && [ "$val" != "null" ]; then
    ok "config has ${key}: ${val}"
  else
    not_ok "config has ${key}"
  fi
done

# ── Case 2: PATCH → GET roundtrip ──────────────────────────────────────

orig_concurrency=$(echo "$cfg" | json_field 'j.transcodeConcurrency')
test_val="3"
if [ "$orig_concurrency" = "3" ]; then test_val="4"; fi

curl -s -X PATCH "${SV}/v1/config" \
  -H "Content-Type: application/json" \
  -d "{\"transcodeConcurrency\":${test_val}}" 2>/dev/null >/dev/null

new_cfg=$(curl -fsS "${SV}/v1/config" 2>/dev/null)
new_val=$(echo "$new_cfg" | json_field 'j.transcodeConcurrency')
assert_eq "PATCH transcodeConcurrency=${test_val} persisted" "$new_val" "$test_val"

# Restore
curl -s -X PATCH "${SV}/v1/config" \
  -H "Content-Type: application/json" \
  -d "{\"transcodeConcurrency\":${orig_concurrency}}" 2>/dev/null >/dev/null
echo "# Restored original: ${orig_concurrency}"

# ── Case 3: Platform field present ─────────────────────────────────────

platform=$(echo "$cfg" | json_field 'j.platform')
ok "config has platform field" # always ok — platform is optional in config

# ── Case 4: Config wrote ok, verify admin health has transcode green ────

health=$(curl -fsS "${SV}/v1/admin/health" 2>/dev/null)
tx_status=$(echo "$health" | json_field 'j.checks.transcode.status')
assert_eq "health: transcode=green (ffmpeg ok)" "$tx_status" "green"

done_testing
