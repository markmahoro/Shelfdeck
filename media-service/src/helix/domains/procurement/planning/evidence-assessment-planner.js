'use strict';

const path = require('node:path');
const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { executionCatalogDigest } = require('../../../foundation/execution/workflow-plan');
const { activeTriageRule } = require('../model/procurement-run-contracts');

const LAYOUT='shared.material.layout.observe@1';
const PROBE='shared.material.media.probe@1';
const PLAY='procurement.triage.playability.inspect@1';
const STRUCTURE='procurement.triage.structure.inspect@1';
const PROBE_BATCH_PROJECTION='helix://procurement/input-projections/TriageMaterialProbeBatch/v1';
const STRUCTURE_INPUT_PROJECTION='helix://procurement/input-projections/TriageStructureInspectionInput/v1';

function stableId(prefix,value){return prefix+canonicalDigest(value).slice(0,40);}
function without(value,...fields){return Object.fromEntries(Object.entries(value).filter(([key])=>!fields.includes(key)));}
function literal(portName,value){return Object.freeze({portName,bindingKind:'literal',value});}
function workResults(portName,sourceWorkId,resultSchemaRefs,projectionRef,parameters){return Object.freeze({portName,
  bindingKind:'projected_work_results',sourceWorkId,resultSchemaRefs:Object.freeze(resultSchemaRefs),projectionRef,
  parameters:Object.freeze(parameters)});}
function bindingSet(bindings){return Object.freeze({schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings:Object.freeze(bindings)});}
function relative(root,location){const a=root.replace(/\\/g,'/').replace(/\/+$/,'');const b=location.replace(/\\/g,'/');return b.startsWith(a+'/')?b.slice(a.length+1):null;}
function bdmvRootForLocation(location){const parts=String(location).replace(/\\/g,'/').split('/');for(let index=parts.length-2;index>=0;index-=1){if(parts[index].toUpperCase()==='BDMV')return parts.slice(0,index+1).join('/');}return null;}
function boundedScope(handle,runId,ordinal,scopeKind='parent_directory'){const parameter={parameter:'scopeKind',valueType:'string',value:scopeKind,valueDigest:''};
  parameter.valueDigest=canonicalDigest(without(parameter,'valueDigest'));const value={schemaRef:'helix://contracts/domain-types/BoundedLayoutScope/v1',schemaVersion:1,
    scopeId:stableId('triage-layout-scope-',{runId,ordinal,handle:canonicalDigest(handle)}),revision:1,digest:'',rootHandleDigest:canonicalDigest(handle),
    maxDepth:1,maxMembers:256,typedParameters:Object.freeze([Object.freeze(parameter)])};value.digest=canonicalDigest(without(value,'digest'));return Object.freeze(value);}

function demand(kinds){const value={resourceKinds:Object.freeze(kinds)};return Object.freeze({...value,demandDigest:canonicalDigest(value)});}
function node(options, ref, nodeId, eventId, bindings, dependsOn, kinds){const manifest=options.registry.resolve(ref,'procurement').manifest;
  const policy=options.policyRegistry.bindingFor(ref,manifest.effectClass);const fence={basisDigest:options.request.executionBasisDigest,
    inputSetDigest:canonicalDigest(bindings),eventFenceDigest:canonicalDigest({schema:'procurement.triage-event-fence@1',eventId,runId:options.snapshot.run.procurement_run_id}),
    effectScopeDigest:canonicalDigest({schema:'procurement.triage-event-scope@1',eventId,runId:options.snapshot.run.procurement_run_id})};
  return Object.freeze({nodeId,eventId,capabilityRef:ref,contractVersion:1,inputBindingsSchemaRef:manifest.parametersSchemaRef.replace(/\/parameters$/,'/inputs'),
    inputBindings:bindingSet(bindings),parametersSchemaRef:manifest.parametersSchemaRef,parameters:Object.freeze({}),dependsOn:Object.freeze(dependsOn),
    whenSchemaRef:null,when:null,effectClass:manifest.effectClass,resourceDemandSchemaRef:manifest.resourceDemandSchemaRef,resourceDemand:demand(kinds),
    approvalRequirementRef:null,authorizationRequirementRef:null,fenceSchemaRef:manifest.fenceSchemaRef,fenceBasis:Object.freeze(fence),
    retryPolicyRef:policy.retryPolicyRef,timeoutPolicyRef:policy.timeoutPolicyRef,outputContractRef:manifest.resultSchemaRef});}

