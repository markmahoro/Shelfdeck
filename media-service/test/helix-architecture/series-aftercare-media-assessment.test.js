'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {canonicalDigest,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {assessInventoryMediaConformance}=require('../../src/helix/domains/arca/capabilities/aftercare-capability-ports');
const {createAftercareCapabilityPorts}=require('../../src/helix/domains/arca/capabilities/aftercare-capability-ports');
const {CAPABILITY_REFS:C}=require('../../src/helix/domains/arca/model/aftercare-contract');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');

async function fixture(t,specs,maximum=10) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'series-care-media-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const fingerprint=location=>({stat:fs.statSync(location),fingerprintAlgorithm:'sha256',fingerprintVersion:1,
    contentFingerprint:canonicalDigest(fs.readFileSync(location).toString('hex'))});
  const materials=specs.map(([size,episodes],i)=>{
    const location=path.join(root,i+'.mkv');fs.writeFileSync(location,Buffer.alloc(size,i));
    const observed=fingerprint(location),identity={mountScopeId:'mount',inode:String(observed.stat.ino),sizeBytes:size,
      fingerprintAlgorithm:observed.fingerprintAlgorithm,fingerprintVersion:1,contentFingerprint:observed.contentFingerprint};
    const claims=episodes.map(episodeKey=>{const value={episodeKey,seasonClaimDigest:canonicalDigest('season')};return {...value,claimDigest:canonicalDigest({schema:'libra.production-material-episode-claim@1',...value})};}).sort((a,b)=>Buffer.from(a.episodeKey).compare(Buffer.from(b.episodeKey))),
      episodeClaimSetDigest=canonicalDigest({schema:'libra.production-material-episode-claims@1',items:claims});
    return {inode:identity.inode,fingerprint_algorithm:identity.fingerprintAlgorithm,fingerprint_version:1,role:'primary_payload',location,size_bytes:size,material_key:canonicalDigest({schema:'physical-material-identity@2',...identity}),
      mount_scope_id:'mount',endpoint_id:'endpoint',binding_revision:1,content_fingerprint:identity.contentFingerprint,
      episode_claims_schema_ref:'helix://contracts/application-types/ArcaMaterialEpisodeClaims/v1',episode_claim_set_digest:episodeClaimSetDigest,
      episode_claims_json:canonicalJson({items:claims,episodeClaimSetDigest})};
  });
  const context={shelfEntryId:'entry',basis:{digest:canonicalDigest('basis')},raw:{entry:{structure_kind:'season',current_inventory_revision:1},materials,facts:[],
    standard:{value:{profileRuleSets:[{contentProfile:'series',baseRequirements:{mandatoryMedia:{videoCodec:'hevc'},space:{maxSizeBytes:maximum}}}]}}}};
  const probed=[],played=[],options={computeBoundedMaterialFingerprintSync:fingerprint,
    mediaProbe:{async probe(handle){probed.push(handle.identity.materialKey);return {resultKind:'probed',durationMs:1000,
      container:'matroska',videoStreams:[{streamIndex:0,codec:'hevc',dispositionDefault:true,width:1920,height:1080}],audioStreams:[]};}},
    async aftercarePlaybackRunner(_binary,args){played.push(args[args.indexOf('-i')+1]);}};
  return {context,options,materials,probed,played,run:()=>assessInventoryMediaConformance(options,context,1000)};
}
const codes=result=>result.findings.map(item=>item.schemaRef.split('/')[5]);

