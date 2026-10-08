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
  Object.assign(c.basis,{inventoryRevision:2,standardRevision:1,placementRevision:1,decisionFactSetDigest:canonicalDigest([])});
  c.raw.shelf={target_root_location:path.dirname(f.materials[0].location),target_endpoint_id:'endpoint'};
  c.raw.initialPlacementDecision={target_location:c.raw.shelf.target_root_location,target_endpoint_id:'endpoint'};
  c.raw.initialPlacement={value:{}};c.raw.placement={value:{}};
  let custody={assessmentState:'healthy',findingDrafts:[]};
  const ports=createAftercareCapabilityPorts({...f.options,now:()=>1000,
    schemaManifest:require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),
    unitOfWork:{execute(){throw new Error('Assessment must not write to persistence.');}},
    contextReader:{read:()=>c,store:{}},workResultReader:{read:()=>[{outcomeKind:'succeeded',capabilityRef:C.custody,result:custody}]}});
  const execution={ownerScope:{processId:c.shelfEntryId},workId:'work',namedInputs:{careBasis:{},inventoryRevision:{},knownBindings:{},standard:{},placement:{}}};
  ports[C.conformance].validateInputs(execution);
  const result=await ports[C.conformance].execute(execution);
  ports[C.conformance].validateResult(execution,result);
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
  validator.validate(schema.$id,result.result);
  assert.equal(result.kind,'succeeded');assert.equal(result.result.assessmentState,'degraded');
  assert.deepEqual(codes({findings:result.result.findingDrafts}),['max_size_exceeded']);
  assert.equal(f.probed.length,2);assert.equal(f.played.length,6);
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