function selected(snapshot){const members=snapshot.materials.map(({member,identity},ordinal)=>{const controlled=member.expected_control_state==='controlled';
  const controlSnapshot={materialKey:member.material_key,resultKind:'available',controlRevision:Number(member.expected_control_revision),
    controlState:member.expected_control_state,...(controlled?{ownerDomain:member.expected_control_owner_domain,
      ownerScopeType:member.expected_control_owner_scope_type,ownerScopeId:member.expected_control_owner_scope_id}:{}),
    regionProjection:member.expected_control_region_projection,evidenceDigest:member.expected_control_evidence_digest,
    projectionDigest:member.expected_control_projection_digest};
  return Object.freeze({ordinal,materialKey:member.material_key,selectionRole:member.selection_role,physicalIdentity:identity,
    sizeBytes:Number(member.size_bytes),bindingRevision:Number(member.binding_revision),eligibilityRevision:Number(member.eligibility_revision),
    eligibilityBasisDigest:member.eligibility_basis_digest,lastSnapshotDigest:member.last_snapshot_digest,lastObservationId:member.last_observation_id,
    endpointId:member.endpoint_id,location:member.location,realityDigest:member.reality_digest,provenanceDigest:member.provenance_digest,
    controlSnapshot:Object.freeze(controlSnapshot),admissionControlAction:member.admission_control_action,basisMemberDigest:member.basis_member_digest});});
  const value={procurementRunId:snapshot.run.procurement_run_id,fieldId:snapshot.run.field_id,members:Object.freeze(members)};
  return Object.freeze({...value,selectionDigest:canonicalDigest({schema:'procurement.selected-field-material-set@1',...value})});}

function memberContext(snapshot, material, ordinal){const location=relative(snapshot.access.root_location,material.member.location);
  if(location===null)throw new Error('Run material is outside Field root.');const baseName=path.posix.basename(location),extension=path.posix.extname(baseName).toLowerCase()||'.unknown';
  return Object.freeze({selectionOrdinal:ordinal,materialKey:material.member.material_key,fieldRelativeLocation:location,baseName,extension,
    parentSegments:Object.freeze(path.posix.dirname(location).split('/').filter((part)=>part&&part!=='.'))});}

function standardSidecarName(baseName) {
  const lower = String(baseName || '').toLowerCase();
  return /^(movie|tvshow)\.nfo$/.test(lower) ||
    /^(poster|fanart|background|backdrop)\.(jpg|jpeg|png|webp)$/.test(lower) ||
    /^season0*\d+-(poster|fanart|background|backdrop)\.(jpg|jpeg|png|webp)$/.test(lower);
}

function sidecarExtension(baseName) {
  return /\.(nfo|srt|ass|ssa|vtt|aac|ac3|dts|flac|mka|chapters|xml)$/i.test(String(baseName || ''));
}

