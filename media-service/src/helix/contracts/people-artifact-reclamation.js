'use strict';
const {canonicalDigest:D}=require('./canonical-json');
const AUDIT='people.reference_usage.audit@1',RECLAIM='people.workspace.reclaim@1',
  EVIDENCE='helix://contracts/types/PeopleArtifactReferenceEvidence/v1',RECEIPT='helix://contracts/types/PeopleArtifactReclamationReceipt/v1',
  INPUT='helix://contracts/domain-types/PeopleArtifactReferenceAuditInput/v1',
  POLICY=Object.freeze({schema:'people.reference-artifact-retention@1',artifactAgeMs:30*86400000,technicalAgeMs:90*86400000,quietMs:60000,pageBudget:32});
const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)}),
  id=()=>({type:'string',minLength:1,maxLength:256}),digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'}),
  time=()=>({type:'integer',minimum:0}),nullable=value=>({anyOf:[value,{type:'null'}]}),ref=name=>({$ref:'helix://contracts/types/'+name+'/v1'});
function schema(name,body,max=16384,domain=false){return {$schema:'https://json-schema.org/draft/2020-12/schema',
  $id:'helix://contracts/'+(domain?'domain-types/':'types/')+name+'/v1',title:name+'@1','x-helix-ssotRefs':['10.5.4','8.6.19'],
  'x-helix-maxCanonicalBytes':max,
  ...(domain?{'x-helix-role':'accepted-business-dto'}:{'x-helix-envelopeRef':'helix://contracts/types/'+(name==='PeopleArtifactReferenceEvidence'?'EvidenceEnvelope':'ReceiptEnvelope')+'/v1'}),
  ...object(body)};}
function evidenceSchema(){return schema('PeopleArtifactReferenceEvidence',{
  schemaRef:{const:EVIDENCE},schemaVersion:{const:1},evidenceId:id(),evidenceKind:{const:'people_artifact_reference_audit'},producerRef:{const:AUDIT},
  basisDigest:digest(),payloadDigest:digest(),observedAtMs:time(),artifactHandle:ref('ArtifactHandle'),policyDigest:{const:D(POLICY)},
  bootId:id(),rootFenceDigest:digest(),sourceEpochs:{type:'array',minItems:3,maxItems:3,items:object({sourceId:{enum:['people_current','libra_frozen','arca_frozen']},epochDigest:digest()})},
  round:{enum:[1,2]},sourceIndex:{type:'integer',minimum:0,maximum:3},cursor:nullable({type:'string',minLength:1,maxLength:2048}),
  status:{enum:['scanning','waiting','eligible','retained','changed']},firstPassCompletedAtMs:nullable(time()),pageCount:time(),chainDigest:digest()
});}
function inputSchema(){return schema('PeopleArtifactReferenceAuditInput',{
  schemaRef:{const:INPUT},schemaVersion:{const:1},artifactHandle:ref('ArtifactHandle'),bootId:id(),rootFenceDigest:digest(),
  previousEvidence:nullable(ref('PeopleArtifactReferenceEvidence'))
},32768,true);}
function receiptSchema(){return schema('PeopleArtifactReclamationReceipt',{
  schemaRef:{const:RECEIPT},schemaVersion:{const:1},receiptId:id(),receiptKind:{const:'people_artifact_reclamation'},ownerDomain:{const:'people'},
  scopeType:{const:'people_artifact_reclamation'},scopeId:id(),scopeDigest:digest(),effectReceiptRef:id(),committedAtMs:time(),
  artifactHandleId:id(),artifactDigest:digest(),previousReferenceRevision:{type:'integer',minimum:1},referenceRevision:{type:'integer',minimum:1},
  disposition:{enum:['deleted','retained']},reasonCode:{enum:['unreferenced','authority_changed']},reclaimedBytes:time(),
  auditResultDigest:digest(),physicalEvidenceDigest:digest(),receiptDigest:digest(),
  executionReference:object({workId:id(),eventId:id(),eventAttemptId:id(),idempotencyKey:id()})
});}
function assertEvidence(value,validator){validator.validate(EVIDENCE,value);const {payloadDigest,evidenceId,evidenceKind,producerRef,basisDigest,observedAtMs,schemaRef,schemaVersion,...body}=value;
  if(payloadDigest!==D(body)||value.policyDigest!==D(POLICY)||new Set(value.sourceEpochs.map(source=>source.sourceId)).size!==3||
    value.sourceEpochs.some((source,index)=>source.sourceId!==['people_current','libra_frozen','arca_frozen'][index])||
    value.status==='eligible'&&(value.round!==2||value.sourceIndex!==3||value.cursor!==null||value.firstPassCompletedAtMs===null||value.observedAtMs-value.firstPassCompletedAtMs<POLICY.quietMs))
    throw Object.assign(new Error('Reference audit Evidence is incomplete or changed.'),{code:'PEOPLE_ARTIFACT_AUDIT_INVALID'});
  return value;
}
function evidence(body,basisDigest,at){return {schemaRef:EVIDENCE,schemaVersion:1,evidenceId:'people-reference-audit-'+D({body,basisDigest}),
  evidenceKind:'people_artifact_reference_audit',producerRef:AUDIT,basisDigest,payloadDigest:D(body),observedAtMs:at,...body};}
module.exports=Object.freeze({AUDIT,RECLAIM,EVIDENCE,RECEIPT,INPUT,POLICY,evidenceSchema,inputSchema,receiptSchema,assertEvidence,evidence});