test('Aftercare evaluates all Season files without using the Season total as an Episode cap',async t=>{
  const f=await fixture(t,[[10,['E01']],[10,['E02']],[10,['E03']]]),result=await f.run();
  assert.deepEqual(codes(result),[]);assert.equal(result.mediaRepairStrategy,null);
  assert.deepEqual(f.probed,f.materials.map(item=>item.material_key));assert.equal(f.played.length,9);
});
test('Aftercare shares bytes across Episodes and adds all same-Episode parts',async t=>{
  const f=await fixture(t,[[12,['E01','E02']],[4,['E01']]]);
  assert.deepEqual(codes(await f.run()),[]);
  f.context.raw.standard.value.profileRuleSets[0].baseRequirements.space.maxSizeBytes=9;
  const failed=await f.run();assert.deepEqual(codes(failed),['max_size_exceeded']);
  assert.match(failed.findings[0].schemaRef,/attention_required/);
  f.materials.reverse();assert.deepEqual((await f.run()).findings,failed.findings);
});
test('Aftercare does not round fractional bytes down at the limit',async t=>{
  const f=await fixture(t,[[13,['E01','E02']],[4,['E01']]]);
  assert.deepEqual(codes(await f.run()),['max_size_exceeded']);
});
test('Aftercare reports a later member codec gap and does not schedule the first file for repair',async t=>{
  const f=await fixture(t,[[8,['E01']],[8,['E02']]]),probe=f.options.mediaProbe.probe;
  f.options.mediaProbe.probe=async handle=>{const value=await probe(handle);if(handle.location===f.materials[1].location)value.videoStreams[0].codec='h264';return value;};
  const result=await f.run();assert.deepEqual(codes(result),['video_codec_unmet']);
  assert.equal(result.mediaRepairStrategy,null);assert.match(result.findings[0].schemaRef,/attention_required/);
});
test('Aftercare reports decode failure from a later member',async t=>{
  const f=await fixture(t,[[8,['E01']],[8,['E02']]]);
  f.options.aftercarePlaybackRunner=async(_binary,args)=>{if(args.includes(f.materials[1].location))throw Object.assign(new Error('Decode failed'),{code:'ARCA_AFTERCARE_MEDIA_FAILED'});};
  assert.deepEqual(codes(await f.run()),['playback_decode_failed']);
});
test('Aftercare groups equal conditions while binding every affected member',async t=>{
  const f=await fixture(t,Array.from({length:24},(_,i)=>[8,['E'+i]])),probe=f.options.mediaProbe.probe;
  f.options.mediaProbe.probe=async handle=>({...await probe(handle),resultKind:'not_media'});
  const result=await f.run();assert.deepEqual(codes(result),['primary_decode_failed']);assert.equal(f.probed.length,24);
  f.materials.reverse();assert.deepEqual((await f.run()).findings,result.findings);
  f.options.mediaProbe.probe=async handle=>handle.location===f.materials[0].location?probe(handle):({...await probe(handle),resultKind:'not_media'});
  assert.notEqual((await f.run()).findings[0].snapshotDigest,result.findings[0].snapshotDigest);
});
for(const change of ['before','during','earlier_member'])test('Aftercare rejects physical identity drift '+change,async t=>{
  const f=await fixture(t,[[8,['E01']],[8,['E02']]]),probe=f.options.mediaProbe.probe;
  const mutate=()=>fs.writeFileSync(f.materials[0].location,Buffer.alloc(8,99));
  if(change==='before')mutate();
  else f.options.mediaProbe.probe=async handle=>{if(change==='during'||handle.location===f.materials[1].location)mutate();return probe(handle);};
  await assert.rejects(f.run(),{code:'ARCA_AFTERCARE_INPUT_STALE'});
  if(change==='before')assert.equal(f.probed.length,0);
});
for(const invalid of ['duplicate_material','empty_claims','duplicate_claims','missing_claims'])test('Aftercare refuses malformed Series scope '+invalid,async t=>{
  const f=await fixture(t,[[8,['E01']],[8,['E02']]]);
  if(invalid==='duplicate_material')f.materials.push(f.materials[0]);
  if(invalid==='empty_claims')f.materials[1].episode_claims_json='{"items":[]}';
  if(invalid==='duplicate_claims')f.materials[1].episode_claims_json='{"items":[{"episodeKey":"E02"},{"episodeKey":"E02"}]}';
  if(invalid==='missing_claims')f.materials[1].episode_claims_json='{}';
  await assert.rejects(f.run(),invalid==='duplicate_material'?TypeError:{code:'ARCA_EPISODE_CLAIMS_PERSISTENCE'});assert.equal(f.probed.length,0);
});