function observedSidecarForGroup(snapshot, group, observedMaterials, parentDirectory, bdmvGroup, sliceOrdinal = 0, sliceCount = 1) {
  if (!Array.isArray(observedMaterials) || observedMaterials.length === 0) return [];
  const selectedKeys = new Set(group.map((material) => material.member.material_key));
  const primaryStems = new Set(group.map((material) => {
    const location = relative(snapshot.access.root_location, material.member.location);
    return path.posix.basename(location).replace(/\.[^.]+$/, '').toLowerCase();
  }));
  const outerDirectory = bdmvGroup ? path.posix.dirname(parentDirectory) : parentDirectory;
  if (bdmvGroup) primaryStems.add(path.posix.basename(outerDirectory).toLowerCase());
  const outerKey = outerDirectory.replace(/\\/g, '/').toLowerCase();
  const candidates = observedMaterials.filter((material) => {
    if (selectedKeys.has(material.materialKey)) return false;
    const location = relative(snapshot.access.root_location, material.location);
    if (location === null) return false;
    const observedParent = path.posix.dirname(location).replace(/\\/g, '/').toLowerCase();
    if (observedParent !== outerKey) return false;
    const baseName = path.posix.basename(location);
    const stem = baseName.replace(/\.[^.]+$/, '').toLowerCase();
    const stemMatches = [...primaryStems].some((primaryStem) => stem === primaryStem || stem.startsWith(primaryStem + '.') ||
      stem.startsWith(primaryStem + '-') || stem.startsWith(primaryStem + '_') ||
      primaryStem === stem.replace(/[-_.](?:[a-z]{2,8})$/i, ''));
    const standard = standardSidecarName(baseName);
    if (standard) return true;
    if (bdmvGroup) return sidecarExtension(baseName) && stemMatches;
    return stemMatches;
  }).sort((left, right) => Buffer.compare(Buffer.from(left.location), Buffer.from(right.location)));
  let candidateOrdinal = 0;
  return candidates.filter((material) => {
    const include = sliceCount <= 1 || candidateOrdinal % sliceCount === sliceOrdinal;
    candidateOrdinal += 1;
    return include;
  });
}

function layoutSnapshotForGroup(snapshot, group, groupKey, observedMaterials = [], sliceOrdinal = 0, sliceCount = 1, anchorGroup = group) {
  const first = group[0] || anchorGroup[0];
  if (!first) throw new Error('Layout slice requires an anchor Material.');
  const firstRelative = relative(snapshot.access.root_location, first.member.location);
  const parentDirectory = bdmvRootForLocation(firstRelative) || path.posix.dirname(firstRelative);
  const bdmvGroup = Boolean(bdmvRootForLocation(firstRelative));
  const directoryEntry = { entryOrdinal:0, entryKind:'directory', relativeLocation:'.', baseName:path.posix.basename(parentDirectory || snapshot.access.root_location),
    endpointId:first.member.endpoint_id, location:parentDirectory || '.' };
  directoryEntry.entryDigest = canonicalDigest(directoryEntry);
  const entries = [directoryEntry];
  for (const material of group.slice().sort((a,b)=>Buffer.compare(Buffer.from(a.member.location),Buffer.from(b.member.location)))) {
    const location = relative(snapshot.access.root_location, material.member.location);
    const baseName = path.posix.basename(location);
    const relativeLocation = bdmvGroup ? path.posix.relative(parentDirectory, location).replace(/\\/g,'/') : baseName;
    const item = { entryOrdinal:entries.length, entryKind:'file', relativeLocation, baseName,
      extension:path.posix.extname(baseName).toLowerCase() || '.unknown', identity:material.identity,
      endpointId:material.member.endpoint_id, location:material.member.location, sizeBytes:Number(material.member.size_bytes),
      mtimeNs:String(material.current?.mtime_ns ?? '0') };
    item.entryDigest = canonicalDigest(item); entries.push(item);
  }
  for (const material of observedSidecarForGroup(snapshot, group, observedMaterials, parentDirectory, bdmvGroup,
    sliceOrdinal, sliceCount)) {
    if (entries.length >= 256) break;
    const location = relative(snapshot.access.root_location, material.location);
    const baseName = path.posix.basename(location);
    const relativeLocation = bdmvGroup ? path.posix.relative(parentDirectory, location).replace(/\\/g, '/') : baseName;
    const item = { entryOrdinal:entries.length, entryKind:'file', relativeLocation, baseName,
      extension:path.posix.extname(baseName).toLowerCase() || '.unknown', identity:material.identity,
      endpointId:material.endpointId, location:material.location, sizeBytes:Number(material.sizeBytes),
      mtimeNs:String(material.mtimeNs || '0') };
    item.entryDigest = canonicalDigest(item); entries.push(item);
  }
  const observationId = first.member.last_observation_id;
  const snapshotId = stableId('field-layout-snapshot-', { observationId, parentDirectory, groupKey });
  const snapshotDigest = canonicalDigest({ schema:'procurement.field-observation-layout-snapshot@1', snapshotId, observationId,
    fieldId:snapshot.run.field_id, parentDirectory, entries });
  return Object.freeze({ schemaRef:'helix://contracts/types/FieldObservationLayoutSnapshot/v1', schemaVersion:1,
    snapshotId, snapshotDigest, observationId, fieldId:snapshot.run.field_id, parentDirectory,
    entries:Object.freeze(entries) });
}

