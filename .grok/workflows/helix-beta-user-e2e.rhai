let meta = #{
    name: "helix-beta-user-e2e",
    description: "User-perspective full E2E of Helix-beta (Movie-only full chain): known UAT/UX logs, Admin Web journeys A-I, new-issue discovery, and bounded product fixes",
    when_to_use: "Run Helix-beta Movie full-chain E2E against local Admin Web: cover UAT/UX issue logs, hunt new user-visible defects, and apply bounded product fixes without touching NAS or SSOT",
    phases: [
        #{ title: "Ground", detail: "safety, health, Admin Web surface" },
        #{ title: "Canary", detail: "inspect F:\\canary; rebuild from F:\\test_film only when blocked" },
        #{ title: "Journeys", detail: "one agent per user-facing Admin Web journey" },
        #{ title: "Known issues", detail: "regression of UAT and UX issue-log batches" },
        #{ title: "Discover", detail: "adversarial new-issue explorers" },
        #{ title: "Verify", detail: "independent skeptics fail closed" },
        #{ title: "Fix", detail: "bounded product-defect repairs and retest" },
        #{ title: "Report", detail: "scratch report and residual risk" },
    ],
};

let env_schema = #{
    "type": "object",
    "properties": #{
        "service_reachable": #{ "type": "boolean" },
        "base_url": #{ "type": "string" },
        "notes": #{ "type": "string" },
        "forbidden_targets_clear": #{ "type": "boolean" },
        "admin_pages": #{ "type": "string" },
    },
};

let canary_hygiene_schema = #{
    "type": "object",
    "properties": #{
        "canary_exists": #{ "type": "boolean" },
        "baseline_ok": #{ "type": "boolean" },
        "matches_baseline": #{ "type": "boolean" },
        "in_progress_formation": #{ "type": "boolean" },
        "hard_pollution": #{ "type": "boolean" },
        "needs_rebuild": #{ "type": "boolean" },
        "needs_new_observation": #{ "type": "boolean" },
        "reason": #{ "type": "string" },
        "markers": #{ "type": "string" },
        "notes": #{ "type": "string" },
    },
};

let canary_rebuild_schema = #{
    "type": "object",
    "properties": #{
        "rebuilt": #{ "type": "boolean" },
        "failed": #{ "type": "boolean" },
        "preserved_as": #{ "type": "string" },
        "verified_counts": #{ "type": "string" },
        "service_reachable": #{ "type": "boolean" },
        "reset_uat_db": #{ "type": "boolean" },
        "notes": #{ "type": "string" },
    },
};

let findings_schema = #{
    "type": "object",
    "properties": #{
        "notes": #{ "type": "string" },
        "findings": #{
            "type": "array",
            "maxItems": 8,
            "items": #{
                "type": "object",
                "properties": #{
                    "id": #{ "type": "string" },
                    "title": #{ "type": "string" },
                    "severity": #{ "type": "string" },
                    "status": #{ "type": "string" },
                    "evidence": #{ "type": "string" },
                    "user_visible": #{ "type": "string" },
                    "boundary": #{ "type": "string" },
                    "feature_ids": #{ "type": "string" },
                    "suggested_fix": #{ "type": "string" },
                    "journey": #{ "type": "string" },
                    "needs_clean_canary": #{ "type": "boolean" },
                },
            },
        },
    },
};

let verdict_schema = #{
    "type": "object",
    "properties": #{
        "real": #{ "type": "boolean" },
        "reason": #{ "type": "string" },
        "evidence": #{ "type": "string" },
        "boundary": #{ "type": "string" },
    },
};

let fix_schema = #{
    "type": "object",
    "properties": #{
        "applied": #{ "type": "boolean" },
        "files": #{ "type": "string" },
        "summary": #{ "type": "string" },
        "tests_run": #{ "type": "string" },
        "blocked_reason": #{ "type": "string" },
        "commit_sha": #{ "type": "string" },
        "needs_clean_canary": #{ "type": "boolean" },
    },
};

let retest_schema = #{
    "type": "object",
    "properties": #{
        "notes": #{ "type": "string" },
        "findings": #{
            "type": "array",
            "maxItems": 8,
            "items": #{
                "type": "object",
                "properties": #{
                    "id": #{ "type": "string" },
                    "title": #{ "type": "string" },
                    "severity": #{ "type": "string" },
                    "status": #{ "type": "string" },
                    "evidence": #{ "type": "string" },
                    "user_visible": #{ "type": "string" },
                    "boundary": #{ "type": "string" },
                    "feature_ids": #{ "type": "string" },
                    "suggested_fix": #{ "type": "string" },
                    "journey": #{ "type": "string" },
                    "needs_clean_canary": #{ "type": "boolean" },
                },
            },
        },
    },
};

fn as_str(x) {
    if x == () {
        ""
    } else if type_of(x) == "string" {
        x
    } else {
        json_encode(x)
    }
}

fn trimmed(s) {
    if type_of(s) == "string" {
        s.trim();
        s
    } else {
        ""
    }
}

fn has_substr(hay, needle) {
    if type_of(hay) != "string" || type_of(needle) != "string" {
        return false;
    }
    let n = needle.len();
    let h = hay.len();
    if n == 0 { return true; }
    if n > h { return false; }
    let max_i = h - n;
    let i = 0;
    while max_i >= i {
        if hay.sub_string(i, n) == needle { return true; }
        i += 1;
    }
    false
}

fn min_int(a, b) {
    if b > a { a } else { b }
}

fn finding_key(f) {
    trimmed(as_str(f.id)) + "|" + trimmed(as_str(f.title))
}

fn take_findings(r, cap) {
    let out = [];
    if r == () { return out; }
    if r.success != true { return out; }
    if r.output == () { return out; }
    let items = r.output.findings;
    if items == () { return out; }
    let n = 0;
    for f in items {
        if n >= cap { break; }
        if f != () { out.push(f); n += 1; }
    }
    out
}

