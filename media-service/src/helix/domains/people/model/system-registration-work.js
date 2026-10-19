'use strict';
const {canonicalDigest:D,canonicalJson}=require('../../../contracts/canonical-json');
const OBSERVE='people.registration_evidence.observe@1',CANDIDATE='people.candidate.commit@1',PERSON='people.person.commit@1',
  POLICY=Object.freeze({policyKind:'registration',policyRevision:1,ruleSchemaRef:'helix://people/rules/system-registration/v1',
    ruleDigest:D({schema:'people.system-registration-policy@1',libraries:['normal','jav'],weak:'internal_evidence',strong:'exact_provider_identity'})});
function fail(message){throw Object.assign(new Error(message),{code:'PEOPLE_SYSTEM_EVIDENCE_INVALID'});}
function assertItem(value,validator){
  validator.validate('helix://contracts/domain-types/OnDeckPersonEvidenceProjectionItem/v1',value);
  const {projectionItemDigest,...body}=value;
  if(D(body)!==projectionItemDigest||Buffer.byteLength(canonicalJson(value),'utf8')>16*1024||value.projectionRevision!==value.inventoryRevision||
      value.sourceKind==='media_cast'&&(!value.relationId||!value.relationDigest)||value.sourceKind==='nfo'&&(!value.nfoObservationDigest||value.relationId!==null||value.relationDigest!==null)||
      new Set(value.providerIdentities.map(item=>[item.provider,item.namespace,item.providerKey].join('\0'))).size!==value.providerIdentities.length)
    fail('Person Evidence requires an exact bounded Arca source and immutable Projection digest.');
  return value;
}
function descriptor(item){return {sourceKind:item.sourceKind,libraryKind:item.libraryKind,shelfEntryId:item.shelfEntryId,inventoryRevision:item.inventoryRevision,
  relationId:item.relationId,relationDigest:item.relationDigest,projectionItemId:item.projectionItemId,projectionItemDigest:item.projectionItemDigest};}
function workFor(input){
  const value=input.projectionRevision?descriptor(input):input,id=D({schema:'people.system-registration-work@1',...value,policy:POLICY});
  if(!['normal','jav'].includes(value.libraryKind))fail('System Registration cannot create a US Adult Person.');
  return Object.freeze({schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,workId:'people-system-registration-'+id,
    ownerDomain:'people',processType:'people_system_registration',processId:value.projectionItemId,workKind:'system_person_registration',
    workObjectiveTypeRef:'helix://people/work/system-registration/v1',workObjectiveVersion:1,executionBasisId:value.projectionItemId,
    executionBasisDigest:value.projectionItemDigest,dependencyRefs:[
      {ownerDomain:'arca',objectType:'shelf_entry',objectId:value.shelfEntryId,revision:value.inventoryRevision,digest:value.projectionItemDigest},
      {ownerDomain:'arca',objectType:value.sourceKind==='nfo'?'ondeck_nfo_person_evidence':'ondeck_person_evidence',objectId:value.projectionItemId,revision:value.inventoryRevision,digest:value.projectionItemDigest},
      {ownerDomain:'people',objectType:'system_registration_policy',objectId:value.libraryKind,revision:POLICY.policyRevision,digest:POLICY.ruleDigest},
      ...(value.relationId?[{ownerDomain:'arca',objectType:'inventory_person_relation',objectId:value.relationId,revision:value.inventoryRevision,digest:value.relationDigest}]:[])],
    priorityClass:'background_observation',priorityRevision:1,capabilityCatalogScope:'people',workspaceMaterialScope:[],
    idempotencyKey:'people-system-registration-'+id,concurrencyScope:'people-system-registration/'+value.projectionItemId,
    outputContractRef:'helix://contracts/capabilities/'+CANDIDATE.replace('@1','/v1/result')});
}
function descriptorFromWork(work){
  const entry=work?.dependencyRefs.find(item=>item.ownerDomain==='arca'&&item.objectType==='shelf_entry'),
    source=work?.dependencyRefs.find(item=>item.ownerDomain==='arca'&&['ondeck_person_evidence','ondeck_nfo_person_evidence'].includes(item.objectType)),
    policy=work?.dependencyRefs.find(item=>item.ownerDomain==='people'&&item.objectType==='system_registration_policy'),
    relation=work?.dependencyRefs.find(item=>item.ownerDomain==='arca'&&item.objectType==='inventory_person_relation');
  if(!entry||!source||!policy||policy.revision!==POLICY.policyRevision||policy.digest!==POLICY.ruleDigest||entry.revision!==source.revision||entry.digest!==source.digest)
    fail('System Registration Work does not bind its exact Arca source and People policy.');
  return {sourceKind:source.objectType==='ondeck_nfo_person_evidence'?'nfo':'media_cast',libraryKind:policy.objectId,shelfEntryId:entry.objectId,
    inventoryRevision:entry.revision,relationId:relation?.objectId??null,relationDigest:relation?.digest??null,
    projectionItemId:source.objectId,projectionItemDigest:source.digest};
}
function registrationEvidence(item,at){
  const proposedName=item.displayName.trim(),payload={libraryKind:item.libraryKind,proposedName,
    aliases:[{aliasDisplay:proposedName,aliasNormalized:proposedName.toLocaleLowerCase(),provenanceDigest:item.projectionItemDigest}],
    providerIdentities:item.providerIdentities,referenceHints:[]};
  if(!proposedName||Buffer.byteLength(canonicalJson(payload),'utf8')>16*1024)fail('System Registration requires a complete bounded Candidate payload.');
  return Object.freeze({schemaRef:'helix://contracts/types/PersonRegistrationEvidence/v1',schemaVersion:1,
    evidenceId:'people-registration-evidence-'+D({projectionItemDigest:item.projectionItemDigest}),evidenceKind:'on_deck_person',producerRef:OBSERVE,
    basisDigest:item.projectionItemDigest,payloadDigest:D(payload),observedAtMs:at,...payload});
}
module.exports=Object.freeze({OBSERVE,CANDIDATE,PERSON,POLICY,assertItem,descriptor,workFor,descriptorFromWork,registrationEvidence});