function layoutSlicePlan(snapshot, group, groupKey, observedMaterials) {
  const firstRelative = relative(snapshot.access.root_location, group[0].member.location);
  const parentDirectory = bdmvRootForLocation(firstRelative) || path.posix.dirname(firstRelative);
  const bdmvGroup = Boolean(bdmvRootForLocation(firstRelative));
  const allSidecars = observedSidecarForGroup(snapshot, group, observedMaterials, parentDirectory, bdmvGroup, 0, 1);
  // Try the normal 16-member slice first, then shrink only for a folder whose actual immutable
  // identities/sidecars would exceed the durable 16 KiB input-binding contract.
  for (const selectionSliceSize of [16, 8, 4, 2, 1]) {
    for (const sidecarSliceCapacity of [4, 2, 1]) {
      const selectionSliceCount = Math.ceil(group.length / selectionSliceSize);
      const sidecarSliceCount = Math.max(1, Math.ceil(allSidecars.length / sidecarSliceCapacity));
      const sliceCount = Math.max(selectionSliceCount, sidecarSliceCount);
      if (sliceCount > 256) continue;
      const slices = [];
      let withinLimit = true;
      for (let sliceOrdinal = 0; sliceOrdinal < sliceCount; sliceOrdinal += 1) {
        const selected = group.slice(sliceOrdinal * selectionSliceSize, (sliceOrdinal + 1) * selectionSliceSize);
        const layoutSnapshot = layoutSnapshotForGroup(snapshot, selected, groupKey + ':' + sliceOrdinal,
          observedMaterials, sliceOrdinal, sliceCount, group);
        const bindings = bindingSet([
          literal('fieldObservationLayoutSnapshot', layoutSnapshot),
          literal('boundedLayoutScope', boundedScope((selected[0] || group[0]).readHandle, snapshot.run.procurement_run_id,
            sliceOrdinal, bdmvGroup ? 'bdmv_root' : 'parent_directory')),
        ]);
        if (Buffer.byteLength(canonicalJson(bindings), 'utf8') > 15000) { withinLimit = false; break; }
        slices.push(Object.freeze({ selected, layoutSnapshot, sliceOrdinal }));
      }
      if (withinLimit) return Object.freeze({ slices: Object.freeze(slices), bdmvGroup });
    }
  }
  throw new Error('Layout slice cannot fit the durable 16 KiB input binding contract.');
}