fn key_seen(keys, k) {
    for existing in keys {
        if existing == k { return true; }
    }
    false
}

fn merge_findings(results, collected, keys, cap) {
    let dropped_n = 0;
    let next = collected;
    let next_keys = keys;
    for r in results {
        let items = take_findings(r, 8);
        for f in items {
            let k = finding_key(f);
            if k == "|" { continue; }
            if key_seen(next_keys, k) { continue; }
            if next.len() >= cap {
                dropped_n += 1;
                continue;
            }
            next_keys.push(k);
            next.push(f);
        }
    }
    #{ collected: next, keys: next_keys, dropped: dropped_n }
}

fn safety_preamble(base_url, allow_destructive) {
    let s = "";
    s += "SAFETY (non-negotiable):\n";
    s += "- Never access NAS 192.168.12.230, Z:\\Film, G:\\canary_film, production data, Docker deploy, or SSH.\n";
    s += "- F:\\test_film is a read-only baseline. Do not write, move, rename, or delete it.\n";
    s += "- Do not write business facts to SQLite, forge evidence, or advance Work/Event by script.\n";
    s += "- Do not edit docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md or change Owner/Handoff/Authorization semantics.\n";
    s += "- Do not run npm run dev as a long-lived server. Do not touch media-desktop.\n";
    s += "- Local service only: " + base_url + "\n";
    s += "- Never print secrets, API keys, cookies, or personal rating details.\n";
    if allow_destructive != true {
        s += "- Do not run Off-deck authorization, Shelf Deregistration, Aftercare fault injection, or delete/move Canary files.\n";
        s += "- Off-deck/Deregistration pages may be opened read-only.\n";
    }
    s
}

fn usability_bar() {
    let s = "";
    s += "USABILITY BAR (Helix-beta HB-I.07). This is not optimization:\n";
    s += "- A journey PASS means a librarian can use the product. Hours-long transcode with honest progress is fine. Faster-would-be-nice is not a finding.\n";
    s += "- FAIL if frontend first-open or refresh never settles, white-screens, spins with no wait reason, ignores navigation, or a single action storms so many requests the page cannot be used.\n";
    s += "- FAIL if the page says in-progress but there is no execution evidence (no FFmpeg/process, no growing workspace files, no advancing On-deck), or a user-facing Admin Query hangs the page by rebuilding an unbounded ledger, or primary-media identity reads the whole file and makes that title unusable.\n";
    s += "- Honest waiting (resource, Provider, Approval) with a readable reason is PASS. Do not file GPU/throughput tuning as defects.\n";
    s
}

fn tool_rules() {
    let s = "";
    s += "METHOD:\n";
    s += "- Use read_file, grep, list_dir, and run_terminal_command. Do not answer from memory.\n";
    s += "- Inspect actual Admin Web source under media-service/web/src/helix/ and public Admin HTTP adapters.\n";
    s += "- If the local service is up, exercise the journey as a user: GET /v1/health, Admin Web HTML, public /v1/admin/* Query routes, and a refresh of the same route.\n";
    s += "- API 200, unit tests, or page render alone cannot prove PASS. User-visible result, public Projection, and (when files are involved) filesystem reality must agree.\n";
    s += "- For file claims, only read F:\\canary names/sizes. F:\\test_film is read-only.\n";
    s += "- Credentials may be read from local ignored env files to call Admin APIs; never copy them into findings or reports.\n";
    s += "- Empty findings is valid ONLY after you inspected source AND attempted live checks, or recorded that the service was unreachable.\n";
    s += "- Report at most 8 findings. Prefer user-visible defects over style nits.\n";
    s += usability_bar();
    s
}

fn finding_shape() {
    let s = "";
    s += "Each finding object fields:\n";
    s += "- id: UAT-xxx or UX-xxx if it matches the issue log, otherwise NEW-JOURNEY-n\n";
    s += "- title: one sentence user-visible problem\n";
    s += "- severity: critical | high | medium | low\n";
    s += "- status: new | reproduced | regressed | blocked | not_reproduced\n";
    s += "- evidence: concrete file path, route, response field, or filesystem observation\n";
    s += "- user_visible: what the Admin Web user sees\n";
    s += "- boundary: product_defect | architecture | environment | test_gap\n";
    s += "- feature_ids: Helix-beta ids such as HB-B.14,HB-G.06,XB-01\n";
    s += "- suggested_fix: smallest product fix, or Design-return if SSOT/Owner would change\n";
    s += "- journey: this journey id\n";
    s += "- needs_clean_canary: true only if remaining tests cannot continue without a fresh F:\\canary from F:\\test_film (new Observation required, hard pollution, or Off-deck emptied the library)\n";
    s
}

fn canary_contract() {
    let s = "";
    s += "CANARY CONTRACT:\n";
    s += "- Immutable baseline: F:\\test_film. Never write, move, rename, or delete it.\n";
    s += "- Working copy: F:\\canary. Same-root Field and Shelf Target.\n";
    s += "- Baseline fingerprint that a CLEAN start must match: 22 top-level media units, 455 files, 42 recursive dirs, 143829090011 bytes. Compare relative path, type, size, and mtime. Count-only comparison is not enough.\n";
    s += "- After legitimate On-deck, F:\\canary MUST differ from baseline. That is product work, not pollution.\n";
    s += "- Hard pollution markers: hash-named collection folders; title (0) folders; unexplained dual copies of the same movie; leftover BDMV/CERTIFICATE trees after settlement when the product claimed they were removed; files outside F:\\canary; any change to F:\\test_film.\n";
    s += "- 养蜂人 MKV + nested BDMV as two movies is the contract, not dual-copy pollution.\n";
    s += "- Rebuild procedure when allowed: 1) stop the local service if it has F:\\canary open; 2) rename F:\\canary to F:\\canary.failed-STAMP (keep the failed scene; do not delete); 3) create a new empty F:\\canary; 4) robocopy /E F:\\test_film F:\\canary with NO /MIR /MOVE /PURGE; 5) re-verify the four-key fingerprint against F:\\test_film; 6) if reset_uat_db, create a NEW isolated UAT data directory and copy-forward only External Integration/Secret plus immutable Douban history — zero old Field/Shelf/Subject/Run/Entry. Restart local 127.0.0.1:18080 only after verify. Re-create Field/Shelf via Admin Web later; do not write business facts to SQLite.\n";
    s += "- Never touch G:\\canary_film, Z:\\Film, NAS, or Docker.\n";
    s
}