test('formal Conformance Capability evaluates the complete Series set and emits valid evidence',async t=>{
  const f=await fixture(t,[[13,['E01','E02']],[4,['E01']]]),c=f.context;
  Object.assign(c.basis,{inventoryRevision:1,standardRevision:1,placementRevision:1,decisionFactSetDigest:canonicalDigest([])});
  c.raw.shelf={target_root_location:path.dirname(f.materials[0].location),target_endpoint_id:'endpoint'};
  c.raw.initialPlacementDecision={target_location:c.raw.shelf.target_root_location,target_endpoint_id:'endpoint'};
  c.raw.initialPlacement={value:{}};c.raw.placement={value:{}};
  let custody={assessmentState:'healthy',findingDrafts:[]};
  let memberRows=[];
  const ports=createAftercareCapabilityPorts({...f.options,now:()=>1000,
    schemaManifest:require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),
    unitOfWork:{execute(){throw new Error('Assessment must not write to persistence.');}},
    contextReader:{read:()=>c,store:{}},workResultReader:{read:()=>[{outcomeKind:'succeeded',capabilityRef:C.custody,result:custody},...memberRows]}});
  const execution={ownerScope:{processId:c.shelfEntryId},workId:'work',workAttemptId:'attempt',planId:'plan',namedInputs:{careBasis:{},inventoryRevision:{},knownBindings:{},standard:{},placement:{}}};
  const {seriesMemberAssessmentEventId}=require('../../src/helix/domains/arca/model/series-care-media-space');
  for(const member of f.materials) {
    const eventId=seriesMemberAssessmentEventId(execution.workAttemptId,member.material_key),result=
      (await ports[C.conformance].execute({...execution,eventId,parameters:{materialKey:member.material_key}})).result;
    memberRows.push({eventId,workId:'work',attemptId:'attempt',planId:'plan',resultId:'result-'+eventId,
      inputBindingDigest:canonicalDigest(eventId),capabilityRef:C.conformance,outcomeKind:'succeeded',result,resultDigest:canonicalDigest(result)});
  }
  ports[C.conformance].validateInputs(execution);
  const result=await ports[C.conformance].execute(execution);
  ports[C.conformance].validateResult(execution,result);
  validateConformanceResult(result.result);
  assert.equal(result.kind,'succeeded');assert.equal(result.result.assessmentState,'degraded');
  assert.deepEqual(codes({findings:result.result.findingDrafts}),['max_size_exceeded']);
  assert.equal(f.probed.length,2);assert.equal(f.played.length,6);
  assert.equal(result.result.memberAssessmentSet.memberCount,2);
  const original=memberRows;
  memberRows=[...original].reverse();assert.deepEqual((await ports[C.conformance].execute(execution)).result,result.result);
  for(const mutate of [rows=>rows.pop(),rows=>rows.push(rows[0]),rows=>{rows[0].workId='foreign';},
    rows=>{rows[0].attemptId='old';},rows=>{rows[0].planId='old';},rows=>{rows[0].eventId='foreign';},
    rows=>{rows[0].resultDigest=canonicalDigest('wrong');},rows=>{rows[0].result.memberScope.maxOutputBytes++;rows[0].resultDigest=canonicalDigest(rows[0].result);},
    rows=>{rows[0].outcomeKind='failed';}]) {
    memberRows=structuredClone(original);mutate(memberRows);await assert.rejects(ports[C.conformance].execute(execution));
  }
  memberRows=original;
  assert.equal(f.probed.length,2,'Aggregation must consume frozen observations without probing again.');
  custody={assessmentState:'not_assessable',incidentKey:'incident'};
  const blocked=await ports[C.conformance].execute(execution);
  assert.equal(blocked.result.assessmentState,'not_assessable');assert.equal(f.probed.length,2);
});

test('Movie retains its physical size check and single-source assessment behavior',async t=>{
  const f=await fixture(t,[[12,['E01']]]);
  f.context.raw.entry.structure_kind='single';
  f.context.raw.standard.value.profileRuleSets[0].contentProfile='movie';
  assert.deepEqual(codes(await f.run()),['max_size_exceeded']);assert.equal(f.played.length,3);
});

const {evaluateSeriesCareMediaSpace}=require('../../src/helix/domains/arca/model/series-care-media-space');
const {mediaRepairSource,assessMediaRepairStrategy,aftercareMediaProbeEvidence}=
  require('../../src/helix/domains/arca/capabilities/aftercare-capability-ports');
