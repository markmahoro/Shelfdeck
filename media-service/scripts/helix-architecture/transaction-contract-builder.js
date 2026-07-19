'use strict';

const crypto = require('crypto');

const crashFixtures = Object.freeze({
  'field-observation-page': ['Page DTO/Access/Request digest验证前后、Field observation head CAS前后、immutable revision与Material current-row逐项写入前后、typed Result/marker前后、响应前崩溃', '任一DTO、顺序、continuity、digest、supporting-work或CAS验证失败整页rollback；Field head、immutable page revision、全部Material current rows、typed Result和marker全有或全无；新Material仅初始化unknown/unknown；同marker重放返回原typed Result且不推进revision；terminal page以前不得形成缺失结论', 7497],
  'field-eligibility-reconcile': ['Policy schema/path/precedence边界、terminal coverage形成前后、Selection与Control snapshot读取前后、Batch提交前、逐项basis/revision重验、事务提交前后、响应前崩溃', '只按ExtractionPolicy@1和固定reason precedence计算；无隐藏duplicate suppression；未terminal/Access变化/不可用basis只投影unknown；stale Material row不被覆盖并进入summary；同basis no-op；一个Batch的applied rows全有或全无；无Event Result/marker/Outbox；重启由current facts与rows重新收敛', 9013],
  'procurement-run-admission': ['Execution Basis验证前后、active Triage Rule解析前后、逐成员Selection/Control fence重验、Run/Basis rows写入、Control acquire/assert、typed Result/marker前后、响应前崩溃', '完整Basis、Run、全部run_selection、同Field Procurement Control和ProcurementControlReceipt全有或全无；Rule只能来自注入的Procurement Registry；任一成员stale或冲突整体rollback；不写Outbox', 7621],
  'procurement-candidate-publication': ['Package/Manifest验证前后、Run Selection子集重验、Package成员写入、Episode Claim/Related relation写入、Reservation转换、Offer/typed Result/marker/Outbox前后、响应前崩溃', 'Package、完整Manifest、全部Episode Claim/Related relation、全部candidate_delivery Reservation、唯一open Offer、typed Result、marker和Offer Outbox全有或全无；非精确Run Selection子集不得发布', 7622],
  'procurement-run-seal': ['Seal Decision验证前后、Run revision/basis CAS、逐成员terminal Evidence形成、Reservation转换、aggregate Evidence/typed Result/marker前后、响应前崩溃', 'Run sealed head、保留的candidate_delivery、全部released terminal members及逐成员Evidence、三项可重建digest、typed receipt和marker全有或全无；不释放Procurement Control且不写Outbox', 7623],
  'procurement-retry-admission': ['Intent state/digest CAS、current admission head恢复、逐成员precondition replay、consume snapshot写入、新Run/Basis/Selection/Control写入、typed Result/marker前后、响应前崩溃', 'Intent只终结一次；stale分支写完整head/member snapshot和closed primary reason且不建Run；valid分支与唯一新Run、完整Basis、Selection、Control Receipt和matched snapshots全有或全无；共享marker/result可稳定重放；不写Outbox', 7631],
  'perception-acquisition-page': ['第一次Source同步、第二次Acquisition首页、配置/scope不兼容重扫、Acquire后bounded inline payload冻结、Normalize前、Record/Anchor/Relation participant后、cursor head CAS前后、typed Result/marker/Outbox前后、响应前崩溃', '仅从未存在cursor row时logical expected revision为0/storage pointer为NULL；后续Acquisition冻结真实head且revision永不重置；Normalize只读取digest-bound inline DTO，pure Acquire不创建Artifact；任一验证/CAS失败整页rollback；同来源事实不重复；cursor不越过未提交页；同marker重放返回原typed Result及相同storage result digest；Outbox不通知Libra/Arca', 8527],
  'perception-resolution': ['Query Handle验证、候选检索前后、Record/Relation snapshot后、pure Resolver前后、Resolution/head/duplicate relation participant后、typed Result/marker前后', 'Handle携带可读取typed query；Assembler只读Perception Store并按Rule取得完整候选超集，不决定winner；Executor不旁读Store；被retracted/superseded或缺少请求kind的Record不能获胜；最高strength同值稳定found、同tier冲突稳定not_found；fuzzy match不生成duplicate；任一query/record-set/rule digest变化形成新revision；同三重digest重放返回同一typed Resolution', 8643],
  'people-candidate': ['typed Evidence恢复、Resolver产出complete Draft、Candidate head/open revision/typed Result/marker各边界；用户或strong rule接受前后；Registration Person/alias/provider identity与Merge target/source/preference/correlation提交各边界', 'CommitParticipant不旁读Foundation/Provider；Candidate payload digest可重算；重启不丢open Candidate；candidate revision或任一Person/Preference revision变化时整体CAS失败；接受成功时Candidate terminal与全部Person facts同时成立，同marker重放返回同一typed Result；弱Identity未经用户确认不建立Person，Preference冲突不得strong-rule自动接受', 8584],
  'direct-person-registration': ['Direct Person Registration提交前、Person/Identity/初始Projection checkpoint写入后、command receipt/Outbox前后、响应前崩溃', 'Person首revision、Alias/Provider Identity、初始Reference Projection checkpoint、durable result、command receipt和Outbox必须全有或全无；重放返回同一结果且不经过Candidate或建立Reference Fact', 11228],
  'people-reference-image': ['Reference Image导入后、Face检测/Embedding前后、Asset/Face/Reference head/Projection checkpoint各participant后、typed Result/marker/Outbox前后、响应前崩溃', '零Face、多Face、handle/digest/model不一致或stale Person/Reference revision整体失败；Asset与唯一Face同事务active或released；Reference revision和所有受影响Projection checkpoint连续；同marker重放返回原typed Result', 11228],
  'handoff-a-accepted': ['Candidate Delivery snapshot重建前后、global continuity head CAS前后、continuity match前后、并发Subject/episode/Resolved Identity exact anchor变化、target Intake CAS前后、Decision/Subject/Binding N:M relation participant后、Control participant前后、Result/marker/Outbox前', 'Snapshot的Offer/Package/Manifest/Location Evidence不一致即fail closed且不旁读proc_*修补；exact claim唯一命中且zero overlap才extension；0/N命中、缺失或overlap新建Subject；global head阻止query phantom，target head阻止唯一Subject stale extension；竞态使Decision失效后重新装配；new Subject identity pointer为NULL；要么全部不存在，要么global/target revision、Decision及match/overlap Evidence、Subject/claim/Episode scope、每Material Binding及全部Episode relation、Control、Receipt/Result/marker/Outbox全部成立；Procurement只异步消费Receipt', 9501],
  'handoff-a-rejected': ['Candidate/Material/Control Verification形成前后、Reason/Evidence rows逐项写入中途、Decision/Receipt/Result/marker/Outbox各边界、相同Offer的Accepted竞态', '只允许closed Handoff A reason；Continuity 0/N/overlap不得误判rejected；Decision、全部Reason Evidence、Receipt、Result、marker和Rejected Outbox全有或全无；不读写continuity head、不创建Subject/Binding、不转移Control；同一Offer只有一个terminal Decision', 9610],
  'procurement-handoff-a-rejection-consume': ['Inbox写入前后、open Delivery CAS前后、Reservation逐项释放中途、Delivery terminal与Inbox result提交前后、迟到Accepted消息', 'Delivery、全部Candidate member released+handoff_rejected、同一Receipt Evidence与Inbox result全有或全无；Procurement Material Control不变；重复消息重放同一closure digest，相反终态或digest冲突稳定拒绝', 9611],
  'procurement-failed-run-retry': ['Retry Intent commit前后、新Run建立前后、Intent consume前后', '旧Run始终sealed；一个Intent最多建立一个新Run；观察不伪造Basis revision；失败不会自动连锁重试', 8414],
  'libra-subject-abandon': ['Decision前、Subject terminal后、Primary Control release前后、Receipt/Outbox前', '要么Subject仍active且Control不变，要么abandoned/Primary released/Receipt全部成立；已有Run时Command稳定拒绝', 8415],
  'libra-deliverable-promotion': ['Workspace Identity计算后、Package participant后、Control acquire前后', 'Package可见时所有Product Material已有Libra Control；失败不发布Offer', 8416],
  'libra-run-discard': ['Decision前、Run terminal后、原始Input Control release前后、Cleanup Scope/Outbox前', '要么Run仍frozen且全部Control不变，要么discarded/原始Input released/Cleanup Scope完整成立；受Control Workspace Product不成为无Owner文件', 8417],
  'libra-workspace-cleanup': ['删除intent后、文件删除后Evidence前、Cleanup/Control commit前后', '删除效果幂等；只有Deletion Evidence成立的受Control Product释放Control；重启恢复同一Cleanup member', 8418],
  'handoff-b-accepted': ['Acceptance Decision、Custody/Binding、Control transfer、Receipt/Outbox各边界', 'Arca责任与Control一起成立；Libra Store不被Arca事务写入', 8419],
  'handoff-b-rejected': ['Acceptance check set形成前后、Attempt terminal CAS、Decision/Receipt/Result/marker/Outbox各边界、并发Accepted竞态', '只允许closed reason；rejected Attempt、Evidence set、Decision、Receipt、Result、marker和Outbox全有或全无；不建立Custody/Binding/On-deck Run、不转移Control；Accepted/Rejected互斥', 9617],
  'libra-handoff-b-rejection-consume': ['Inbox写入前后、Package digest CAS、Delivery Receipt写入前后、迟到Accepted消息', 'immutable Package与rejected Delivery Receipt/Inbox closure全有或全无；重复消息重放同一closure digest，相反终态或digest冲突稳定拒绝；不写Arca Store', 9618],
  'ondeck-fixed-transaction': ['Slot prepare、Stage、Switch、Final Primary verify、Settlement逐项、On-deck Commit', '已Settlement后只能向前恢复；Shelf Entry/Inventory/Deck/Control/Completion同一commit', 8420],
  'aftercare-basis-inventory': ['Standard/Placement/Decision Fact变化、Case create、Workspace output、Stage/Switch、Settlement、Inventory/Control commit', 'Case冻结完整Care Basis；旧Basis不能提交；原Shelf Entry/Identity/Deck持续；新Inventory revision与Control set一致', 8421],
  'offdeck-review-authorization': ['Review、Reservation、Scope、selection/escalation、Authorization/Case各边界', 'Authorization前不存在Case；Direct Intent不伪造Candidate；high-volume无独立Receipt不能授权；每Entry独立Scope/Case', 8422],
  'offdeck-destruction': ['Authorization后、逐Material delete、授权Identity被外部提前删除/被新Identity替换、Deletion verify、terminal commit', '授权Scope不扩张；已删Evidence不重做；授权Identity已不存在时Evidence必须证明精确absence且绝不触碰替代Identity；全部完成前Deck Fact不terminal，terminal时Control全部释放', 8423],
  'routing-template-publish': ['Preview后、revision insert后、current head切换前后、Shelf Standard refresh前后', 'Field只见一个current Routing Policy；Template current/binding可恢复；Arca不写Routing Priority', 8426],
  'command-idempotency': ['Owner业务修改后响应前崩溃、相同key同payload重试、相同key不同payload重试', 'Receipt与Owner修改同事务；同payload返回原result ref；不同payload稳定拒绝；不重复创建对象或推进revision', 8428],
  'shelf-deregistration': ['Release Manifest、逐Control CAS、administrative terminal commit', '不调用Delete；实际Physical data保持；Shelf/Entry terminal与Control release同事务', 8429],
  'effect-outbox-recovery': ['effect intent后、外部效果后receipt前、Outbox commit后dispatch前', '依据Effect Class reconcile，不统一重置ready；duplicate message/effect不重复提交', 8430]
});