fn make_rebuild_prompt(base_url, allow_destructive, run_stamp, reset_uat_db, reason) {
    let p = safety_preamble(base_url, allow_destructive);
    p += canary_contract();
    p += "Rebuild F:\\canary now so the user-perspective E2E can continue.\n";
    p += "Reason: " + reason + "\n";
    p += "Stamp for the preserved folder name: " + run_stamp + "\n";
    if reset_uat_db == true {
        p += "Also create a NEW isolated UAT data directory and copy-forward only integrations/secrets/immutable Douban history. Do not copy Field/Shelf/Subject/Run/Entry. Restart local service on " + base_url + " only after the four-key verify passes.\n";
    } else {
        p += "Do not create a new UAT database. Physical canary rebuild only. The caller accepts that old Observation facts may not match the new files.\n";
    }
    p += "Use run_terminal_command. Do not use /MIR /MOVE /PURGE. Do not delete the renamed failed canary. Do not touch F:\\test_film.\n";
    p += "If four-key verify fails, set rebuilt=false and failed=true. Do not start Observation yourself.\n";
    p += "Return rebuilt, failed, preserved_as, verified_counts, service_reachable, reset_uat_db, notes.\n";
    p
}

// Args: missing object is safe defaults. Never pause on a result-derived branch.
let base_url = "http://127.0.0.1:18080";
let apply_fixes = true;
let allow_destructive = false;
let commit_fixes = true;
let max_fixes = 6;
let canary_rebuild = "if_blocked";
let allow_rebuild_in_progress = false;
let reset_uat_db = true;
let run_stamp = "";
if args != () {
    if args.base_url != () && type_of(args.base_url) == "string" && trimmed(args.base_url) != "" {
        base_url = trimmed(args.base_url);
    }
    if args.apply_fixes == false { apply_fixes = false; }
    if args.apply_fixes == true { apply_fixes = true; }
    if args.allow_destructive == true { allow_destructive = true; }
    if args.commit_fixes == false { commit_fixes = false; }
    if args.commit_fixes == true { commit_fixes = true; }
    if args.max_fixes != () && type_of(args.max_fixes) == "i64" && args.max_fixes > 0 {
        max_fixes = args.max_fixes;
        if max_fixes > 8 { max_fixes = 8; }
    }
    if args.canary_rebuild != () && type_of(args.canary_rebuild) == "string" && trimmed(args.canary_rebuild) != "" {
        canary_rebuild = trimmed(args.canary_rebuild);
    }
    if args.allow_rebuild_in_progress == true { allow_rebuild_in_progress = true; }
    if args.reset_uat_db == false { reset_uat_db = false; }
    if args.run_stamp != () && type_of(args.run_stamp) == "string" {
        run_stamp = trimmed(args.run_stamp);
    }
}
if run_stamp == "" {
    run_stamp = as_str(fingerprint(base_url + "|" + canary_rebuild));
}

if has_substr(base_url, "192.168.12.230") || has_substr(base_url, "Z:\\Film") {
    complete(#{
        summary: "ABORTED: production NAS or forbidden media URL is not allowed",
        path: "",
        findings_verified: 0,
        fixes_applied: 0,
    });
}

let journeys = [
    #{ id: "J01", title: "Journey I/A: overview, session, first-open", pages: "/ and /admin Overview", features: "HB-I HB-A.01 UAT-006 UAT-008 UAT-057 UAT-058 UX-001 UX-013" },
    #{ id: "J02", title: "Journey A/B: Movie Field config and observation", pages: "文件来源配置 /material-fields", features: "HB-A.04 HB-A.05 HB-B.01 HB-B.04 HB-B.05 UAT-031 UAT-053 UX-004" },
    #{ id: "J03", title: "Journey A/E: Shelf, placement, routing", pages: "收藏架配置 /shelves", features: "HB-A.03 HB-A.06 HB-A.07 HB-B.06 HB-E UAT-010 UAT-020 UX-005" },
    #{ id: "J04", title: "Journey B/F: formation, ratings, production", pages: "媒体整理工作区 /formation", features: "HB-B HB-F.01 UAT-001 UAT-005 UAT-009 UAT-018 UAT-050 UAT-051" },
    #{ id: "J05", title: "Journey C/D: my collection and health", pages: "我的收藏 /collection", features: "HB-C HB-D UAT-038 UAT-052 UX-006" },
    #{ id: "J06", title: "Journey G: off-deck (in Helix-beta; authorize only if allowed)", pages: "退出收藏 /offdeck", features: "HB-G UAT-054 UX-007" },
    #{ id: "J07", title: "Journey F: people registry", pages: "人物 /people", features: "HB-F.04 HB-F.05 HB-F.06 UAT-007 UAT-055 UX-011" },
    #{ id: "J08", title: "Journey A/P: settings and integrations", pages: "系统设置 /settings", features: "HB-P HB-A.08 UAT-016 UAT-017 UAT-056 UX-008" },
    #{ id: "J09", title: "Helix-beta HB-* coverage and XB OUT_OF_BETA negatives", pages: "baseline plus live facts", features: "HB-A through HB-I HB-P HB-I.07 XB-01 through XB-14" },
    #{ id: "J10", title: "Journey H: Shelf deregistration (in Helix-beta; authorize only if allowed)", pages: "收藏架配置 deregister dialog", features: "HB-H HB-H.01 HB-H.02 HB-H.03" },
];