function createEvidenceAssessmentPlanner(options){const catalogDigest=executionCatalogDigest(options.registry,options.policyRegistry);
  return Object.freeze({plannerContractRef:'helix://procurement/planners/EvidenceAssessment/v1',plannerVersion:1,
    plan(request){const snapshot=options.triageReader.read(request.processId);if(!snapshot||!['active','waiting'].includes(snapshot.run.state)){
      return Object.freeze({schemaRef:'helix://foundation/types/WorkflowPlanDefinition/v1',schemaVersion:1,planId:stableId('evidence-plan-',{attempt:request.workAttemptId}),
        workAttemptId:request.workAttemptId,ownerDomain:'procurement',plannerContractRef:this.plannerContractRef,plannerVersion:1,
        workObjectiveTypeRef:'helix://procurement/work/EvidenceAssessment/v1',workObjectiveVersion:1,executionBasisDigest:request.executionBasisDigest,
        capabilityCatalogDigest:catalogDigest,resolution:'contract_unplannable',diagnosticClassification:'procurement_run_unavailable',nodes:Object.freeze([])});}
      const rule=activeTriageRule(options.triageRuleRegistry);
      if(rule.ruleRef!==snapshot.run.triage_rule_ref||rule.revision!==Number(snapshot.run.triage_rule_revision)||
          rule.authorityDigest!==snapshot.run.triage_rule_authority_digest) throw new Error('Run Triage Rule is no longer available.');
      const priorStructures=options.workResultReader.read(request.workId).filter((item)=>item.outcomeKind==='succeeded'&&
        item.resultSchemaRef===options.registry.resolve(STRUCTURE,'procurement').manifest.resultSchemaRef)
        .sort((left,right)=>left.result.pageOrdinal-right.result.pageOrdinal);
      if(priorStructures.length){const latest=priorStructures.at(-1).result;
        if(latest.cursorOut===null)throw new Error('Terminal Evidence Assessment Work must not be replanned.');
        const pageOrdinal=latest.pageOrdinal+1,eventId=stableId('triage-structure-event-',{attempt:request.workAttemptId,page:pageOrdinal});
        const resultSchemaRefs=Object.freeze([LAYOUT,PROBE,PLAY].map((ref)=>options.registry.resolve(ref,'procurement').manifest.resultSchemaRef));
        const structure=node({registry:options.registry,policyRegistry:options.policyRegistry,request,snapshot},STRUCTURE,'structure-'+pageOrdinal,eventId,
          [workResults('triageStructureInspectionInput',request.workId,resultSchemaRefs,STRUCTURE_INPUT_PROJECTION,{runId:request.processId,
            pageOrdinal,cursorIn:latest.cursorOut,maxUnits:32}),literal('procurementTriageRuleSnapshot',rule)],[],['cpu']);
        return Object.freeze({schemaRef:'helix://foundation/types/WorkflowPlanDefinition/v1',schemaVersion:1,
          planId:stableId('evidence-plan-',{attempt:request.workAttemptId}),workAttemptId:request.workAttemptId,ownerDomain:'procurement',
          plannerContractRef:this.plannerContractRef,plannerVersion:1,workObjectiveTypeRef:'helix://procurement/work/EvidenceAssessment/v1',
          workObjectiveVersion:1,executionBasisDigest:request.executionBasisDigest,capabilityCatalogDigest:catalogDigest,
          resolution:'planned',diagnosticClassification:null,nodes:Object.freeze([structure])});}
      const selection=selected(snapshot),nodes=[],layoutRefs=[],probeRefs=[],contexts=[];
      const observedMaterials=typeof options.triageReader.listObservedMaterials==='function'
        ? options.triageReader.listObservedMaterials(request.processId) : [];
      const admittedControls=Object.freeze(snapshot.materials.map(({member})=>Object.freeze({
        admittedControlRevision:Number(member.admitted_control_revision),
        admittedControlProjectionDigest:member.admitted_control_projection_digest})));
      const groups=new Map();snapshot.materials.forEach((material,ordinal)=>{const context=memberContext(snapshot,material,ordinal);
        const location=relative(snapshot.access.root_location,material.member.location);
        const bdmvRoot=bdmvRootForLocation(location);const key=bdmvRoot?'bdmv:'+bdmvRoot:context.parentSegments.join('/');
        if(!groups.has(key))groups.set(key,[]);groups.get(key).push(material);});
      const layoutByMaterial=new Map();
      for(const [groupKey,group] of groups.entries()) {
        const layoutResultSchemaRef=options.registry.resolve(LAYOUT,'procurement').manifest.resultSchemaRef;
        // Keep each durable input binding comfortably below the Foundation 16 KiB JSON bound.
        // Selected members retain the normal 16-item slices. Observed sidecars are distributed
        // across additional bounded slices so a folder with many subtitles never makes one
        // literal Layout binding oversized. Empty selection slices are valid evidence slices and
        // use the first selected member only as their read/fence anchor.
        const slicePlan=layoutSlicePlan(snapshot,group,groupKey,observedMaterials);
        for(const {selected:slice,layoutSnapshot,sliceOrdinal} of slicePlan.slices) {
          const layoutEventId=stableId('triage-layout-event-',{attempt:request.workAttemptId,groupKey,sliceOrdinal});
          nodes.push(node({registry:options.registry,policyRegistry:options.policyRegistry,request,snapshot},LAYOUT,'layout-'+groupKey+'-'+sliceOrdinal,layoutEventId,
            [literal('fieldObservationLayoutSnapshot',layoutSnapshot), literal('boundedLayoutScope',boundedScope((slice[0]||group[0]).readHandle,request.processId,sliceOrdinal,
              slicePlan.bdmvGroup?'bdmv_root':'parent_directory'))],[],['cpu']));
          layoutRefs.push(Object.freeze({eventId:layoutEventId,resultSchemaRef:layoutResultSchemaRef}));
          for(const material of slice)layoutByMaterial.set(material.member.material_key,Object.freeze({eventId:layoutEventId,resultSchemaRef:layoutResultSchemaRef}));
        }
      }
      snapshot.materials.forEach((material,ordinal)=>{
        const probeEventId=stableId('triage-probe-event-',{attempt:request.workAttemptId,ordinal});contexts.push(memberContext(snapshot,material,ordinal));
        nodes.push(node({registry:options.registry,policyRegistry:options.policyRegistry,request,snapshot},PROBE,'probe-'+ordinal,probeEventId,
          [literal('physicalMaterialReadHandleOrWorkspaceMaterialHandle',material.readHandle)],[],['cpu','disk_io']));
        probeRefs.push(Object.freeze({eventId:probeEventId,resultSchemaRef:options.registry.resolve(PROBE,'procurement').manifest.resultSchemaRef}));});
      const playRefs=[];
      for(let offset=0,batchOrdinal=0;offset<probeRefs.length;offset+=100,batchOrdinal++){const refs=probeRefs.slice(offset,offset+100);
        const eventId=stableId('triage-playability-event-',{attempt:request.workAttemptId,batchOrdinal});playRefs.push(Object.freeze({eventId,
          resultSchemaRef:options.registry.resolve(PLAY,'procurement').manifest.resultSchemaRef}));
        nodes.push(node({registry:options.registry,policyRegistry:options.policyRegistry,request,snapshot},PLAY,'playability-'+batchOrdinal,eventId,
          [workResults('triageMaterialProbeBatch',request.workId,
            [options.registry.resolve(PROBE,'procurement').manifest.resultSchemaRef],PROBE_BATCH_PROJECTION,{runId:request.processId,
              startOrdinal:offset,batchSize:refs.length,batchOrdinal,runBasisDigest:snapshot.run.run_basis_digest}),literal('procurementTriageRuleSnapshot',rule)],
          refs.map((ref)=>Object.freeze({eventId:ref.eventId,satisfaction:'success'})),['cpu','disk_io']));}
      const structureEventId=stableId('triage-structure-event-',{attempt:request.workAttemptId,page:0});const allRefs=Object.freeze([...layoutRefs,...probeRefs,...playRefs]);
      nodes.push(node({registry:options.registry,policyRegistry:options.policyRegistry,request,snapshot},STRUCTURE,'structure-0',structureEventId,
        [workResults('triageStructureInspectionInput',request.workId,[LAYOUT,PROBE,PLAY].map((ref)=>options.registry.resolve(ref,'procurement').manifest.resultSchemaRef),
          STRUCTURE_INPUT_PROJECTION,{runId:request.processId,
          pageOrdinal:0,cursorIn:null,maxUnits:32}),literal('procurementTriageRuleSnapshot',rule)],
        allRefs.map((ref)=>Object.freeze({eventId:ref.eventId,satisfaction:'success'})),['cpu']));
      return Object.freeze({schemaRef:'helix://foundation/types/WorkflowPlanDefinition/v1',schemaVersion:1,planId:stableId('evidence-plan-',{attempt:request.workAttemptId}),
        workAttemptId:request.workAttemptId,ownerDomain:'procurement',plannerContractRef:this.plannerContractRef,plannerVersion:1,
        workObjectiveTypeRef:'helix://procurement/work/EvidenceAssessment/v1',workObjectiveVersion:1,executionBasisDigest:request.executionBasisDigest,
        capabilityCatalogDigest:catalogDigest,resolution:'planned',diagnosticClassification:null,nodes:Object.freeze(nodes)});}});}