const definitions = Object.freeze({
  'Domain Fact Commit': {
    commitClass: 'domain_fact_commit',
    writeTables: ['fx_event_result_bindings', 'fx_commit_markers', 'fx_outbox'],
    dynamicTableRequirements: [{ participant: 'domain', selector: 'DomainFactCommitHandle.factSchemaRef', ownerConstraint: 'execution_owner' }],
    readTables: [], fixtureRefs: ['command-idempotency', 'effect-outbox-recovery'], hasOutbox: true
  },
  'Field Observation Page Commit': {
    commitClass: 'domain_fact_commit',
    writeTables: ['proc_material_fields', 'proc_field_observations', 'proc_field_materials',
      'fx_event_result_bindings', 'fx_commit_markers'],
    readTables: ['proc_material_fields', 'proc_field_access_revisions', 'proc_field_observations',
      'proc_field_materials', 'fx_supporting_works'],
    fixtureRefs: ['field-observation-page'], hasOutbox: false
  },
  'Field Eligibility Reconcile Commit': {
    commitClass: 'domain_unit_of_work',
    writeTables: ['proc_field_materials'],
    readTables: ['proc_material_fields', 'proc_field_access_revisions', 'proc_extraction_policy_revisions',
      'proc_field_observations', 'proc_field_materials', 'proc_procurement_runs', 'proc_run_materials',
      'fx_material_controls'],
    fixtureRefs: ['field-eligibility-reconcile'], hasOutbox: false, commitMarkerRequired: false,
    forbiddenWriteTables: ['fx_material_controls', 'fx_material_control_revisions', 'fx_event_result_bindings',
      'fx_commit_markers', 'fx_outbox']
  },
  'Procurement Run Admission': {
    commitClass: 'responsibility_control_commit',
    writeTables: ['proc_procurement_runs', 'proc_run_materials', 'fx_material_controls',
      'fx_material_control_revisions', 'fx_event_result_bindings', 'fx_commit_markers'],
    readTables: ['proc_material_fields', 'proc_field_access_revisions', 'proc_field_observations',
      'proc_extraction_policy_revisions', 'proc_field_materials', 'proc_procurement_runs', 'proc_run_materials',
      'fx_material_controls'],
    fixtureRefs: ['procurement-run-admission'], hasOutbox: false
  },
  'Procurement Candidate Publication': {
    commitClass: 'domain_fact_commit',
    writeTables: ['proc_procurement_runs', 'proc_candidate_packages', 'proc_candidate_season_continuity_claims',
      'proc_candidate_primary_materials', 'proc_candidate_primary_material_episode_claims',
      'proc_candidate_related_references', 'proc_candidate_deliveries', 'proc_run_materials',
      'fx_event_result_bindings', 'fx_commit_markers', 'fx_outbox'],
    readTables: ['proc_procurement_runs', 'proc_run_materials'],
    fixtureRefs: ['procurement-candidate-publication'], hasOutbox: true
  },
  'Procurement Run Seal': {
    commitClass: 'domain_fact_commit',
    writeTables: ['proc_procurement_runs', 'proc_run_materials', 'fx_event_result_bindings', 'fx_commit_markers'],
    readTables: ['proc_procurement_runs', 'proc_run_materials', 'proc_candidate_packages'],
    fixtureRefs: ['procurement-run-seal'], hasOutbox: false
  },
  'Perception Acquisition Page Commit': {
    commitClass: 'domain_fact_commit',
    writeTables: ['perception_acquisitions', 'perception_source_cursors', 'perception_acquisition_commits',
      'perception_records', 'perception_identity_anchors', 'perception_record_relations',
      'fx_event_result_bindings', 'fx_commit_markers', 'fx_outbox'],
    readTables: ['perception_sources', 'perception_acquisitions', 'perception_source_cursors', 'perception_records'],
    fixtureRefs: ['perception-acquisition-page'], hasOutbox: true
  },
  'Perception Resolution Commit': {
    commitClass: 'domain_fact_commit',
    writeTables: ['perception_resolution_revisions', 'perception_resolution_heads', 'perception_record_relations',
      'fx_event_result_bindings', 'fx_commit_markers', 'fx_outbox'],
    readTables: ['perception_records', 'perception_identity_anchors', 'perception_record_relations',
      'perception_resolution_revisions', 'perception_resolution_heads'],
    fixtureRefs: ['perception-resolution'], hasOutbox: true
  },
  'People Candidate Commit': {
    commitClass: 'domain_fact_commit',
    writeTables: ['people_registration_candidates', 'people_registration_candidate_revisions',
      'people_merge_candidates', 'people_merge_candidate_revisions',
      'fx_event_result_bindings', 'fx_commit_markers', 'fx_outbox'],
    readTables: [], fixtureRefs: ['people-candidate'], hasOutbox: true
  },
  'People Candidate Acceptance': {
    commitClass: 'domain_fact_commit',
    writeTables: ['people_persons', 'people_person_revisions', 'people_aliases', 'people_provider_identities',
      'people_preference_revisions', 'people_registration_candidates', 'people_registration_candidate_revisions',
      'people_merge_candidates', 'people_merge_candidate_revisions', 'people_merge_records',
      'fx_event_result_bindings', 'fx_commit_markers', 'fx_outbox'],
    readTables: ['people_persons', 'people_person_revisions', 'people_preference_revisions',
      'people_registration_candidates', 'people_registration_candidate_revisions',
      'people_merge_candidates', 'people_merge_candidate_revisions'],
    fixtureRefs: ['people-candidate'], hasOutbox: true
  },
  'Direct Person Registration': {
    commitClass: 'domain_unit_of_work',
    writeTables: ['people_persons', 'people_person_revisions', 'people_aliases', 'people_provider_identities',
      'fx_event_result_bindings', 'fx_command_receipts', 'fx_commit_markers', 'fx_outbox'],
    readTables: [], fixtureRefs: ['direct-person-registration'], hasOutbox: true
  },
  'People Reference Image Commit': {
    commitClass: 'domain_fact_commit',
    writeTables: ['people_persons', 'people_reference_assets', 'people_reference_faces', 'people_reference_revisions',
      'fx_event_result_bindings', 'fx_commit_markers', 'fx_outbox'],
    readTables: ['people_persons', 'people_reference_assets', 'people_reference_faces', 'people_reference_revisions',
      'people_merge_records'],
    fixtureRefs: ['people-reference-image'], hasOutbox: true
  },
  'Procurement Retry Intent Commit': {
    commitClass: 'domain_unit_of_work',
    writeTables: ['proc_procurement_retry_intents', 'proc_procurement_retry_intent_materials',
      'fx_event_result_bindings', 'fx_commit_markers', 'fx_outbox'],
    readTables: ['proc_procurement_runs', 'proc_run_materials', 'proc_material_fields', 'proc_field_access_revisions',
      'proc_field_observations', 'proc_extraction_policy_revisions', 'proc_field_materials', 'fx_material_controls'],
    fixtureRefs: ['procurement-failed-run-retry'], hasOutbox: true
  },
  'Procurement Retry Admission': {
    commitClass: 'responsibility_control_commit',
    writeTables: ['proc_procurement_retry_intents', 'proc_procurement_retry_intent_materials',
      'proc_procurement_runs', 'proc_run_materials', 'fx_material_controls', 'fx_material_control_revisions',
      'fx_event_result_bindings', 'fx_commit_markers'],
    readTables: ['proc_procurement_retry_intents', 'proc_procurement_retry_intent_materials',
      'proc_procurement_runs', 'proc_run_materials', 'proc_material_fields', 'proc_field_access_revisions',
      'proc_field_observations', 'proc_extraction_policy_revisions', 'proc_field_materials', 'fx_material_controls'],
    fixtureRefs: ['procurement-retry-admission'], hasOutbox: false
  },
  'Field Routing Policy Publish': {
    commitClass: 'domain_unit_of_work',
    writeTables: ['libra_routing_policy_revisions', 'libra_routing_policy_targets', 'libra_field_routing_heads', 'fx_commit_markers', 'fx_outbox'],
    readTables: [], fixtureRefs: ['routing-template-publish'], hasOutbox: true
  },
  'Rule Template Publish': {
    commitClass: 'domain_unit_of_work',
    writeTables: ['arca_rule_template_revisions', 'arca_rule_templates', 'arca_shelf_standard_revisions', 'arca_shelves', 'fx_commit_markers', 'fx_outbox'],
    readTables: ['arca_rule_template_drafts'], fixtureRefs: ['routing-template-publish'], hasOutbox: true,
    forbiddenWriteTables: ['libra_routing_policy_revisions', 'libra_field_routing_heads']
  },
  'Handoff A Accepted': {
    commitClass: 'responsibility_control_commit',
    writeTables: ['libra_subject_continuity_heads', 'libra_intake_decisions', 'libra_intake_resolution_match_witnesses',
      'libra_intake_resolution_episode_overlaps', 'libra_handoff_a_receipts', 'libra_subjects',
      'libra_subject_season_continuity_claims', 'libra_subject_episode_scopes', 'libra_material_bindings',
      'libra_material_binding_episode_claims', 'fx_material_controls', 'fx_material_control_revisions',
      'fx_event_result_bindings', 'fx_commit_markers', 'fx_outbox'],
    readTables: ['libra_subject_continuity_heads', 'libra_intake_decisions', 'libra_intake_resolution_match_witnesses',
      'libra_intake_resolution_episode_overlaps', 'libra_handoff_a_receipts', 'libra_subjects',
      'libra_subject_season_continuity_claims', 'libra_subject_episode_scopes', 'libra_material_bindings',
      'libra_material_binding_episode_claims', 'fx_material_controls', 'fx_material_control_revisions',
      'fx_event_result_bindings', 'fx_commit_markers', 'fx_outbox'], fixtureRefs: ['handoff-a-accepted'], hasOutbox: true,
    forbiddenWritePrefixes: ['proc_']
  },
  'Handoff A Rejected': {
    commitClass: 'domain_fact_commit',
    writeTables: ['libra_intake_decisions', 'libra_intake_rejection_reason_evidence', 'libra_handoff_a_receipts',
      'fx_event_result_bindings', 'fx_commit_markers', 'fx_outbox'],
    readTables: ['libra_intake_decisions', 'libra_intake_rejection_reason_evidence', 'libra_handoff_a_receipts',
      'fx_event_result_bindings', 'fx_commit_markers', 'fx_outbox'],
    fixtureRefs: ['handoff-a-rejected'], hasOutbox: true,
    forbiddenWritePrefixes: ['proc_', 'arca_']
  },
  'Procurement Handoff A Rejection Consume': {
    commitClass: 'domain_unit_of_work',
    writeTables: ['proc_candidate_deliveries', 'proc_run_materials', 'fx_inbox'],
    readTables: ['proc_candidate_deliveries', 'proc_run_materials', 'fx_inbox'],
    fixtureRefs: ['procurement-handoff-a-rejection-consume'], hasOutbox: false, commitMarkerRequired: false,
    forbiddenWriteTables: ['fx_material_controls', 'fx_material_control_revisions']
  },
  'Libra Subject Abandon Commit': {
    commitClass: 'responsibility_control_commit',
    writeTables: ['libra_subject_abandon_decisions', 'libra_subjects', 'libra_subject_abandon_receipts', 'fx_material_controls', 'fx_material_control_revisions', 'fx_commit_markers', 'fx_outbox'],
    readTables: ['libra_runs', 'libra_material_bindings'], fixtureRefs: ['libra-subject-abandon'], hasOutbox: true
  },
  'Handoff B Accepted': {
    commitClass: 'responsibility_control_commit',
    writeTables: ['arca_acceptance_decisions', 'arca_ondeck_custodies', 'arca_material_bindings', 'arca_handoff_b_receipts', 'fx_material_controls', 'fx_material_control_revisions', 'fx_commit_markers', 'fx_outbox'],
    readTables: ['arca_acceptance_attempts', 'arca_acceptance_checks'], fixtureRefs: ['handoff-b-accepted'], hasOutbox: true,
    forbiddenWritePrefixes: ['libra_']
  },
  'Handoff B Rejected': {
    commitClass: 'domain_fact_commit',
    writeTables: ['arca_acceptance_attempts', 'arca_acceptance_decisions', 'arca_handoff_b_receipts',
      'fx_event_result_bindings', 'fx_commit_markers', 'fx_outbox'],
    readTables: ['arca_acceptance_attempts', 'arca_acceptance_decisions', 'arca_handoff_b_receipts',
      'fx_event_result_bindings', 'fx_commit_markers', 'fx_outbox', 'arca_acceptance_checks'],
    fixtureRefs: ['handoff-b-rejected'], hasOutbox: true,
    forbiddenWritePrefixes: ['libra_']
  },
  'Libra Handoff B Rejection Consume': {
    commitClass: 'domain_unit_of_work',
    writeTables: ['libra_product_packages', 'libra_delivery_receipts', 'fx_inbox'],
    readTables: ['libra_product_packages', 'libra_delivery_receipts', 'fx_inbox'],
    fixtureRefs: ['libra-handoff-b-rejection-consume'], hasOutbox: false, commitMarkerRequired: false,
    forbiddenWritePrefixes: ['arca_']
  },
  'Libra Deliverable Promotion': {
    commitClass: 'responsibility_control_commit',
    writeTables: ['libra_product_packages', 'libra_product_package_materials', 'fx_material_controls', 'fx_material_control_revisions', 'fx_commit_markers', 'fx_outbox'],
    readTables: ['libra_runs', 'libra_acceptance_specs', 'libra_product_fact_revisions'], fixtureRefs: ['libra-deliverable-promotion'], hasOutbox: true
  },
  'Libra Run Discard Commit': {
    commitClass: 'responsibility_control_commit',
    writeTables: ['libra_run_discard_decisions', 'libra_runs', 'libra_workspace_cleanup_scopes', 'libra_workspace_cleanup_members', 'libra_run_discard_receipts', 'fx_material_controls', 'fx_material_control_revisions', 'fx_commit_markers', 'fx_outbox'],
    readTables: ['libra_material_bindings', 'libra_workspace_material_refs'], fixtureRefs: ['libra-run-discard'], hasOutbox: true
  },
  'Libra Workspace Cleanup Commit': {
    commitClass: 'responsibility_control_commit',
    writeTables: ['libra_workspace_cleanup_members', 'libra_workspace_cleanup_scopes', 'fx_material_controls', 'fx_material_control_revisions', 'fx_commit_markers'],
    readTables: ['fx_workspace_materials'], fixtureRefs: ['libra-workspace-cleanup'], hasOutbox: false
  },
  'On-deck Commit': {
    commitClass: 'responsibility_control_commit',
    writeTables: ['arca_shelf_entries', 'arca_canonical_identity_revisions', 'arca_inventory_representations', 'arca_inventory_materials', 'arca_inventory_related_references', 'arca_inventory_product_facts', 'arca_inventory_person_relations', 'arca_deck_fact_revisions', 'arca_ondeck_commit_receipts', 'arca_offload_completions', 'fx_material_controls', 'fx_material_control_revisions', 'fx_commit_markers', 'fx_outbox'],
    readTables: ['arca_final_inventory_decisions', 'arca_ondeck_runs'], fixtureRefs: ['ondeck-fixed-transaction'], hasOutbox: true
  },
  'Aftercare Case Creation': {
    commitClass: 'domain_unit_of_work',
    writeTables: ['arca_aftercare_cases', 'arca_aftercare_case_basis_inputs', 'fx_commit_markers', 'fx_outbox'],
    readTables: ['arca_aftercare_assessments', 'arca_aftercare_findings', 'arca_shelf_entries'], fixtureRefs: ['aftercare-basis-inventory'], hasOutbox: true
  },
  'Aftercare Inventory Commit': {
    commitClass: 'responsibility_control_commit',
    writeTables: ['arca_inventory_representations', 'arca_inventory_materials', 'arca_inventory_related_references', 'arca_inventory_product_facts', 'arca_inventory_person_relations', 'arca_aftercare_inventory_commits', 'arca_shelf_entries', 'fx_material_controls', 'fx_material_control_revisions', 'fx_commit_markers'],
    readTables: ['arca_aftercare_cases'], fixtureRefs: ['aftercare-basis-inventory'], hasOutbox: false
  },
  'Off-deck Review Scope': {
    commitClass: 'domain_unit_of_work',
    writeTables: ['arca_offdeck_reviews', 'arca_offdeck_reservations', 'arca_offdeck_scopes', 'arca_offdeck_scope_materials', 'fx_commit_markers'],
    readTables: ['arca_shelf_entries', 'arca_inventory_materials'], fixtureRefs: ['offdeck-review-authorization'], hasOutbox: false,
    forbiddenWriteTables: ['arca_offdeck_authorizations', 'arca_offdeck_cases']
  },
  'Off-deck Batch Authorization Intent': {
    commitClass: 'domain_unit_of_work',
    writeTables: ['arca_offdeck_selection_receipts', 'arca_offdeck_escalation_receipts', 'arca_offdeck_authorization_batches', 'fx_commit_markers'],
    readTables: ['arca_offdeck_reviews', 'arca_offdeck_scopes', 'arca_offdeck_scope_materials'], fixtureRefs: ['offdeck-review-authorization'], hasOutbox: false,
    forbiddenWriteTables: ['arca_offdeck_authorizations', 'arca_offdeck_cases', 'arca_shelf_entries']
  },
  'Off-deck per-Entry Authorization/Case': {
    commitClass: 'domain_unit_of_work',
    writeTables: ['arca_offdeck_authorizations', 'arca_offdeck_cases', 'arca_offdeck_reviews', 'arca_offdeck_reservations', 'arca_offdeck_scopes', 'arca_shelf_entries', 'fx_commit_markers'],
    readTables: ['arca_offdeck_authorization_batches', 'arca_offdeck_selection_receipts'], fixtureRefs: ['offdeck-review-authorization'], hasOutbox: false
  },
  'Off-deck terminal': {
    commitClass: 'responsibility_control_commit',
    writeTables: ['arca_deck_fact_revisions', 'arca_shelf_entries', 'arca_offdeck_scopes', 'arca_offdeck_cases', 'arca_offdeck_terminal_receipts', 'fx_material_controls', 'fx_material_control_revisions', 'fx_commit_markers'],
    readTables: ['arca_offdeck_deletion_evidence', 'arca_offdeck_authorizations'], fixtureRefs: ['offdeck-destruction'], hasOutbox: false
  },
  'Shelf Deregistration Commit': {
    commitClass: 'responsibility_control_commit',
    writeTables: ['arca_deregistrations', 'arca_deregistration_releases', 'arca_deregistration_receipts', 'arca_shelves', 'arca_shelf_entries', 'arca_deck_fact_revisions', 'fx_material_controls', 'fx_material_control_revisions', 'fx_commit_markers'],
    readTables: ['arca_inventory_materials'], fixtureRefs: ['shelf-deregistration'], hasOutbox: false,
    forbiddenWriteTables: ['arca_offdeck_deletion_evidence'],
    forbiddenCapabilities: ['arca.offdeck.primary_material.delete@1', 'arca.offdeck.unreferenced_related.delete@1']
  }
});

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
  return value;
}