let known_batches = [
    #{ id: "K01", title: "UAT-001 to UAT-010", ids: "UAT-001 UAT-002 UAT-003 UAT-004 UAT-005 UAT-006 UAT-007 UAT-008 UAT-009 UAT-010" },
    #{ id: "K02", title: "UAT-011 to UAT-020", ids: "UAT-011 UAT-012 UAT-013 UAT-014 UAT-015 UAT-016 UAT-017 UAT-018 UAT-019 UAT-020" },
    #{ id: "K03", title: "UAT-021 to UAT-030", ids: "UAT-021 UAT-022 UAT-023 UAT-024 UAT-025 UAT-026 UAT-027 UAT-028 UAT-029 UAT-030" },
    #{ id: "K04", title: "UAT-031 to UAT-040", ids: "UAT-031 UAT-032 UAT-033 UAT-034 UAT-035 UAT-036 UAT-037 UAT-038 UAT-039 UAT-040" },
    #{ id: "K05", title: "UAT-041 to UAT-049", ids: "UAT-041 UAT-042 UAT-043 UAT-044 UAT-045 UAT-046 UAT-047 UAT-048 UAT-049" },
    #{ id: "K06", title: "UAT-050 to UAT-058", ids: "UAT-050 UAT-051 UAT-052 UAT-053 UAT-054 UAT-055 UAT-056 UAT-057 UAT-058" },
    #{ id: "K07", title: "UX-001 to UX-016", ids: "UX-001 UX-002 UX-003 UX-004 UX-005 UX-006 UX-007 UX-008 UX-009 UX-010 UX-011 UX-012 UX-013 UX-014 UX-015 UX-016" },
    #{ id: "K08", title: "UX-017 to UX-032", ids: "UX-017 UX-018 UX-019 UX-020 UX-021 UX-022 UX-023 UX-024 UX-025 UX-026 UX-027 UX-028 UX-029 UX-030 UX-031 UX-032" },
];

let explorers = [
    #{ id: "D01", title: "copy, internal leakage, copy-conflict across eight Admin pages" },
    #{ id: "D02", title: "page vs public fact vs F:\\canary filesystem inconsistency" },
    #{ id: "D03", title: "fail-closed negatives: auth, secrets, false success, missing routing, destructive confirmations" },
    #{ id: "D04", title: "user-usable not fast: hung UI, silent stalls, request storms, unbounded media reads" },
];

phase("Ground");
log("Grounding local Movie-beta E2E against " + base_url);
let ground_prompt = safety_preamble(base_url, allow_destructive);
ground_prompt += "You are preparing a user-perspective E2E of the current ShelfDeck Helix Movie beta.\n";
ground_prompt += "Read these files before answering: docs/helix/CURRENT_STATUS.md, docs/helix/CURRENT_PLAN.md, docs/helix/BETA_FEATURE_ACCEPTANCE_BASELINE.md (Helix-beta Movie full chain HB-A through HB-I and HB-P; XB exclusions are OUT_OF_BETA, not missing Beta features), docs/helix/USER_ACCEPTANCE_TEST_ISSUE_LOG.md (overview tables), docs/helix/ADMIN_WEB_UX_ISSUE_LOG.md (overview table), docs/helix/acceptance/MOVIE_CANARY_USER_UAT_CHECKLIST.md, docs/helix/acceptance/MOVIE_CANARY_E2E_SUCCESS_EVALUATION.md, media-service/web/src/App.tsx, media-service/web/src/helix/surface-model.ts.\n";
ground_prompt += "Then: curl GET " + base_url + "/v1/health and GET " + base_url + "/admin. Confirm the process is local, not NAS.\n";
ground_prompt += "Confirm no active Field/Shelf path mentions Z:\\Film or 192.168.12.230. If you cannot prove that, set forbidden_targets_clear=false.\n";
ground_prompt += "List the eight Helix Admin pages from source. Do not start a dev server.\n";
ground_prompt += "Return service_reachable, base_url, notes, forbidden_targets_clear, admin_pages. notes must say whether F:\\canary and the local UAT data dir appear present, without dumping secrets.\n";
let env_r = agent(ground_prompt, #{
    label: "ground-env",
    capability_mode: "execute",
    output_schema: env_schema,
});

if env_r != () && env_r.success && env_r.output != () && env_r.output.forbidden_targets_clear == false {
    complete(#{
        summary: "ABORTED: grounding found a forbidden production/NAS/Z:\\Film target",
        path: "",
        notes: as_str(env_r.output.notes),
        findings_verified: 0,
        fixes_applied: 0,
    });
}

let service_up = false;
if env_r != () && env_r.success && env_r.output != () && env_r.output.service_reachable == true {
    service_up = true;
}
if service_up {
    log("Local service reachable");
} else {
    log("Local service not confirmed; journeys will inspect source/logs and mark live checks blocked");
}

phase("Canary");
let hygiene_prompt = safety_preamble(base_url, allow_destructive);
hygiene_prompt += canary_contract();
hygiene_prompt += "Inspect whether F:\\canary is a usable Movie Canary for this run. Use list_dir / filesystem commands and, if the service is up, public Admin Field/Shelf/Formation counts. Read docs/helix/acceptance/MOVIE_CANARY_E2E_SUCCESS_EVALUATION.md section 3.\n";
hygiene_prompt += "Set matches_baseline=true only after the four-key compare versus F:\\test_film (path, type, size, mtime) is a zero diff.\n";
hygiene_prompt += "Set in_progress_formation=true if Admin facts show a live same-root Movie Canary (Field and Shelf both F:\\canary) with a coherent 23-subject formation in progress or On-deck. Do not treat legitimate On-deck placement changes as pollution.\n";
hygiene_prompt += "Set hard_pollution=true only for the hard markers in CANARY CONTRACT.\n";
hygiene_prompt += "Set needs_rebuild=true only if tests cannot continue: canary missing/empty/incomplete copy when no in-progress formation exists; four-key copy verify failed on a supposed clean start; hard pollution; or files were destroyed by Off-deck and later journeys still need a library.\n";
hygiene_prompt += "Do NOT set needs_rebuild=true merely because F:\\canary differs from F:\\test_film after On-deck.\n";
hygiene_prompt += "Set baseline_ok=true only if F:\\test_film itself still has 22/455/42 / 143829090011 and looks unmodified. If baseline_ok=false, say so in reason; never repair the baseline.\n";
hygiene_prompt += "Do not rename or copy anything in this step.\n";
let hygiene_r = agent(hygiene_prompt, #{
    label: "canary-hygiene",
    capability_mode: "execute",
    output_schema: canary_hygiene_schema,
});