function createProbeBatchProjection(options){return Object.freeze({project({sourceResults,parameters}){const snapshot=options.triageReader.read(parameters.runId),selection=selected(snapshot);
  if(!Number.isSafeInteger(parameters.startOrdinal)||parameters.startOrdinal<0||!Number.isSafeInteger(parameters.batchSize)||parameters.batchSize<1||
      parameters.batchSize>100||parameters.startOrdinal+parameters.batchSize>selection.members.length)throw new Error('Probe Batch projection range is invalid.');
  const probeByHandle=new Map();for(const source of sourceResults){const key=source.result?.sourceHandleDigest;
    if(typeof key!=='string'||probeByHandle.has(key))throw new Error('Probe Batch projection Results are invalid or duplicated.');probeByHandle.set(key,source.result);}
  const members=Array.from({length:parameters.batchSize},(_unused,index)=>{const ordinal=parameters.startOrdinal+index,selectedMember=selection.members[ordinal],material=snapshot.materials[ordinal],handle=material.readHandle,
    control={admittedControlRevision:Number(material.member.admitted_control_revision),admittedControlProjectionDigest:material.member.admitted_control_projection_digest};
    const mediaProbe=probeByHandle.get(canonicalDigest(handle));if(!mediaProbe)throw new Error('Probe Batch projection is missing an exact durable Media Probe Result.');
    const value={selectionOrdinal:selectedMember.ordinal,materialKey:selectedMember.materialKey,bindingRevision:selectedMember.bindingRevision,
      admittedControlRevision:control.admittedControlRevision,admittedControlProjectionDigest:control.admittedControlProjectionDigest,
      readHandle:handle,mediaProbe};return Object.freeze({...value,memberDigest:canonicalDigest(value)});});
    const value={procurementRunId:selection.procurementRunId,runBasisDigest:parameters.runBasisDigest,
      selectionDigest:selection.selectionDigest,batchOrdinal:parameters.batchOrdinal,members:Object.freeze(members)};
    return Object.freeze({...value,batchDigest:canonicalDigest(value)});}});}

