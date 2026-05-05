#!/usr/bin/env bash
# common.sh — shared test utilities for ShelfDeck E2E flow tests
# Uses node for JSON parsing (no jq dependency).

set -euo pipefail

SERVICE_URL="${SERVICE_URL:-http://127.0.0.1:18080}"
PASS=0
FAIL=0

# ── JSON helpers (using node — always available) ────────────────────────

json_get() {
  local expr="$1"
  node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const v=($expr);process.stdout.write(String(v??''))}catch(e){process.stdout.write('')}})"
}

json_field() {
  local expr="$1"
  node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);const v=($expr);process.stdout.write(String(v??''))}catch(e){process.stdout.write('')}})"
}

# ── assertions ──────────────────────────────────────────────────────────

ok() {
  PASS=$((PASS + 1))
  echo "ok ${PASS} - $1"
}

not_ok() {
  FAIL=$((FAIL + 1))
  echo "not ok $((PASS + FAIL)) - $1"
}

assert_eq() {
  local desc="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then
    ok "$desc"
  else
    not_ok "$desc — expected '${expected}', got '${actual}'"
  fi
}

assert_ne() {
  local desc="$1" actual="$2" unexpected="$3"
  if [ "$actual" != "$unexpected" ]; then
    ok "$desc"
  else
    not_ok "$desc — got unexpected '${actual}'"
  fi
}

assert_contains() {
  local desc="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -qF "$needle"; then
    ok "$desc"
  else
    not_ok "$desc — expected to contain '${needle}'"
  fi
}

assert_status() {
  local desc="$1" body="$2" expected="$3"
  local actual
  actual=$(echo "$body" | json_field 'j.status')
  assert_eq "$desc" "$actual" "$expected"
}

assert_ok() {
  local desc="$1" body="$2"
  local ok_val
  ok_val=$(echo "$body" | json_field 'j.ok')
  assert_eq "$desc" "$ok_val" "true"
}

# ── HTTP helpers ────────────────────────────────────────────────────────

GET() {
  curl -fsS --connect-timeout 5 --max-time 30 "${SERVICE_URL}${1}" 2>/dev/null || echo '{"_err":"curl_failed"}'
}

POST() {
  curl -fsS -X POST --connect-timeout 5 --max-time 30 \
    -H "Content-Type: application/json" \
    -d "${2:-{}}" \
    "${SERVICE_URL}${1}" 2>/dev/null || echo '{"_err":"curl_failed"}'
}

PATCH() {
  curl -fsS -X PATCH --connect-timeout 5 --max-time 30 \
    -H "Content-Type: application/json" \
    -d "${2:-{}}" \
    "${SERVICE_URL}${1}" 2>/dev/null || echo '{"_err":"curl_failed"}'
}

DELETE() {
  curl -fsS -X DELETE --connect-timeout 5 --max-time 10 \
    "${SERVICE_URL}${1}" 2>/dev/null || echo '{"_err":"curl_failed"}'
}

# ── polling helpers ─────────────────────────────────────────────────────

wait_for_health() {
  local attempts=0
  while [ $attempts -lt 30 ]; do
    local r
    r=$(GET "/v1/health")
    if echo "$r" | json_field 'j.status' | grep -qE '^(green|yellow|red)$'; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 1
  done
  return 1
}

create_task() {
  local item_id="$1" action_type="${2:-transcode}"
  POST "/v1/tasks" "{\"itemId\":\"${item_id}\",\"actionType\":\"${action_type}\"}"
}

get_task() {
  GET "/v1/admin/tasks/${1}"
}

delete_task() {
  DELETE "/v1/tasks/${1}"
}

poll_task_status() {
  local task_id="$1" expected="$2" timeout="${3:-120}"
  local attempts=0
  while [ $attempts -lt "$timeout" ]; do
    local r status
    r=$(get_task "$task_id")
    status=$(echo "$r" | json_field 'j.status')
    if [ "$status" = "$expected" ]; then
      echo "$r"
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 2
  done
  echo '{"_err":"timeout"}'
  return 1
}

# ── summary ─────────────────────────────────────────────────────────────

done_testing() {
  local total=$((PASS + FAIL))
  echo ""
  echo "1..${total}"
  if [ "$FAIL" -gt 0 ]; then
    echo "# FAILURES: ${FAIL}/${total}"
    exit 1
  else
    echo "# OK: ${PASS}/${total}"
    exit 0
  fi
}