let hygiene_needs = false;
let hygiene_in_progress = false;
let hygiene_hard = false;
let hygiene_reason = "";
let baseline_ok = true;
if hygiene_r != () && hygiene_r.success && hygiene_r.output != () {
    if hygiene_r.output.needs_rebuild == true { hygiene_needs = true; }
    if hygiene_r.output.in_progress_formation == true { hygiene_in_progress = true; }
    if hygiene_r.output.hard_pollution == true { hygiene_hard = true; }
    hygiene_reason = as_str(hygiene_r.output.reason);
    if hygiene_r.output.baseline_ok == false { baseline_ok = false; }
}
if baseline_ok != true {
    complete(#{
        summary: "ABORTED: F:\\test_film baseline is not intact; refuse to rebuild onto a damaged source",
        path: "",
        notes: hygiene_reason,
        findings_verified: 0,
        fixes_applied: 0,
    });
}

let canary_rebuilt = false;
let canary_preserved = "";
let do_rebuild = false;
let rebuild_reason = hygiene_reason;
if canary_rebuild == "always" {
    do_rebuild = true;
    rebuild_reason = "args.canary_rebuild=always";
} else if canary_rebuild == "never" {
    do_rebuild = false;
    log("Canary rebuild disabled by args");
} else {
    if hygiene_needs == true {
        if hygiene_in_progress == true && allow_rebuild_in_progress != true {
            log("Canary looks blocked but an in-progress formation is preserved; pass allow_rebuild_in_progress=true to wipe it");
            do_rebuild = false;
        } else {
            do_rebuild = true;
            if rebuild_reason == "" { rebuild_reason = "hygiene.needs_rebuild"; }
        }
    }
}
if do_rebuild == true {
    log("Rebuilding F:\\canary: " + rebuild_reason);
    let rb = agent(make_rebuild_prompt(base_url, allow_destructive, run_stamp, reset_uat_db, rebuild_reason), #{
        label: "canary-rebuild",
        capability_mode: "all",
        output_schema: canary_rebuild_schema,
    });
    if rb != () && rb.success && rb.output != () && rb.output.failed == true {
        complete(#{
            summary: "ABORTED: F:\\canary rebuild failed four-key verify",
            path: "",
            notes: as_str(rb.output.notes),
            findings_verified: 0,
            fixes_applied: 0,
        });
    }
    if rb != () && rb.success && rb.output != () && rb.output.rebuilt == true {
        canary_rebuilt = true;
        canary_preserved = as_str(rb.output.preserved_as);
        if rb.output.service_reachable == true { service_up = true; }
        if rb.output.service_reachable == false { service_up = false; }
        log("Canary rebuilt and preserved previous folder as " + canary_preserved);
    } else {
        log("Canary rebuild was requested but not confirmed; continuing with current folder");
    }
} else {
    log("Keeping current F:\\canary");
}

phase("Journeys");
let journey_jobs = [];
for j in journeys {
    let jp = safety_preamble(base_url, allow_destructive);
    jp += tool_rules();
    jp += finding_shape();
    jp += "You are a user-perspective E2E tester for Helix-beta: Movie-only full chain (SSOT journeys A-I, including Off-deck and Shelf Deregistration).\n";
    jp += "Journey id: " + j.id + "\n";
    jp += "Journey: " + j.title + "\n";
    jp += "Pages: " + j.pages + "\n";
    jp += "Related Helix-beta ids: " + j.features + "\n";
    if service_up {
        jp += "Live service is believed reachable at " + base_url + ". Exercise this journey end to end as a user would.\n";
    } else {
        jp += "Live service was not confirmed. Still read page source, API adapters, and recent local logs under media-service/data if present. Mark live-only claims status=blocked, not pass.\n";
    }
    jp += "DoD is docs/helix/BETA_FEATURE_ACCEPTANCE_BASELINE.md (HB-* rows). The 2026-07-23 four-profile F01-F21 matrix is void. Do not treat missing Series/JAV/Western as a Helix-beta failure.\n";
    jp += "Series/JAV/Western Adult, Homemade, AI Upscale, desktop, worker, and production NAS are OUT_OF_BETA. If this is J09, confirm the product does not claim them; that is a negative PASS, not NOT_RUN.\n";
    jp += "Hard fail if you observe hash-named shelf folders, title (0) folders, UI success with contradicting facts, or any write to F:\\test_film.\n";
    if allow_destructive == true && (j.id == "J06" || j.id == "J10") {
        jp += "Destructive Helix-beta G/H is allowed on F:\\canary only. Require the formal Admin Web confirmations. Do not touch F:\\test_film, Z:\\Film, or NAS. HB-H must leave files unchanged.\n";
    } else {
        jp += "Do not authorize Off-deck destruction or Shelf Deregistration in this run. HB-G and HB-H are still IN Helix-beta: exercise the pages, copy, lists, and confirm dialogs as read-only. Staged, not out of scope.\n";
    }
    journey_jobs.push(#{
        prompt: jp,
        label: "journey:" + j.id,
        capability_mode: "execute",
        output_schema: findings_schema,
    });
}
let journey_results = parallel(journey_jobs);