function digestValue(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function tableOwner(tableId) {
  if (tableId.startsWith('fx_material_control')) return 'material-control-authority';
  if (tableId.startsWith('fx_')) return 'execution-foundation';
  if (tableId.startsWith('proc_')) return 'procurement';
  if (tableId.startsWith('libra_')) return 'libra';
  if (tableId.startsWith('arca_')) return 'arca';
  if (tableId.startsWith('perception_')) return 'perception';
  if (tableId.startsWith('people_')) return 'people';
  if (tableId.startsWith('platform_')) return 'platform-settings';
  return null;
}

function participantsFor(owner, writeTables) {
  const groups = new Map();
  for (const table of writeTables) {
    const participantOwner = tableOwner(table);
    if (!groups.has(participantOwner)) groups.set(participantOwner, []);
    groups.get(participantOwner).push(table);
  }
  return [...groups].map(([participantOwner, tables]) => ({
    participantKind: participantOwner === 'execution-foundation' ? 'foundation' : participantOwner === 'material-control-authority' ? 'material-control' : 'domain',
    owner: participantOwner === 'domain' ? owner : participantOwner,
    access: 'write', tables
  }));
}

function buildCrashFixture(id) {
  const fixture = crashFixtures[id];
  if (!fixture) throw new Error(`Unknown crash fixture: ${id}`);
  return { fixtureId: id, faultInjectionPoints: fixture[0], requiredInvariant: fixture[1], source: { section: '8.9.7', line: fixture[2] } };
}

function buildTransactionContracts(entries) {
  return entries.map((entry) => {
    const definition = definitions[entry.id];
    if (!definition) throw new Error(`Missing transaction contract definition: ${entry.id}`);
    const writeTables = [...definition.writeTables];
    if (definition.commitClass === 'responsibility_control_commit' && !writeTables.includes('fx_event_result_bindings')) {
      const markerIndex = writeTables.indexOf('fx_commit_markers');
      writeTables.splice(markerIndex < 0 ? writeTables.length : markerIndex, 0, 'fx_event_result_bindings');
    }
    const materialControlRequired = definition.commitClass === 'responsibility_control_commit';
    const participants = participantsFor(entry.owner, writeTables);
    for (const dynamic of definition.dynamicTableRequirements || []) participants.unshift({
      participantKind: dynamic.participant,
      owner: dynamic.ownerConstraint,
      access: 'write',
      tables: [],
      dynamicTableSelector: dynamic.selector
    });
    return {
      transactionId: `helix.transaction.${slug(entry.id)}`,
      displayName: entry.id,
      ownerScope: entry.owner,
      commitClass: definition.commitClass,
      atomicFactSet: entry.atomicFactSet,
      participants,
      writeTables,
      readTables: definition.readTables,
      dynamicTableRequirements: definition.dynamicTableRequirements || [],
      forbiddenWriteTables: definition.forbiddenWriteTables || [],
      forbiddenWritePrefixes: definition.forbiddenWritePrefixes || [],
      forbiddenCapabilities: definition.forbiddenCapabilities || [],
      fenceContract: {
        domainRevisionFenceRequired: true,
        materialControlCasRequired: materialControlRequired,
        commitMarkerRequired: definition.commitMarkerRequired !== false,
        outboxRequired: definition.hasOutbox
      },
      rollbackInvariant: 'Any participant, revision fence, digest, or CAS failure leaves zero transaction writes visible; no commit marker, receipt, or outbox may survive alone.',
      crashFixtures: definition.fixtureRefs.map(buildCrashFixture),
      source: entry.source
    };
  });
}

module.exports = Object.freeze({ buildTransactionContracts, crashFixtures, definitions, digestValue, slug, tableOwner });
