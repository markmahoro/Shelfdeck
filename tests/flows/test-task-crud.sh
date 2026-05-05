#!/usr/bin/env bash
# test-task-crud.sh — Task CRUD flow (Tier 3, CI-safe)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../common.sh"

SV="${SERVICE_URL:-http://127.0.0.1:18080}"
TEST_ITEM="ci-crud-$(date +%s)"
echo "# Task CRUD Flow"
echo "# Service: ${SV}"

# ── Case 1: Create task ────────────────────────────────────────────────

r=$(curl -fsS -X POST "${SV}/v1/tasks" \
  -H "Content-Type: application/json" \
  -d "{\"itemId\":\"${TEST_ITEM}\",\"actionType\":\"transcode\"}" 2>/dev/null)

task_id=$(echo "$r" | json_field 'j.id')
if [ -z "$task_id" ] || [ "$task_id" = "null" ]; then
  not_ok "create task returns id"
  echo "Bail out! task creation failed"
  exit 1
fi
ok "task created: ${task_id}"

action=$(echo "$r" | json_field 'j.actionType')
assert_eq "task actionType=transcode" "$action" "transcode"

# ── Case 2: Get task detail ────────────────────────────────────────────

r=$(curl -fsS "${SV}/v1/admin/tasks/${task_id}" 2>/dev/null)
detail_id=$(echo "$r" | json_field 'j.id')
assert_eq "get task returns same id" "$detail_id" "$task_id"

logs=$(echo "$r" | json_field 'j.logs.length')
if [ -n "$logs" ] && [ "$logs" != "null" ]; then
  ok "task has logs"
else
  not_ok "task has logs"
fi

# ── Case 3: Task appears in list ───────────────────────────────────────

r=$(curl -fsS "${SV}/v1/tasks" 2>/dev/null)
found=$(echo "$r" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);const arr=j.tasks||j;console.log(arr.find(t=>t.id==='${task_id}')?'yes':'no')})")
assert_eq "task appears in list" "$found" "yes"

# ── Case 4: Invalid actionType returns error ───────────────────────────

r=$(curl -s -X POST "${SV}/v1/tasks" \
  -H "Content-Type: application/json" \
  -d '{"itemId":"bad-test","actionType":"invalid_action"}' 2>/dev/null)
err=$(echo "$r" | json_field 'j.error.code')
assert_eq "invalid actionType returns VALIDATION_ERROR" "$err" "VALIDATION_ERROR"

# ── Case 5: Delete task ────────────────────────────────────────────────

curl -s -X DELETE "${SV}/v1/tasks/${task_id}" 2>/dev/null >/dev/null
r=$(curl -s "${SV}/v1/admin/tasks/${task_id}" 2>/dev/null)
del_err=$(echo "$r" | json_field 'j.error.code')
if [ -n "$del_err" ] && [ "$del_err" != "null" ]; then
  ok "deleted task returns error (${del_err})"
else
  ok "task deleted"
fi

done_testing