phase("Known issues");
let known_jobs = [];
for b in known_batches {
    let kp = safety_preamble(base_url, allow_destructive);
    kp += tool_rules();
    kp += finding_shape();
    kp += "You are regressing known Helix Movie-beta issue-log items from a user perspective.\n";
    kp += "Batch: " + b.id + " " + b.title + "\n";
    kp += "IDs (inspect every id; do not drop silently): " + b.ids + "\n";
    kp += "Read the matching sections in docs/helix/USER_ACCEPTANCE_TEST_ISSUE_LOG.md and/or docs/helix/ADMIN_WEB_UX_ISSUE_LOG.md. Then verify against current Admin Web source, public APIs at " + base_url + ", and F:\\canary read-only facts when the item is about files.\n";
    kp += "For each ID choose status: reproduced (still broken for the user), not_reproduced (user-visible result now matches the intended fix; cite evidence), blocked (could not check live), or regressed (was fixed, now broken again).\n";
    kp += "Only emit findings for reproduced, regressed, or blocked-with-user-impact. not_reproduced items belong in notes, not findings.\n";
    kp += "Do not close an item as PASS from unit tests alone. Do not rewrite the issue log file.\n";
    known_jobs.push(#{
        prompt: kp,
        label: "known:" + b.id,
        capability_mode: "execute",
        output_schema: findings_schema,
    });
}
let known_results = parallel(known_jobs);

phase("Discover");
let discover_jobs = [];
for d in explorers {
    let dp = safety_preamble(base_url, allow_destructive);
    dp += tool_rules();
    dp += finding_shape();
    dp += "You are an adversarial explorer hunting NEW user-visible defects in the current Helix Movie beta. Do not only restate the issue logs.\n";
    dp += "Focus: " + d.id + " " + d.title + "\n";
    dp += "Start from the eight Admin pages in media-service/web/src/helix/ and live " + base_url + " if reachable.\n";
    dp += "Hunt mismatches between what a librarian user would expect and what the product actually does: wrong copy, hidden next action, false completion, stale counts, internal terms, unusable empty states, broken refresh, secrets leakage, or page/fact/file disagreement.\n";
    dp += "If a finding matches an existing UAT/UX id, use that id. Otherwise NEW-" + d.id + "-n.\n";
    dp += "A valid empty list requires that you actually opened/read all eight page sources and attempted live checks or recorded unreachable.\n";
    if d.id == "D04" {
        dp += "D04 extra: inspect Admin Web fetch/query usage on the eight pages and live " + base_url + " timing of first HTML plus first public Query. Look at media-service/web/src/helix/*.tsx and formation/collection query adapters. Report only unusability, never missing optimization. Known cousins: UAT-002, UAT-004, UX-026, UX-027, UX-029, UX-030.\n";
    }
    discover_jobs.push(#{
        prompt: dp,
        label: "discover:" + d.id,
        capability_mode: "execute",
        output_schema: findings_schema,
    });
}
let discover_results = parallel(discover_jobs);

let MAX_COLLECT = 24;
let collected = [];
let seen_keys = [];
let dropped = 0;
let merged_j = merge_findings(journey_results, collected, seen_keys, MAX_COLLECT);
collected = merged_j.collected;
seen_keys = merged_j.keys;
dropped += merged_j.dropped;
let merged_k = merge_findings(known_results, collected, seen_keys, MAX_COLLECT);
collected = merged_k.collected;
seen_keys = merged_k.keys;
dropped += merged_k.dropped;
let merged_d = merge_findings(discover_results, collected, seen_keys, MAX_COLLECT);
collected = merged_d.collected;
seen_keys = merged_d.keys;
dropped += merged_d.dropped;
if dropped > 0 {
    log("Dropped " + dropped.to_string() + " extra findings after cap " + MAX_COLLECT.to_string());
}
log("Collected " + collected.len().to_string() + " candidate findings");

phase("Verify");
let confirmed = [];
let unverified = 0;
if collected.len() == 0 {
    log("No candidate findings to verify");
} else {
    let bgt = budget();
    let room = bgt.remaining;
    let leave = max_fixes + 2;
    let verify_cap = min_int(collected.len(), 12);
    if leave >= room {
        verify_cap = 0;
    } else if verify_cap > room - leave {
        verify_cap = room - leave;
    }
    if collected.len() > verify_cap {
        let skip_n = collected.len() - verify_cap;
        log("Verify cap " + verify_cap.to_string() + ", skipping " + skip_n.to_string());
    }
    let vjobs = [];
    let vi = 0;
    for f in collected {
        if vi >= verify_cap { break; }
        let vp = safety_preamble(base_url, allow_destructive);
        vp += "Adversarially verify this E2E finding. Default real=false unless you independently inspect current source and, if the service is up, live Admin Web/API/filesystem evidence.\n";
        vp += "Finding JSON:\n";
        vp += json_encode(f);
        vp += "\nSet real=true only with concrete evidence you read yourself. Missing tools or vague agreement is not enough.\n";
        vp += "boundary must be one of product_defect | architecture | environment | test_gap | not_a_defect.\n";
        vp += "Architecture/Owner/Handoff contradictions are architecture, not product_defect.\n";
        vp += "Do not modify files.\n";
        vjobs.push(#{
            prompt: vp,
            label: "verify:" + as_str(f.id),
            capability_mode: "execute",
            output_schema: verdict_schema,
        });
        vi += 1;
    }
    if vjobs.len() > 0 {
        let verdicts = parallel(vjobs);
        let i = 0;
        for v in verdicts {
            let f = collected[i];
            let ok = false;
            let bound = "";
            if v != () && v.success && v.output != () && v.output.real == true {
                let ev = trimmed(as_str(v.output.evidence));
                if ev != "" {
                    ok = true;
                    bound = trimmed(as_str(v.output.boundary));
                    if bound != "" { f.boundary = bound; }
                    if trimmed(as_str(v.output.evidence)) != "" { f.evidence = ev; }
                }
            }
            if ok {
                if bound == "not_a_defect" {
                    log("Verifier rejected " + as_str(f.id) + " as not a defect");
                } else {
                    confirmed.push(f);
                }
            } else {
                unverified += 1;
            }
            i += 1;
        }
    }
}
log(confirmed.len().to_string() + " findings survived verification; " + unverified.to_string() + " unverified");

