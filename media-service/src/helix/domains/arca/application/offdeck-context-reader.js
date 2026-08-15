'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createMaterialControlProjectionPort } = require('../../../foundation/persistence/material-control');
const { createOffdeckStore } = require('../persistence/offdeck-store');
const { evaluateEntryPolicy } = require('../model/offdeck-contract');

function createOffdeckContextReader(options) {
  const store = options.offdeckStore || createOffdeckStore(options);
  const controls = options.materialControlProjectionPort || createMaterialControlProjectionPort(options);
  const now=options.now||Date.now;
  function readControlProjections(materialKeys) {
    const keys = [...new Set(materialKeys)].sort();
    const projections = [];
    for (let offset = 0; offset < keys.length; offset += 500) {
      projections.push(...controls.getMaterialControlProjections(keys.slice(offset, offset + 500)));
    }
    return Object.freeze(projections);
  }
  function read(caseId) {
    const value = store.caseContext(caseId); if (!value) return null;
    const snapshot = store.entrySnapshot(value.case.shelf_entry_id); if (!snapshot) return null;
    const projections = new Map(readControlProjections(value.materials.map((item)=>item.material_key)).map((item)=>[item.materialKey,item]));
    const materials = value.materials.map((row) => {
      const identity = JSON.parse(row.physical_identity_json), control = projections.get(row.material_key);
      const handleBasis = { schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1', schemaVersion:1,
        handleId:'arca-offdeck-material-handle-'+canonicalDigest({caseId,scope:value.scope.scope_digest,ordinal:Number(row.ordinal)}).slice(0,40),
        identity, ownerDomain:'arca', ownerScope:Object.freeze({scopeType:'offdeck_case',scopeId:caseId}),
        bindingRevision:Number(row.binding_revision), endpointId:row.endpoint_id, location:row.endpoint_relative_location,
        mountScopeRevision:Number(snapshot.shelf.target_mount_scope_revision), expectedSizeBytes:Number(row.size_bytes),
        expectedMtimeNs:0, expectedCtimeNs:0,
        fingerprintVerifiedAtMs:Number(value.scope.created_at_ms), readScope:'offdeck_exact_identity', expiresAtMs:Number.MAX_SAFE_INTEGER };
      const materialHandle=Object.freeze({...handleBasis,fenceDigest:canonicalDigest(handleBasis)});
      return Object.freeze({ordinal:Number(row.ordinal),materialKey:row.material_key,role:row.material_role,relatedReferenceId:row.related_reference_id||null,
        deleteCondition:row.delete_condition,memberDigest:row.member_digest,scopeRow:Object.freeze({...row}),materialHandle,control});
    });
    const authorization=Object.freeze({schemaRef:'helix://contracts/types/AuthorizationHandle/v1',schemaVersion:1,
      authorizationId:value.authorization.authorization_id,authorizationKind:'offdeck_destruction',ownerDomain:'arca',
      immutableScopeDigest:value.authorization.scope_digest,authorizationRevision:1,actorId:value.authorization.actor_id,
      batchId:value.authorization.batch_id||null,invalidatingFactDigests:Object.freeze([value.scope.scope_digest]),authorizedAtMs:Number(value.authorization.authorized_at_ms)});
    return Object.freeze({...value,snapshot,materials:Object.freeze(materials),authorization,authorizationState:value.authorization.state,
      basisDigest:canonicalDigest({caseId,authorizationId:authorization.authorizationId,scopeDigest:value.scope.scope_digest,
        recoveryRevision:Number(value.case.recovery_revision),memberDigests:materials.map((item)=>item.memberDigest)})});
  }
  function evaluateEntry(shelfEntryId){const policy=store.ensurePolicy(),entry=store.allEntryFacts().find((item)=>item.shelf_entry_id===shelfEntryId);if(!entry)return null;const rating=options.readPerceptionRating?.(shelfEntryId),people=options.readPeoplePreferences?.(entry.canonical_identity_key),care=options.readAftercareHealth?.(shelfEntryId),facts=Object.freeze({shelfId:entry.shelf_id,rating:rating?.state==='ready'?rating.rating:null,collectionAgeDays:Math.max(0,Math.floor((now()-Number(entry.created_at_ms))/86_400_000)),peoplePreferences:people?.state==='ready'?people.items:null,care:care?.basisCurrent?care:null}),evaluated=evaluateEntryPolicy(policy,facts),reasonBasis={shelfEntryId,policyRevision:policy.revision,matchedRuleId:evaluated.matchedRuleId,result:evaluated.result,facts};return Object.freeze({entry,policy,facts,evaluated,reasonDigest:canonicalDigest(reasonBasis),basisDigest:canonicalDigest(reasonBasis)});}
  function activeIdentityProjectionPages(limit=100){const entries=store.allEntryFacts().map((entry)=>Object.freeze({objectId:entry.shelf_entry_id,revision:Number(entry.current_inventory_revision),schemaRef:'helix://arca/types/ActiveShelfEntryIdentity/v1',digest:entry.identity?.identity_digest||canonicalDigest({shelfEntryId:entry.shelf_entry_id,canonicalIdentityKey:entry.canonical_identity_key}),objectKind:'active-shelf-entry-identity'})).sort((a,b)=>a.digest.localeCompare(b.digest)||a.objectId.localeCompare(b.objectId)),groups=[];
    for(const entry of entries){const current=groups.at(-1);if(current&&current[0].digest===entry.digest)current.push(entry);else groups.push([entry]);}
    if(groups.some((group)=>group.length>limit))throw Object.assign(new Error('One strong Identity duplicate group exceeds the bounded 100-Entry detection page.'),{code:'ARCA_OFFDECK_DUPLICATE_GROUP_TOO_LARGE'});
    const pages=[],pageGroups=[];let count=0;const flush=()=>{if(pageGroups.length===0)return;const pageEntries=pageGroups.flat(),range={firstIdentityDigest:pageEntries[0].digest,lastIdentityDigest:pageEntries.at(-1).digest,entryCount:pageEntries.length},objectId=stablePageId(range),base={schemaRef:'helix://contracts/domain-types/ActiveShelfEntryIdentityProjection/v1',schemaVersion:1,objectId,revision:1,entries:Object.freeze(pageEntries),projectionRevision:pageEntries.length,identityRangeDigest:canonicalDigest(range)};pages.push(Object.freeze({...base,digest:canonicalDigest(base)}));pageGroups.length=0;count=0;};
    for(const group of groups){if(count>0&&count+group.length>limit)flush();pageGroups.push(group);count+=group.length;}flush();return Object.freeze(pages);
  }
  function stablePageId(range){return 'arca-active-shelf-entry-identities-'+canonicalDigest(range).slice(0,40);}
  function activeIdentityProjection(processId=null){const pages=activeIdentityProjectionPages();if(processId===null)return pages[0]||Object.freeze({schemaRef:'helix://contracts/domain-types/ActiveShelfEntryIdentityProjection/v1',schemaVersion:1,objectId:'arca-active-shelf-entry-identities-empty',revision:1,entries:Object.freeze([]),projectionRevision:0,identityRangeDigest:canonicalDigest([]),digest:canonicalDigest({schema:'arca.empty-active-identities@1'})});const page=pages.find((item)=>item.objectId===processId);if(!page)throw Object.assign(new Error('Off-deck duplicate detection page is stale.'),{code:'ARCA_OFFDECK_DUPLICATE_PAGE_STALE'});return page;}
  function releasedRelatedReferenceIds(){
    if(!options.workResultReader)return new Set();
    const ids=new Set(),works=options.workResultReader.listOwnerWorks({ownerDomain:'arca',workKind:'offdeck_material_destruction'});
    for(const work of works)for(const item of options.workResultReader.read(work.work_id)){
      if(item.outcomeKind==='succeeded'&&item.result?.schemaRef==='helix://contracts/types/ReferenceReleaseResult/v1'&&item.result.released===true)ids.add(item.result.referenceId);
    }
    return ids;
  }
  return Object.freeze({store,read,evaluateEntry,activeIdentityProjection,activeIdentityProjectionPages,releasedRelatedReferenceIds,
    controlProjections:readControlProjections});
}

module.exports = Object.freeze({ createOffdeckContextReader });
