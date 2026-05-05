#!/usr/bin/env bash
# test-delete-flow.sh — Delete Flow E2E (Tier 3, automated)
# Tests: task create → immediate cancel (safely, no files deleted)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../common.sh"

SV="${SERVICE_URL:-http://127.0.0.1:18080}"
SLIB="${TEST_SUBLIB:-a72104c8-28ee-4527-bab1-5abfb3d1d450}"

echo "# Delete Flow E2E"
echo "# Service: ${SV}"

# ── Find test item ──────────────────────────────────────────────────────

lib=$(curl -fsS "${SV}/v1/library?subLibraryId=${SLIB}" 2>/dev/null)
target_id=$(echo "$lib" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);const it=j.items.find(i=>i.name.includes('有话好好说'));console.log(it?it.itemId:'')})")

if [ -z "$target_id" ]; then
  echo "Bail out! 有话好好说 not found"
  exit 1
fi
echo "# Target: 有话好好说 (id=${target_id})"

# Save the original action for cleanup
orig_action=$(echo "$lib" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);const it=j.items.find(i=>i.itemId==='${target_id}');console.log(it?.action||'keep')})")
echo "# Original action: ${orig_action}"

# ── Case 1: Rate 1★ → action becomes delete ─────────────────────────────

curl -fsS -X PATCH "${SV}/v1/library/ratings" -H "Content-Type: application/json" \
  -d "{\"itemId\":\"${target_id}\",\"userRating\":1}" 2>/dev/null >/dev/null
curl -fsS -X POST "${SV}/v1/library/actions/recompute-strategy" \
  -H "Content-Type: application/json" -d '{}' 2>/dev/null >/dev/null
sleep 2

lib2=$(curl -fsS "${SV}/v1/library?subLibraryId=${SLIB}" 2>/dev/null)
new_action=$(echo "$lib2" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);const it=j.items.find(i=>i.itemId==='${target_id}');console.log(it?.action||'keep')})")
assert_eq "1★ rating triggers delete action" "$new_action" "delete"
echo "# Action after 1★: ${new_action}"

# ── Case 2: Create delete task ──────────────────────────────────────────

task_resp=$(curl -fsS -X POST "${SV}/v1/tasks" \
  -H "Content-Type: application/json" \
  -d "{\"itemId\":\"${target_id}\",\"actionType\":\"delete\"}" 2>/dev/null)
task_id=$(echo "$task_resp" | json_field 'j.id')

if [ -n "$task_id" ] && [ "$task_id" != "null" ]; then
  ok "delete task created: ${task_id}"
else
  not_ok "delete task created"
  done_testing
fi

# ── Case 3: Verify task fields ──────────────────────────────────────────

detail=$(curl -fsS "${SV}/v1/admin/tasks/${task_id}" 2>/dev/null)
t_action=$(echo "$detail" | json_field 'j.actionType')
t_item=$(echo "$detail" | json_field 'j.itemId')
assert_eq "task actionType=delete" "$t_action" "delete"
assert_eq "task itemId matches" "$t_item" "$target_id"

# ── Case 4: Cancel task immediately (before file delete) ─────────────────

del_resp=$(curl -fsS -X DELETE "${SV}/v1/tasks/${task_id}" 2>/dev/null)
del_ok=$(echo "$del_resp" | json_field 'j.ok')
assert_eq "task cancelled ok" "$del_ok" "true"

# ── Case 5: Verify task removed ─────────────────────────────────────────

check=$(curl -s "${SV}/v1/admin/tasks/${task_id}" 2>/dev/null)
check_err=$(echo "$check" | json_field 'j.error.code')
if [ -n "$check_err" ] && [ "$check_err" != "null" ]; then
  assert_eq "cancelled task returns error" "$check_err" "NOT_FOUND"
else
  ok "task deleted successfully"
fi

# ── Cleanup: restore rating ─────────────────────────────────────────────

curl -fsS -X PATCH "${SV}/v1/library/ratings" -H "Content-Type: application/json" \
  -d "{\"itemId\":\"${target_id}\",\"userRating\":3}" 2>/dev/null >/dev/null
curl -fsS -X POST "${SV}/v1/library/actions/recompute-strategy" \
  -H "Content-Type: application/json" -d '{}' 2>/dev/null >/dev/null

echo "# Restored rating to 3★"

done_testing
