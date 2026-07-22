'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const c=require('../../src/helix/domains/libra/model/external-material-contracts');
const {createExternalMaterialCoordinator}=require('../../src/helix/domains/libra/application/external-material-coordinator');
const {CONTRACTS,createExternalMaterialCapabilityRegistrations}=require('../../src/helix/domains/libra/capabilities/external-material-capability-registrations');

const NOW=1_700_000_000_000,d=(value)=>canonicalDigest(value),hex=(value)=>d({value});
const anchor={provider:'tmdb',namespace:'tmdb_movie',providerKey:'550',seasonNumber:null,identityAnchorDigest:hex('anchor')};
const identity={contentProfile:'movie',title:'Fight Club',resolvedIdentityDigest:hex('identity'),providerIdentityAnchors:[anchor]};
function structure(){const x={objectId:'structure-1',revision:1,subjectId:'subject-1',structureKind:'single',episodeClaims:[]};x.structureDigest=d({schema:'libra.product-structure@1',subjectId:x.subjectId,structureKind:x.structureKind,episodeClaims:x.episodeClaims});x.digest=x.structureDigest;return x;}
function query(){return c.buildAcquisitionQuery({resolvedProductIdentity:identity,productStructure:structure(),executionContext:{libraRunId:'run-1',runExecutionBasisDigest:hex('run')},producedAtMs:NOW});}
function candidate(){const providerCandidateRef={objectType:'acquisition_candidate',objectId:'provider-1',revision:1,digest:hex('provider')};const body={candidateId:d({schema:'provider-acquisition-candidate-id@1',integrationId:'integration-1',configRevision:3,providerCandidateRef}),integrationId:'integration-1',configRevision:3,providerCandidateRef,providerRank:0,identityAnchors:[anchor],structureKind:'single',episodeKeys:[],availability:'available'};return {...body,candidateDigest:d(body)};}
function candidates(){const items=[candidate()],body={schemaRef:'helix://contracts/types/AcquisitionCandidates/v1',schemaVersion:1,evidenceId:'evidence-1',evidenceKind:'external_acquisition_candidates',producerRef:'transport-1',basisDigest:hex('search'),payloadDigest:hex('payload'),observedAtMs:NOW,queryDigest:query().queryDigest,integrationId:'integration-1',configRevision:3,candidates:items};body.candidateSetDigest=d({schema:'libra.external-acquisition-candidate-set@1',queryDigest:body.queryDigest,integrationId:body.integrationId,configRevision:body.configRevision,items});return body;}
function output(){const memberBody={ordinal:0,externalMemberId:'member-1',relativePath:'movie.mkv',sizeBytes:42,checksumAlgorithm:'sha256',checksumHex:hex('movie'),episodeClaims:[]};const members=[{...memberBody,memberDigest:d(memberBody)}],memberSetDigest=d({schema:'provider-external-material-members@1',items:members});const body={integrationId:'integration-1',configRevision:3,externalObjectRef:'external-1',endpointId:'endpoint-1',location:'/external-1',structureKind:'single',members,identityAnchors:[anchor],observedTitle:'Fight Club',releaseYear:1999,observedAtMs:NOW,newestMutationAtMs:NOW-60_000,memberSetDigest,manifestDigest:d({schema:'provider-external-material-manifest@1',structureKind:'single',memberSetDigest})};return {...body,snapshotDigest:d(body)};}
function receipt(){return {schemaRef:'helix://contracts/types/ExternalJobReceipt/v1',schemaVersion:1,receiptId:'receipt-1',integrationId:'integration-1',externalJobId:'job-1',operationKind:'libra.external_material.acquire.request@1',idempotencyKey:'idem',requestDigest:hex('request'),configRevision:3,createdAtMs:NOW};}
function observation(){const snapshot=output();return c.buildAcquisitionObservation({externalJobReceipt:receipt(),providerSnapshot:{externalJobReceiptId:'receipt-1',requestDigest:receipt().requestDigest,providerObservationRevision:1,state:'ready',outputSnapshot:snapshot,snapshotDigest:hex('provider-snapshot')},phase:'download',producerRef:'transport-1',observedAtMs:NOW});}
function stable(){const handle=c.buildExternalMaterialHandle({acquisitionObservation:observation(),productStructure:structure()});return c.buildStableEvidence({externalMaterialHandle:handle,providerSnapshot:{sourceExternalMaterialHandleId:handle.handleId,providerObservationRevision:2,outputSnapshot:output(),snapshotDigest:hex('stability')},quietWindowMs:60_000,productStructure:structure(),verifiedAtMs:NOW});}
function root(){const body={rootId:'root-1',ownerScope:'libra',rootKind:'production_workspace',endpointId:'workspace-endpoint',mountScopeId:'mount-1',mountScopeRevision:1,configRevision:1,capabilityDigest:hex('capability'),state:'active',rootHandleRef:hex('root')};return {...body,snapshotDigest:d(body)};}

test('query and deterministic candidate selection conserve complete frozen basis',()=>{
  const q=query(),criteria=c.buildSelectionCriteria({revision:1,queryDigest:q.queryDigest}),selected=c.selectCandidate({candidates:candidates(),selectionCriteria:criteria,producedAtMs:NOW});
  assert.equal(q.libraRunId,'run-1');assert.equal(selected.result,'selected');assert.equal(selected.selectedCandidateId,candidate().candidateId);
  const unavailable=candidates();unavailable.candidates=[{...candidate(),availability:'unavailable'}];unavailable.candidates[0].candidateDigest=d(Object.fromEntries(Object.entries(unavailable.candidates[0]).filter(([k])=>k!=='candidateDigest')));unavailable.candidateSetDigest=d({schema:'libra.external-acquisition-candidate-set@1',queryDigest:unavailable.queryDigest,integrationId:'integration-1',configRevision:3,items:unavailable.candidates});
  assert.equal(c.selectCandidate({candidates:unavailable,selectionCriteria:criteria,producedAtMs:NOW}).result,'not_selected');
});

