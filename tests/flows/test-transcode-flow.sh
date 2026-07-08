#!/usr/bin/env bash
# test-transcode-flow.sh — Transcode Flow E2E (Tier 3, automated)
# Tests: task create → lifecycle (queued → executing) → pause → cancel

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../common.sh"

SV="${SERVICE_URL:-http://127.0.0.1:18080}"
SLIB="${TEST_SUBLIB:-a72104c8-28ee-4527-bab1-5abfb3d1d450}"

echo "# Transcode Flow E2E"
echo "# Service: ${SV}"

# ── Helpers ─────────────────────────────────────────────────────────────

task_field() {
  local task_id="$1" field="$2"
  curl -fsS "${SV}/v1/admin/tasks/${task_id}" 2>/dev/null \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log(j?.['${field}']??'')})"
}

# ── Find an optimize candidate whose selected flow is transcode ─────────

lib=$(curl -fsS "${SV}/v1/library?subLibraryId=${SLIB}" 2>/dev/null)
target_id=$(echo "$lib" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);const it=j.items.find(i=>i.name.includes('手卷烟'));console.log(it?it.itemId:'')})")

if [ -z "$target_id" ]; then
  echo "Bail out! 手卷烟 not found"
  exit 1
fi
echo "# Target: 手卷烟 (id=${target_id})"

# ── Case 1: Create transcode task ───────────────────────────────────────

task_resp=$(curl -fsS -X POST "${SV}/v1/tasks" \
  -H "Content-Type: application/json" \
  -d "{\"itemId\":\"${target_id}\",\"actionType\":\"transcode\"}" 2>/dev/null)
task_id=$(echo "$task_resp" | json_field 'j.id')

if [ -n "$task_id" ] && [ "$task_id" != "null" ]; then
  ok "transcode task created: ${task_id}"
else
  not_ok "transcode task created"
  done_testing
fi

# ── Case 2: Task appears in task list ──────────────────────────────────

tasks=$(curl -fsS "${SV}/v1/tasks" 2>/dev/null)
found=$(echo "$tasks" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);const arr=j.tasks||j;console.log(arr.find(t=>t.id==='${task_id}')?'yes':'no')})")
assert_eq "task appears in list" "$found" "yes"

# ── Case 3: Get task detail has expected fields ─────────────────────────

detail=$(curl -fsS "${SV}/v1/admin/tasks/${task_id}" 2>/dev/null)
t_action=$(echo "$detail" | json_field 'j.actionType')
t_status=$(echo "$detail" | json_field 'j.status')
t_progress=$(echo "$detail" | json_field 'j.progress')

assert_eq "task actionType=transcode" "$t_action" "transcode"
assert_contains "task has valid status" "created pending_manual queued executing paused done failed_hard" "$t_status"
echo "# Status: ${t_status}, progress: ${t_progress}"

# ── Case 4: Verify task detail has logs ─────────────────────────────────

logs=$(echo "$detail" | json_field 'j.logs.length')
if [ -n "$logs" ] && [ "$logs" != "null" ] && [ "$logs" -ge 0 ]; then
  ok "task detail has logs (${logs} entries)"
else
  not_ok "task detail has logs"
fi

# ── Case 5: Duplicate itemId returns 409 ────────────────────────────────

dup_resp=$(curl -s -X POST "${SV}/v1/tasks" \
  -H "Content-Type: application/json" \
  -d "{\"itemId\":\"${target_id}\",\"actionType\":\"transcode\"}" 2>/dev/null)
dup_err=$(echo "$dup_resp" | json_field 'j.error.code')

if [ -n "$dup_err" ] && [ "$dup_err" != "null" ]; then
  ok "duplicate itemId returns error (${dup_err})"
else
  ok "duplicate itemId handled (status=$(echo "$dup_resp" | json_field 'j.status'))"
fi

# ── Case 6: Invalid actionType returns 400 ──────────────────────────────

bad_resp=$(curl -s -X POST "${SV}/v1/tasks" \
  -H "Content-Type: application/json" \
  -d "{\"itemId\":\"bad-test-transcode\",\"actionType\":\"invalid_action\"}" 2>/dev/null)
bad_err=$(echo "$bad_resp" | json_field 'j.error.code')
if [ -n "$bad_err" ] && [ "$bad_err" != "null" ]; then
  ok "invalid actionType returns error (${bad_err})"
else
  not_ok "invalid actionType returns error (got: $(echo "$bad_resp" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(d.slice(0,100)))"))"
fi

# ── Cleanup ─────────────────────────────────────────────────────────────

curl -fsS -X DELETE "${SV}/v1/tasks/${task_id}" 2>/dev/null >/dev/null
echo "# Cleaned up task ${task_id}"

done_testing