function createStructureInputProjection(options){return Object.freeze({project({sourceResults,parameters}){const snapshot=options.triageReader.read(parameters.runId),selection=selected(snapshot);
    const contexts=snapshot.materials.map((material,ordinal)=>memberContext(snapshot,material,ordinal));const layouts=[],probes=[],plays=[];
    for(const source of sourceResults){if(source.resultSchemaRef.includes('layout.observe'))layouts.push(source.result);
      else if(source.resultSchemaRef.includes('media.probe'))probes.push(source.result);else if(source.resultSchemaRef.includes('playability.inspect'))plays.push(source.result);}
    layouts.sort((left,right)=>Buffer.compare(Buffer.from(left.evidenceId),Buffer.from(right.evidenceId)));
    plays.sort((left,right)=>left.batchOrdinal-right.batchOrdinal);
    const layoutByMaterial=new Map();
    for(const layout of layouts) for(const entry of layout.entries||[]) if(entry.identity?.materialKey) layoutByMaterial.set(entry.identity.materialKey,layout);
    const probeByHandle=new Map(probes.map((item)=>[item.sourceHandleDigest,item]));
    const orderedProbes=snapshot.materials.map((material)=>probeByHandle.get(canonicalDigest(material.readHandle)));
    if(orderedProbes.some((item)=>!item))throw new Error('Structure input projection is missing a durable Media Probe Result.');
    const enrichedContexts=contexts.map((context,index)=>{const probe=orderedProbes[index];
      const location=context.fieldRelativeLocation.replace(/\\/g,'/');const bdmvRoot=bdmvRootForLocation(location);
      const expectedRoots=new Set([bdmvRoot||path.posix.dirname(location)]);if(bdmvRoot)expectedRoots.add(path.posix.dirname(bdmvRoot));
      const matching=layouts.filter((layout)=>(layout.entries||[]).some((entry)=>
        entry.entryKind==='file' && entry.identity?.materialKey===selection.members[index].materialKey));
      const fallback=layoutByMaterial.get(selection.members[index].materialKey);if(!matching.length&&fallback)matching.push(fallback);
      matching.sort((left,right)=>Buffer.compare(Buffer.from(left.evidenceId),Buffer.from(right.evidenceId)));
      return Object.freeze({...context,layoutEvidenceRefs:Object.freeze(matching.slice(0,16).map((layout)=>({evidenceId:layout.evidenceId,payloadDigest:layout.payloadDigest,boundedScopeDigest:layout.boundedScopeDigest})))});});
    const materialFieldContextValue={fieldId:snapshot.run.field_id,accessRevision:Number(snapshot.run.access_revision),accessDigest:snapshot.run.access_digest,
      profileHintSnapshot:Object.freeze({fieldId:snapshot.run.field_id,revision:Number(snapshot.run.profile_hint_revision),
        contentProfileHint:snapshot.run.content_profile_hint,hintDigest:snapshot.run.profile_hint_digest}),memberContexts:Object.freeze(enrichedContexts)};
    const materialFieldContext=Object.freeze({...materialFieldContextValue,contextDigest:canonicalDigest(materialFieldContextValue)});
    const pageValue={pageOrdinal:parameters.pageOrdinal,cursorIn:parameters.cursorIn,maxUnits:parameters.maxUnits};
    const pageRequest=Object.freeze({...pageValue,requestDigest:canonicalDigest(pageValue)});
    const batches=[];for(const page of plays){const batchOrdinal=page.batchOrdinal;const start=batchOrdinal*100;
      const members=selection.members.slice(start,start+100).map((selected,index)=>{const handleResult=orderedProbes[start+index];
        const handle=sourceResults.find((source)=>source.result===handleResult);void handle;return null;});void members;}
    // Reconstruct the exact batches from Playability ordering and Probe Results; the read handles are frozen in parameters.selectionHandles.
    const probeBatches=plays.map((page)=>{const start=page.batchOrdinal*100;const ms=page.materialResults.map((play,index)=>{const selectedMember=selection.members[start+index],material=snapshot.materials[start+index];
      const probe=orderedProbes[start+index],readHandle=material.readHandle,control={admittedControlRevision:Number(material.member.admitted_control_revision),admittedControlProjectionDigest:material.member.admitted_control_projection_digest};
      const value={selectionOrdinal:selectedMember.ordinal,materialKey:selectedMember.materialKey,bindingRevision:selectedMember.bindingRevision,
        admittedControlRevision:control.admittedControlRevision,admittedControlProjectionDigest:control.admittedControlProjectionDigest,
        readHandle,mediaProbe:probe};return Object.freeze({...value,memberDigest:canonicalDigest(value)});});
      const value={procurementRunId:selection.procurementRunId,runBasisDigest:page.runBasisDigest,selectionDigest:selection.selectionDigest,
        batchOrdinal:page.batchOrdinal,members:Object.freeze(ms)};return Object.freeze({...value,batchDigest:canonicalDigest(value)});});
    const basis={schema:'procurement.triage-structure-input@1',selectionDigest:selection.selectionDigest,
      probeBatchDigests:probeBatches.map((b)=>b.batchDigest),playabilityPayloadDigests:plays.map((p)=>p.payloadDigest),contextDigest:materialFieldContext.contextDigest,
      layoutPayloadDigests:layouts.map((l)=>l.payloadDigest),pageRequest};
    return Object.freeze({selectedFieldMaterialSet:selection,probeBatches:Object.freeze(probeBatches),playabilityPages:Object.freeze(plays),
      materialFieldContext,layoutEvidence:Object.freeze(layouts),pageRequest,inputDigest:canonicalDigest(basis)});}});}

module.exports=Object.freeze({PROBE_BATCH_PROJECTION,STRUCTURE_INPUT_PROJECTION,createEvidenceAssessmentPlanner,
  createProbeBatchProjection,createStructureInputProjection,selectedFieldMaterialSet:selected});
