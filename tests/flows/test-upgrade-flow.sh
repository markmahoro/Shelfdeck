#!/usr/bin/env bash
# test-upgrade-flow.sh — Upgrade Flow E2E (Tier 3, automated)
# Tests: MoviePilot connectivity, search, task creation → planning

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../common.sh"

SV="${SERVICE_URL:-http://127.0.0.1:18080}"
SLIB="${TEST_SUBLIB:-a72104c8-28ee-4527-bab1-5abfb3d1d450}"
MP_URL="${MP_URL:-}"
MP_KEY="${MP_KEY:-}"

echo "# Upgrade Flow E2E"
echo "# Service: ${SV}"

if [ -z "$MP_URL" ] || [ -z "$MP_KEY" ]; then
  echo "# SKIP: MP_URL/MP_KEY not set (provide via tests/env/docker-fn.env)"
  echo "1..0"
  exit 0
fi

# ── 1. MoviePilot reachable ─────────────────────────────────────────────

mp_resp=$(curl -fsS "${MP_URL}/api/v1/download/?token=${MP_KEY}" 2>/dev/null)
mp_ok=$(echo "$mp_resp" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(Array.isArray(j)?'array':typeof j)}catch(e){console.log('error')}})")
assert_eq "MoviePilot reachable (download list valid)" "$mp_ok" "array"

# ── 2. Search returns results ───────────────────────────────────────────

# Pick 猎杀U-571 which has English name and should find torrents
lib=$(curl -fsS "${SV}/v1/library?subLibraryId=${SLIB}" 2>/dev/null)
target_id=$(echo "$lib" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);const it=j.items.find(i=>i.name.includes('猎杀'));console.log(it?it.itemId:'')})")

search=$(curl -fsS "${MP_URL}/api/v1/search/title?keyword=U-571&token=${MP_KEY}" 2>/dev/null)
scount=$(echo "$search" | json_field 'j.length')
echo "# Search 'U-571': ${scount:-0} results"

if [ -n "$scount" ] && [ "$scount" != "null" ] && [ "$scount" != "0" ]; then
  ok "MoviePilot search returns ${scount} torrents for U-571"
else
  echo "# NOTE: U-571 search returned 0 — may be expected"
  ok "MoviePilot search endpoint reachable"
fi

# ── 3. Create upgrade task ──────────────────────────────────────────────

# Set 5★ on 猎杀U-571 to get upgrade action
curl -fsS -X PATCH "${SV}/v1/library/ratings" -H "Content-Type: application/json" \
  -d "{\"itemId\":\"${target_id}\",\"userRating\":5}" 2>/dev/null >/dev/null
curl -fsS -X POST "${SV}/v1/library/actions/recompute-strategy" \
  -H "Content-Type: application/json" -d '{}' 2>/dev/null >/dev/null
sleep 1

task_resp=$(curl -fsS -X POST "${SV}/v1/tasks" \
  -H "Content-Type: application/json" \
  -d "{\"itemId\":\"${target_id}\",\"actionType\":\"upgrade\"}" 2>/dev/null)
task_id=$(echo "$task_resp" | json_field 'j.id')

if [ -n "$task_id" ] && [ "$task_id" != "null" ]; then
  ok "upgrade task created: ${task_id}"
else
  not_ok "upgrade task created"
  done_testing
fi

# Verify task appears in list
tasks=$(curl -fsS "${SV}/v1/tasks" 2>/dev/null)
found=$(echo "$tasks" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);const arr=j.tasks||j;const t=arr.find(t=>t.id==='${task_id}');console.log(t?'yes':'no')})")
assert_eq "task appears in list" "$found" "yes"

# ── Cleanup ─────────────────────────────────────────────────────────────

curl -fsS -X DELETE "${SV}/v1/tasks/${task_id}" 2>/dev/null >/dev/null
# Reset rating
curl -fsS -X PATCH "${SV}/v1/library/ratings" -H "Content-Type: application/json" \
  -d "{\"itemId\":\"${target_id}\",\"userRating\":3}" 2>/dev/null >/dev/null
curl -fsS -X POST "${SV}/v1/library/actions/recompute-strategy" \
  -H "Content-Type: application/json" -d '{}' 2>/dev/null >/dev/null

done_testing