let pending_clean_canary = false;
for f in confirmed {
    if f != () && f.needs_clean_canary == true { pending_clean_canary = true; }
}

phase("Fix");
let applied = [];
let blocked_fixes = [];
if apply_fixes != true {
    log("apply_fixes is false; skipping repairs");
} else if confirmed.len() == 0 {
    log("No verified findings; skipping repairs");
} else {
    let fi = 0;
    for f in confirmed {
        if fi >= max_fixes {
            log("max_fixes reached; remaining verified items not repaired this run");
            break;
        }
        let bound = trimmed(as_str(f.boundary));
        if bound != "product_defect" {
            blocked_fixes.push(f);
            continue;
        }
        let fp = safety_preamble(base_url, allow_destructive);
        fp += "Fix this verified user-visible product defect in the current workspace. Keep the change bounded.\n";
        fp += "Finding JSON:\n";
        fp += json_encode(f);
        fp += "\nRules:\n";
        fp += "- Read the owning code first. Prefer existing patterns.\n";
        fp += "- Do not change SSOT, Owner, Handoff, Authorization, or Helix-beta scope definitions.\n";
        fp += "- Do not write SQLite business facts, forge evidence, or mutate F:\\test_film / NAS / Z:\\Film.\n";
        fp += "- If the correct fix would cross an architecture boundary, do not implement; set applied=false and blocked_reason.\n";
        fp += "- Add or update focused tests when a contract is involved. Run the smallest relevant test command, not a long-lived dev server.\n";
        if commit_fixes == true {
            fp += "- After tests you actually ran pass, create one English git commit for this finding only. Put the SHA in commit_sha. Do not commit secrets, runtime JSON, or unrelated files.\n";
        } else {
            fp += "- Do not git commit. Leave the working tree with the fix.\n";
        }
        fp += "- If the user-visible proof of this fix requires a new Observation (old Candidate/Run facts are immutable), set needs_clean_canary=true. Do not rebuild the folder yourself.\n";
        fp += "Return applied, files, summary, tests_run, blocked_reason, commit_sha, needs_clean_canary.\n";
        let fr = agent(fp, #{
            label: "fix:" + as_str(f.id),
            capability_mode: "all",
            output_schema: fix_schema,
        });
        let row = #{
            id: as_str(f.id),
            title: as_str(f.title),
            applied: false,
            summary: "",
            tests_run: "",
            commit_sha: "",
            blocked_reason: "",
        };
        if fr != () && fr.success && fr.output != () && fr.output.applied == true {
            row.applied = true;
            row.summary = as_str(fr.output.summary);
            row.tests_run = as_str(fr.output.tests_run);
            row.commit_sha = as_str(fr.output.commit_sha);
            if fr.output.needs_clean_canary == true { pending_clean_canary = true; }
            applied.push(row);
        } else {
            if fr != () && fr.success && fr.output != () {
                row.blocked_reason = as_str(fr.output.blocked_reason);
                row.summary = as_str(fr.output.summary);
            } else {
                row.blocked_reason = "fixer agent failed or returned no usable output";
            }
            blocked_fixes.push(f);
        }
        fi += 1;
    }

    if pending_clean_canary == true && canary_rebuild != "never" && applied.len() > 0 {
        log("Post-fix Canary rebuild required for a new Observation");
        let rb2 = agent(make_rebuild_prompt(base_url, allow_destructive, run_stamp + "-fix", reset_uat_db, "verified fix needs new Observation or hard pollution"), #{
            label: "canary-rebuild-after-fix",
            capability_mode: "all",
            output_schema: canary_rebuild_schema,
        });
        if rb2 != () && rb2.success && rb2.output != () && rb2.output.rebuilt == true {
            canary_rebuilt = true;
            canary_preserved = as_str(rb2.output.preserved_as);
            if rb2.output.service_reachable == true { service_up = true; }
            if rb2.output.service_reachable == false { service_up = false; }
        } else if rb2 != () && rb2.success && rb2.output != () && rb2.output.failed == true {
            log("Post-fix Canary rebuild failed; retest will be blocked");
        }
    }

    if applied.len() > 0 {
        let rp = safety_preamble(base_url, allow_destructive);
        rp += tool_rules();
        rp += finding_shape();
        rp += canary_contract();
        rp += "Retest the repairs below from a user perspective. Do not claim UAT PASS from unit tests alone.\n";
        rp += "Applied repairs JSON:\n";
        rp += json_encode(applied);
        if canary_rebuilt == true {
            rp += "\nF:\\canary was rebuilt during this run. Re-create Field/Shelf/Routing via Admin Web if the UAT db was reset, then re-check the repaired ids on a fresh Observation. Do not write SQLite business facts.\n";
        }
        rp += "\nRe-check each id on Admin Web source and live " + base_url + " if reachable. Emit findings only for still-broken or newly broken user-visible results.\n";
        let rr = agent(rp, #{
            label: "retest-applied",
            capability_mode: "execute",
            output_schema: retest_schema,
        });
        let leftover = take_findings(rr, 8);
        for f in leftover {
            confirmed.push(f);
        }
        log("Retest returned " + leftover.len().to_string() + " remaining findings");
    }
}

