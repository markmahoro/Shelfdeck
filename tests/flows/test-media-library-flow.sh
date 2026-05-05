#!/usr/bin/env bash
# test-media-library-flow.sh — Media Library Flow E2E (Tier 3, automated)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../common.sh"

SV="${SERVICE_URL:-http://127.0.0.1:18080}"
SLIB="a72104c8-28ee-4527-bab1-5abfb3d1d450"

echo "# Media Library Flow E2E"
echo "# Service: ${SV}"

# ── Helpers ─────────────────────────────────────────────────────────────

lib_item() {
  local item_id="$1"
  curl -fsS "${SV}/v1/library?subLibraryId=${SLIB}" 2>/dev/null \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);const it=j.items.find(i=>i.itemId==='${item_id}');if(it)console.log(it.userRating||'0',it.action)})"
}

rate() {
  local item_id="$1" rating="$2"
  curl -fsS -X PATCH "${SV}/v1/library/ratings" \
    -H "Content-Type: application/json" \
    -d "{\"itemId\":\"${item_id}\",\"userRating\":${rating}}" 2>/dev/null
}

recalc() {
  curl -fsS -X POST "${SV}/v1/library/actions/recompute-strategy" \
    -H "Content-Type: application/json" -d '{}' 2>/dev/null
}

# ── Find test item ──────────────────────────────────────────────────────

lib=$(curl -fsS "${SV}/v1/library?subLibraryId=${SLIB}" 2>/dev/null)
total=$(echo "$lib" | json_field 'j.total')
echo "# Items in test library: ${total}"

iid=$(echo "$lib" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);const it=j.items.find(i=>i.name.includes('有话好好说'));console.log(it?it.itemId:'')})")
echo "# Using 有话好好说 (id=${iid})"

orig=$(lib_item "$iid")
orig_rating=$(echo "$orig" | awk '{print $1}')
orig_action=$(echo "$orig" | awk '{print $2}')
echo "# Original: rating=${orig_rating} action=${orig_action}"

# ── Case 1: Rate 5★ → upgrade ──────────────────────────────────────────

rate "$iid" 5
recalc >/dev/null
sleep 2

r=$(lib_item "$iid")
r5=$(echo "$r" | awk '{print $1}')
a5=$(echo "$r" | awk '{print $2}')
assert_eq "5★ rating persisted" "$r5" "5"
assert_eq "5★ action is upgrade" "$a5" "upgrade"
echo "# 5★: rating=${r5} action=${a5}"

# ── Case 2: Rate 1★ → delete ───────────────────────────────────────────

rate "$iid" 1
recalc >/dev/null
sleep 2

r=$(lib_item "$iid")
r1=$(echo "$r" | awk '{print $1}')
a1=$(echo "$r" | awk '{print $2}')
assert_eq "1★ rating persisted" "$r1" "1"
assert_eq "1★ action is delete" "$a1" "delete"
echo "# 1★: rating=${r1} action=${a1}"

# ── Case 3: Rate 3★ → restore neutral ───────────────────────────────────

rate "$iid" 3
recalc >/dev/null
sleep 2

r=$(lib_item "$iid")
r3=$(echo "$r" | awk '{print $1}')
a3=$(echo "$r" | awk '{print $2}')
assert_eq "3★ rating persisted" "$r3" "3"
echo "# 3★: rating=${r3} action=${a3}"

done_testing