const {deriveAftercareSizeBudget}=require('../../src/helix/domains/arca/model/aftercare-media-policy');
test('Arca derives conservative physical budgets from its own complete Inventory and keeps byte acceptance separate',async t=>{
  const f=await fixture(t,[[12,['E01','E02']],[4,['E01']]]),value=evaluateSeriesCareMediaSpace(f.context,9),
    budget=key=>value.memberBudgets.find(item=>item.materialKey===key).maxOutputBytes;
  assert.equal(budget(f.materials[0].material_key),10);assert.equal(budget(f.materials[1].material_key),3);
  assert.equal(value.episodeAllocations.find(item=>item.episodeKey==='E01').withinLimit,false);
  assert.equal(value.inventoryRevision,1);assert.equal(value.careBasisDigest,f.context.basis.digest);
  f.materials.reverse();assert.deepEqual(evaluateSeriesCareMediaSpace(f.context,9),value);
  assert.ok(evaluateSeriesCareMediaSpace(f.context,null).memberBudgets.every(item=>item.maxOutputBytes===null));
});
test('Arca media space basis binds current Inventory, binding, Care Basis and limit',async t=>{
  const f=await fixture(t,[[12,['E01','E02']]]),baseline=evaluateSeriesCareMediaSpace(f.context,9).basisDigest;
  for(const mutate of [c=>{c.raw.entry.current_inventory_revision++;},c=>{c.basis.digest=canonicalDigest('new');},
    c=>{c.raw.materials[0].binding_revision++;},c=>{c.raw.materials[0].location+='-moved';}]) {
    const c=structuredClone(f.context);mutate(c);assert.notEqual(evaluateSeriesCareMediaSpace(c,9).basisDigest,baseline);
  }
  assert.notEqual(evaluateSeriesCareMediaSpace(f.context,10).basisDigest,baseline);
});
test('Arca media space refuses corrupted formal identity or Claims before planning any budget',async t=>{
  const f=await fixture(t,[[8,['E01']]]);
  for(const mutate of [c=>{c.raw.materials[0].size_bytes++;},c=>{c.raw.materials[0].episode_claim_set_digest=canonicalDigest('wrong');},
    c=>{c.raw.materials[0].episode_claims_json=' '+c.raw.materials[0].episode_claims_json;},c=>{c.raw.entry.current_inventory_revision=0;}]) {
    const c=structuredClone(f.context);mutate(c);assert.throws(()=>evaluateSeriesCareMediaSpace(c,9));
  }
});

function strategyFixture(f) {
  const device={deviceId:'gpu',deviceClass:'intel_qsv',snapshotDigest:canonicalDigest('gpu'),
    capabilityPayload:{supportedVideoCodecs:['hevc'],supportedRateControlModes:['target_size','quality_bound'],
      validatedVideoPipelines:[{pipelineProfileId:'ordinary_to_hevc@1',inputDynamicRangeKinds:['sdr'],inputPixelFormats:['yuv420p']}]}};
  Object.assign(device,{probeRevision:1,capabilitySchemaRef:'platform.compute-capability@1',enabled:true,state:'ready',workerRef:null});
  device.capabilityPayload.validatedConcurrentSlots=1;
  Object.assign(device.capabilityPayload.validatedVideoPipelines[0],{outputCodec:'hevc',outputDynamicRangeKind:'sdr',outputPixelFormat:'yuv420p',
    outputColorProfile:{range:'source',primaries:'source',transfer:'source',matrix:'source'},selfTestDigest:canonicalDigest('self-test')});
  device.capabilityDigest=canonicalDigest(device.capabilityPayload);
  device.snapshotDigest=canonicalDigest(Object.fromEntries(Object.entries(device).filter(([key])=>key!=='snapshotDigest')));
  const probe={resultKind:'probed',container:'matroska',durationMs:6000,
    videoStreams:[{streamIndex:0,codec:'h264',width:1920,height:1080,dispositionDefault:true,dynamicRangeKind:'sdr',pixelFormat:'yuv420p'}],
    audioStreams:[],subtitleStreams:[]};
  let reads=0;
  const options={mediaEffectPort:{verifyTranscodeInput(){throw new Error('Strategy assessment cannot execute an encoder.');}},
    platformComputeRuntime:{listReadyDeviceRefs(){reads++;return {resultKind:'available',items:[{deviceId:'gpu',probeRevision:1,capabilityDigest:device.snapshotDigest}]};},
      readDeviceSnapshot:()=>({resultKind:'found',snapshot:device})}};
  const evidence=(key,context=f.context,raw=probe)=>{const source=mediaRepairSource(context,key);
    return aftercareMediaProbeEvidence(raw,source.readHandle,source.primary.size_bytes,1000);};
  return {probe,options,evidence,reads:()=>reads,
    run:(key,context=f.context)=>assessMediaRepairStrategy(options,context,probe,evidence(key,context),key)};
}