phase("Report");
let report = "";
report += "# Helix-beta 用户视角 E2E 报告（Movie 全链路）\n\n";
report += "工作流：`helix-beta-user-e2e`\n\n";
report += "- 目标服务：" + base_url + "\n";
if service_up {
    report += "- 服务可达：是\n";
} else {
    report += "- 服务可达：未确认（现场检查按 blocked 处理）\n";
}
if allow_destructive == true {
    report += "- 破坏性 Off-deck / Shelf 注销：本轮允许在 F:\\canary 授权（Helix-beta 旅程 G/H）\n";
} else {
    report += "- 破坏性 Off-deck / Shelf 注销：页面已跑、未授权销毁；G/H 仍属 Helix-beta，本轮为 staged 只读\n";
}
if apply_fixes == true {
    report += "- 修复：已授权有界产品缺陷修复，最多 " + max_fixes.to_string() + " 项\n";
} else {
    report += "- 修复：未授权\n";
}
report += "- 范围：Helix-beta HB-A 至 HB-I、HB-P（Movie 全链路，含退出收藏与整架注销）+ UAT-001..058 + UX-001..032 + 新问题发现\n";
report += "- OUT_OF_BETA：XB-01 Series、XB-02 JAV、XB-03 Western Adult 及 XB-04 至 XB-14；缺这些不构成 Helix-beta 失败\n";
report += "- Canary 重建策略：" + canary_rebuild + "\n";
if canary_rebuilt == true {
    report += "- 本轮已重建 F:\\canary；旧现场保留为：" + canary_preserved + "\n";
} else {
    report += "- 本轮未重建 F:\\canary（合法整理终态不等于污染）\n";
}
report += "\n";

if hygiene_r != () && hygiene_r.success && hygiene_r.output != () {
    report += "## Canary 卫生\n\n";
    report += as_str(hygiene_r.output.notes) + "\n\n";
    report += "- needs_rebuild：" + as_str(hygiene_r.output.needs_rebuild) + "\n";
    report += "- in_progress_formation：" + as_str(hygiene_r.output.in_progress_formation) + "\n";
    report += "- hard_pollution：" + as_str(hygiene_r.output.hard_pollution) + "\n";
    report += "- reason：" + as_str(hygiene_r.output.reason) + "\n";
    report += "- markers：" + as_str(hygiene_r.output.markers) + "\n\n";
}

if env_r != () && env_r.success && env_r.output != () {
    report += "## 环境\n\n";
    report += as_str(env_r.output.notes) + "\n\n";
    report += "Admin pages: " + as_str(env_r.output.admin_pages) + "\n\n";
}

report += "## 用户旅程\n\n";
let ji = 0;
for j in journeys {
    let r = journey_results[ji];
    let n = take_findings(r, 8).len();
    let note = "";
    if r != () && r.success && r.output != () { note = as_str(r.output.notes); }
    report += "- **" + j.id + " " + j.title + "**：候选问题 " + n.to_string();
    if trimmed(note) != "" { report += " — " + trimmed(note); }
    report += "\n";
    ji += 1;
}

report += "\n## 已知问题台账回归\n\n";
let ki = 0;
for b in known_batches {
    let r = known_results[ki];
    let n = take_findings(r, 8).len();
    let note = "";
    if r != () && r.success && r.output != () { note = as_str(r.output.notes); }
    report += "- **" + b.id + "** `" + b.ids + "`：仍可见/回归/阻塞 " + n.to_string();
    if trimmed(note) != "" { report += " — " + trimmed(note); }
    report += "\n";
    ki += 1;
}

report += "\n## 已验证问题\n\n";
if confirmed.len() == 0 {
    report += "本轮没有通过独立核验的用户可见缺陷（含 canned/空结果路径）。\n\n";
} else {
    for f in confirmed {
        report += "### " + as_str(f.id) + " — " + as_str(f.title) + "\n\n";
        report += "- 严重度：" + as_str(f.severity) + "\n";
        report += "- 状态：" + as_str(f.status) + "\n";
        report += "- 边界：" + as_str(f.boundary) + "\n";
        report += "- Feature：" + as_str(f.feature_ids) + "\n";
        report += "- 用户可见：" + as_str(f.user_visible) + "\n";
        report += "- 证据：" + as_str(f.evidence) + "\n";
        report += "- 建议：" + as_str(f.suggested_fix) + "\n\n";
    }
}

report += "## 修复\n\n";
if applied.len() == 0 {
    report += "本轮没有落地的产品修复。\n\n";
} else {
    for row in applied {
        report += "- **" + as_str(row.id) + "** applied=" + as_str(row.applied);
        report += " commit=" + as_str(row.commit_sha) + "\n";
        report += "  " + as_str(row.summary) + "\n";
        report += "  tests: " + as_str(row.tests_run) + "\n";
    }
    report += "\n";
}
if blocked_fixes.len() > 0 {
    report += "未自动修复（非 product_defect、fixer 失败或触到架构边界）：\n\n";
    for f in blocked_fixes {
        report += "- " + as_str(f.id) + " — " + as_str(f.title) + " (" + as_str(f.boundary) + ")\n";
    }
    report += "\n";
}

report += "## 残留风险\n\n";
report += "- 未核验候选：" + unverified.to_string() + "\n";
report += "- 收集后丢弃：" + dropped.to_string() + "\n";
report += "- 独立核验通过：" + confirmed.len().to_string() + "\n";
report += "- 已应用修复：" + applied.len().to_string() + "\n";
report += "- 自动化测试通过不能单独作为 Beta 交付或 Canary UAT PASS。\n";
report += "- Off-deck 全量销毁与 Shelf 注销属于 Helix-beta（HB-G / HB-H）；未设 allow_destructive 时只跑页面与确认框，不授权。主检查点签字前不应销毁现场。\n";
report += "- Series / JAV / Western Adult 是 OUT_OF_BETA，不是本轮漏测。\n";
report += "- 旅程通过含 HB-I.07 可用性底线：用户能用即可，不要求高效。无进度转圈、整页卡死、假整理中视为失败。\n";

let path = write_scratch_file("beta-e2e-report.md", report);
let summary = "verified " + confirmed.len().to_string() + ", applied " + applied.len().to_string() + ", unverified " + unverified.to_string();
complete(#{
    path: path,
    summary: summary,
    report: report,
    findings_verified: confirmed.len(),
    fixes_applied: applied.len(),
    unverified: unverified,
    dropped: dropped,
    service_reachable: service_up,
    allow_destructive: allow_destructive,
    canary_rebuild_mode: canary_rebuild,
    canary_rebuilt: canary_rebuilt,
    canary_preserved: canary_preserved,
});