test('ready observation, stability, identity and package verification form one exact chain',()=>{
  const s=stable(),verification=c.verifyIdentity({stableEvidence:s,resolvedProductIdentity:identity,verifiedAtMs:NOW}),delivery={objectId:'delivery-1',revision:1,digest:hex('delivery'),libraRunId:'run-1',subjectId:'subject-1',structureKind:'single',seasonScopeDigest:null,episodeClaims:[],deliveryDigest:hex('delivery')},requirement={requirementId:'identity-1',revision:1,schemaRef:'IdentityRequirement@1',expectedIdentityDigest:identity.resolvedIdentityDigest,strengthClass:'exact_provider_identity'};requirement.digest=d(requirement);
  const verified=c.verifyPackage({stableEvidence:s,identityVerification:verification,episodeDeliveryManifest:delivery,identityRequirement:requirement,verifiedAtMs:NOW});
  assert.equal(verification.result,'passed');assert.equal(verified.result,'passed');assert.deepEqual(verified.verifiedMemberIds,['member-1']);
  const wrong=c.verifyIdentity({stableEvidence:s,resolvedProductIdentity:{...identity,resolvedIdentityDigest:hex('other'),providerIdentityAnchors:[{...anchor,providerKey:'999'}]},verifiedAtMs:NOW});assert.equal(wrong.result,'failed');
});

test('one-member import plan is deterministic and restart returns one physical result',async()=>{
  const s=stable(),verification=c.verifyIdentity({stableEvidence:s,resolvedProductIdentity:identity,verifiedAtMs:NOW}),delivery={objectId:'delivery-1',revision:1,digest:hex('delivery'),libraRunId:'run-1',subjectId:'subject-1',structureKind:'single',seasonScopeDigest:null,episodeClaims:[],deliveryDigest:hex('delivery')},requirement={requirementId:'identity-1',revision:1,schemaRef:'IdentityRequirement@1',expectedIdentityDigest:identity.resolvedIdentityDigest,strengthClass:'exact_provider_identity'};requirement.digest=d(requirement);const verified=c.verifyPackage({stableEvidence:s,identityVerification:verification,episodeDeliveryManifest:delivery,identityRequirement:requirement,verifiedAtMs:NOW});
  const contracts=c.buildWorkspaceDeliveryContracts({verifiedExternalPackage:verified,stableEvidence:s,libraRunId:'run-1',workspaceId:'workspace-1',expectedWorkspaceRevision:1,expectedWorkspaceStateDigest:hex('workspace'),rootSnapshot:root()});assert.equal(contracts.length,1);
  const journal=new Map();let physicalWrites=0;const workspaceImportPort={async execute(request){if(journal.has(request.idempotencyKey))return journal.get(request.idempotencyKey);physicalWrites+=1;const handle={schemaRef:'helix://contracts/types/WorkspaceMaterialHandle/v1',schemaVersion:1,handleId:hex('handle'),workspaceId:'workspace-1',ownerDomain:'libra',processId:'run-1',endpointId:'workspace-endpoint',materialKey:hex('material'),physicalIdentity:{mountScopeId:'mount-1',inode:'1',contentHashAlgorithm:'sha256',contentHash:hex('movie')},rootHandleRef:hex('root'),relativePath:request.targetRelativePath,digestAlgorithm:'sha256',digestHex:hex('movie'),sizeBytes:42,referenceRevision:1,accessScope:'workspace_material_read',fenceDigest:hex('fence')};const receipt={idempotencyKey:request.idempotencyKey,workspaceMaterialHandle:handle};journal.set(request.idempotencyKey,receipt);return receipt;}};
  const coordinator=createExternalMaterialCoordinator({observationPort:{execute:async()=>{}},requestPort:{execute:async()=>{}},workspaceImportPort,now:()=>NOW});
  const input={stableEvidence:s,verifiedExternalPackage:verified,workspaceDeliveryContract:contracts[0]},first=await coordinator.importOne(input),replayed=await coordinator.importOne(input);assert.deepEqual(replayed,first);assert.equal(physicalWrites,1);
  assert.throws(()=>c.buildWorkspaceDeliveryContracts({verifiedExternalPackage:verified,stableEvidence:s,libraRunId:'run-1',workspaceId:'workspace-1',expectedWorkspaceRevision:1,expectedWorkspaceStateDigest:hex('workspace'),rootSnapshot:root(),targetRelativePaths:{'member-1':'../escape.mkv'}}),/root-relative/);
});

test('ten exact capability registrations reject missing or wrong effect bindings',()=>{
  const manifests={},ports={};for(const [cap,effectClass] of Object.entries(CONTRACTS)){manifests[cap]={capabilityRef:cap,ownerScope:'libra',effectClass,contractVersion:1,semanticValidatorRef:`validator:${cap}`};ports[cap]={execute(){},validateInputs(){},validateResult(){}};}
  assert.equal(createExternalMaterialCapabilityRegistrations({manifests,ports}).length,10);
  assert.throws(()=>createExternalMaterialCapabilityRegistrations({manifests:{...manifests,[Object.keys(CONTRACTS)[0]]:{...manifests[Object.keys(CONTRACTS)[0]],effectClass:'workspace_write'}},ports}),/drifted/);
});

test('pure external model has no Store, Repository, latest or current read',()=>{
  const source=require('node:fs').readFileSync(require.resolve('../../src/helix/domains/libra/model/external-material-contracts'),'utf8');
  assert.doesNotMatch(source,/\b(Store|Repository|readLatest|findCurrent|latest row|current row)\b/);
});