test('Series strategy binds each explicit member and uses its physical budget without rewriting Episode requirements',async t=>{
  const MiB=1024**2,f=await fixture(t,[[12,['E01','E02']],[4,['E01']]],90*MiB);
  // Structural planning consumes formal snapshots, not file bytes or encoders.
  for(const member of f.materials)setStrategySourceSize(member,member.size_bytes*10*MiB);
  const s=strategyFixture(f),before=canonicalJson(f.context);
  const strategies=[];
  for(const member of f.materials) {
    const source=mediaRepairSource(f.context,member.material_key),strategy=await s.run(member.material_key),
      expected=deriveAftercareSizeBudget({maxSizeBytes:source.requirements.space.maxSizeBytes,qualityPolicyMaxSizeBytes:90*MiB,sourceSizeBytes:member.size_bytes,
        durationMs:s.probe.durationMs,videoStreams:s.probe.videoStreams,audioStreams:[],subtitleStreams:[]});
    assert.equal(strategy.sourceHandleDigest,canonicalDigest(source.readHandle));
    assert.equal(strategy.sourceProbeEvidenceDigest,canonicalDigest(s.evidence(member.material_key)));
    assert.equal(strategy.video.targetVideoBitrateBps,expected.targetVideoBitrateBps);
    assert.equal(strategy.video.rateControlMode,'target_size');strategies.push(strategy);
  }
  assert.notEqual(strategies[0].strategyDigest,strategies[1].strategyDigest);
  assert.equal(canonicalJson(f.context),before);
  f.materials.reverse();assert.deepEqual(await s.run(f.materials[0].material_key),strategies[1]);
});

function setStrategySourceSize(member,sizeBytes) {
  member.size_bytes=sizeBytes;
  member.material_key=canonicalDigest({schema:'physical-material-identity@2',mountScopeId:member.mount_scope_id,inode:member.inode,
    sizeBytes,fingerprintAlgorithm:member.fingerprint_algorithm,fingerprintVersion:member.fingerprint_version,contentFingerprint:member.content_fingerprint});
}

test('Series shared-file budgets retain the original per-Episode quality policy floor',async t=>{
  const GiB=1024**3,f=await fixture(t,[[8,['E01','E02']]],2*GiB),member=f.materials[0];
  setStrategySourceSize(member,8*GiB);
  const s=strategyFixture(f);s.probe.durationMs=30_000_000;s.probe.videoStreams[0].bitRateBps=8_000_000;
  const source=mediaRepairSource(f.context,member.material_key),strategy=await s.run(member.material_key);
  assert.equal(source.requirements.space.maxSizeBytes,4*GiB);
  assert.equal(source.qualityPolicyMaxSizeBytes,2*GiB);
  assert.equal(strategy.video.targetVideoBitrateBps,1_500_000);
  assert.equal(f.context.raw.standard.value.profileRuleSets[0].baseRequirements.space.maxSizeBytes,2*GiB);
});

test('Series strategy rejects implicit, foreign and non-primary sources and mismatched Probe Evidence before reading devices',async t=>{
  const f=await fixture(t,[[8,['E01']],[8,['E02']]]),s=strategyFixture(f),key=f.materials[1].material_key;
  for(const selected of [undefined,'missing'])await assert.rejects(
    assessMediaRepairStrategy(s.options,f.context,s.probe,s.evidence(key),selected),TypeError);
  f.materials.push({...f.materials[0],material_key:'poster',role:'poster'});
  await assert.rejects(assessMediaRepairStrategy(s.options,f.context,s.probe,s.evidence(key),'poster'),TypeError);
  await assert.rejects(assessMediaRepairStrategy(s.options,f.context,s.probe,s.evidence(f.materials[0].material_key),key),TypeError);
  const changed={...s.evidence(key),durationMs:999};
  await assert.rejects(assessMediaRepairStrategy(s.options,f.context,s.probe,changed,key),TypeError);
  await assert.rejects(assessMediaRepairStrategy(s.options,f.context,{...s.probe,durationMs:9000},s.evidence(key),key),TypeError);
  assert.equal(s.reads(),0);
});

test('Series strategy digest binds other members even when the selected physical budget is unchanged',async t=>{
  const f=await fixture(t,[[8*1024**2,['E01']],[8*1024**2,['E02']]],null),s=strategyFixture(f),key=f.materials[1].material_key,
    baseline=await s.run(key),changed=structuredClone(f.context);
  changed.raw.materials[0].binding_revision++;
  const next=await s.run(key,changed);
  assert.deepEqual(next.video,baseline.video);
  assert.equal(next.sourceHandleDigest,baseline.sourceHandleDigest);
  assert.notEqual(next.selectedPreflightDigest,baseline.selectedPreflightDigest);
  assert.notEqual(next.strategyDigest,baseline.strategyDigest);
});

test('Series zero-byte or rounded-zero physical budgets never become unbounded strategies',async t=>{
  for(const specs of [[[0,['E01']]],[[1,['E01']],[100,['E01']]]]) {
    const f=await fixture(t,specs,1),s=strategyFixture(f),key=f.materials[0].material_key;
    assert.equal(mediaRepairSource(f.context,key).requirements.space.maxSizeBytes,0);
    assert.equal(await s.run(key),null);
  }
});

test('formal member Conformance Results retain independent strategies within the 64 KiB persistence boundary',async t=>{
  const f=await fixture(t,[[8,['E01']],[8,['E02']]],null),s=strategyFixture(f),c=f.context;
  Object.assign(c.basis,{inventoryRevision:1,standardRevision:1,placementRevision:1,decisionFactSetDigest:canonicalDigest([])});
  let custody={assessmentState:'healthy',findingDrafts:[]};
  const ports=createAftercareCapabilityPorts({...f.options,...s.options,now:()=>1000,
    mediaProbe:{probe:async handle=>{f.probed.push(handle.identity.materialKey);return s.probe;}},
    schemaManifest:require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),
    unitOfWork:{execute(){throw new Error('Member observations must not write Owner data.');}},
    contextReader:{read:()=>c,store:{}},workResultReader:{read:()=>[{outcomeKind:'succeeded',capabilityRef:C.custody,result:custody}]}});
  const execute=key=>ports[C.conformance].execute({ownerScope:{processId:c.shelfEntryId},workId:'work',parameters:{materialKey:key},
    namedInputs:{careBasis:{},inventoryRevision:{},knownBindings:{},standard:{},placement:{}}});
  const results=[];
  for(const member of f.materials) {
    const result=(await execute(member.material_key)).result;validateConformanceResult(result);
    assert.equal(result.memberScope.materialKey,member.material_key);
    assert.equal(result.mediaRepairStrategy.sourceHandleDigest,result.memberScope.sourceHandleDigest);
    assert.equal(result.memberScope.maxOutputBytes,null);
    assert.equal(result.assessmentState,'degraded');assert.ok(result.findingDrafts.every(item=>item.schemaRef.includes('attention_required')));
    assert.ok(Buffer.byteLength(canonicalJson(result))<65536);results.push(result);
  }
  assert.notEqual(results[0].evidenceId,results[1].evidenceId);
  assert.deepEqual(f.probed,f.materials.map(item=>item.material_key));assert.equal(f.played.length,6);
  const invalid=structuredClone(results[0]);invalid.memberScope.extra='not-declared';assert.throws(()=>validateConformanceResult(invalid));
  custody={assessmentState:'not_assessable',incidentKey:'incident'};
  const blocked=(await execute(f.materials[1].material_key)).result;validateConformanceResult(blocked);
  assert.equal(blocked.assessmentState,'not_assessable');assert.equal(blocked.mediaRepairStrategy,null);
  assert.equal(blocked.memberScope.materialKey,f.materials[1].material_key);assert.equal(f.probed.length,2);
  c.raw.entry.structure_kind='single';await assert.rejects(execute(f.materials[0].material_key),TypeError);
});

test('professional Assessment commit excludes member evidence rather than persisting extra health dimensions',()=>{
  const basis={digest:canonicalDigest('basis'),inventoryRevision:1,standardRevision:1,placementRevision:1,decisionFactSetDigest:canonicalDigest([])},
    context={shelfEntryId:'entry',basis},sentinel=new Error('Captured Owner commit input');
  let captured;
  const rows=['custody','presentation','conformance'].map(kind=>({outcomeKind:'succeeded',capabilityRef:C[kind],result:{
    evidenceId:kind,careBasisDigest:basis.digest,evidenceKind:'arca_aftercare_'+kind,assessmentState:'healthy',incidentKey:null,
    payloadDigest:canonicalDigest(kind),findingDrafts:[]}}));
  rows.push({...rows[2],result:{...rows[2].result,evidenceId:'member',memberScope:{materialKey:canonicalDigest('member')}}});
  const ports=createAftercareCapabilityPorts({computeBoundedMaterialFingerprintSync(){throw new Error('Assessment commit must not probe files.');},
    schemaManifest:require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),
    unitOfWork:{execute(){throw new Error('No persistence expected before the Owner capture.');}},
    contextReader:{read:()=>context,store:{commitAssessmentSet(value){captured=value;throw sentinel;}}},workResultReader:{read:()=>rows}});
  assert.throws(()=>ports[C.assessmentCommit].execute({ownerScope:{processId:'entry'},workId:'work',namedInputs:{
    professionalAssessmentsSharingOneCareBasis:{careBasisDigest:basis.digest,assessments:[{},{},{}]},domainFactCommitHandle:{}}}),error=>error===sentinel);
  assert.deepEqual(captured.assessments.map(item=>item.assessmentId),['custody','presentation','conformance']);
});

test('Series health Planner schedules every Primary and makes aggregate Conformance depend on the complete set',async t=>{
  const f=await fixture(t,Array.from({length:24},(_,i)=>[8,['E'+String(i+1).padStart(3,'0')]])),
    {createHealthAssessmentPlanner}=require('../../src/helix/domains/arca/planning/aftercare-planners'),
    {validateWorkflowPlan}=require('../../src/helix/foundation/execution/workflow-plan'),
    refs=[C.custody,C.presentation,C.conformance,C.assessmentCommit],root=path.resolve(__dirname,'../../src/helix/contracts/capabilities'),
    directory=ref=>path.join(root,...ref.replace('@1','').split('.'),'v1'),
    manifests=new Map(refs.map(ref=>[ref,JSON.parse(fs.readFileSync(path.join(directory(ref),'manifest.json'),'utf8'))])),
    registry={snapshot:refs.map(capabilityRef=>({capabilityRef,contractVersion:1})),resolve:capabilityRef=>({manifest:manifests.get(capabilityRef)})},
    policyRegistry={digest:canonicalDigest('policy'),bindingFor:()=>({retryPolicyRef:'retry@1',timeoutPolicyRef:'timeout@1'})},
    planner=createHealthAssessmentPlanner({registry,policyRegistry,contextReader:{read:()=>f.context}}),
    request={workId:'work',workAttemptId:'attempt',ownerDomain:'arca',processType:'arca_shelf_entry',processId:'entry',executionBasisDigest:f.context.basis.digest},
    plan=planner.plan(request),members=plan.nodes.filter(node=>node.parameters.materialKey),
    aggregate=plan.nodes.find(node=>node.nodeId==='conformance');
  const schemas=refs.flatMap(ref=>['parameters','resource-demand','fence'].map(kind=>JSON.parse(fs.readFileSync(path.join(directory(ref),kind+'.schema.json'),'utf8'))));
  validateWorkflowPlan(plan,{registry,policyRegistry,contractValidator:createCapabilityContractValidator({schemas})});
  assert.equal(members.length,24);assert.equal(new Set(members.map(node=>node.eventId)).size,24);
  assert.deepEqual(members.map(node=>node.parameters.materialKey).sort(),f.materials.map(item=>item.material_key).sort());
  assert.deepEqual(aggregate.dependsOn.map(item=>item.eventId),members.map(node=>node.eventId));
  f.materials.reverse();assert.deepEqual(planner.plan(request),plan);
  assert.throws(()=>planner.plan({...request,executionBasisDigest:canonicalDigest('old')}));
  f.context.raw.entry.structure_kind='single';assert.equal(planner.plan(request).nodes.length,4);
});

function validateConformanceResult(result) {
  const schema=require('../../src/helix/contracts/types/ConformanceAssessmentEvidence/v1/schema.json');
  const schemas=new Map(),contractsRoot=path.resolve(__dirname,'../../src/helix/contracts');
  function loadSchema(value) {
    if(schemas.has(value.$id))return;
    schemas.set(value.$id,value);
    function visit(node) {
      if(!node||typeof node!=='object')return;
      if(node.$ref?.startsWith('helix://contracts/')) {
        const ref=node.$ref.split('#')[0];
        loadSchema(JSON.parse(fs.readFileSync(path.join(contractsRoot,ref.slice('helix://contracts/'.length),'schema.json'),'utf8')));
      }
      Object.values(node).forEach(visit);
    }
    visit(value);
  }
  loadSchema(schema);
  const validator=createCapabilityContractValidator({schemas:[...schemas.values()]});
  validator.validate(schema.$id,result);
}
