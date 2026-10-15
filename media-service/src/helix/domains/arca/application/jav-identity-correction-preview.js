'use strict';

const {randomUUID}=require('../../../platform/public/integration-adapter-support');
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {buildJavQueryAnchor,buildJavSourceSelectionSnapshot,JAV_SITES_BY_CLASS}=require('../../../contracts/jav-source-contracts');
const {buildJavCorrectionBasis,buildJavCorrectionProposal}=require('../model/jav-identity-correction');
const {buildJavCorrectionPlacementRequest,metadataIdentity}=require('../model/aftercare-placement');

const OPERATION='shared.integration.search@1';
const RULE=Object.freeze({ruleRef:'arca.jav-correction-single-source@1',ruleRevision:1,sourcesByClass:JAV_SITES_BY_CLASS,
  t38First:'javdb',requiredFields:['title'],requiredSourceArtifacts:['cover']});
const SCHEMA=name=>'helix://contracts/application-types/'+name+'/v1';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const unavailable=new Set(['JAV_SOURCE_UNAVAILABLE','JAV_SOURCE_TIMEOUT','JAV_SOURCE_ACCESS_DENIED','JAV_SOURCE_RESPONSE_TOO_LARGE',
  'JAV_SOURCE_REDIRECT_DENIED','JAV_SOURCE_URL_DENIED','JAV_SOURCE_RESPONSE_INVALID','JAV_SOURCE_CHARSET_INVALID']);

function createJavIdentityCorrectionPreview(options) {
  const {contextReader,materialControlProjectionPort:controls,contractValidator:validator}=options;
  if(!contextReader||!controls||!validator||typeof options.observeJavSourceForPreview!=='function'||!options.inventoryPort?.inspectJavCorrectionPlacement)
    throw new TypeError('Arca correction preview requires its owned context, Control, schemas, source and placement ports.');
  const now=options.now||Date.now,cache=new Map();
  function read(entryId) {
    const context=contextReader.read(entryId);
    if(!context)fail('ARCA_SHELF_ENTRY_NOT_FOUND','Shelf Entry was not found.');
    const keys=[...new Set(context.raw.materials.map(row=>row.material_key))].sort(),projections=[];
    for(let offset=0;offset<keys.length;offset+=500)projections.push(...controls.getMaterialControlProjections(keys.slice(offset,offset+500)));
    const basis=buildJavCorrectionBasis({raw:context.raw,controlProjections:projections,activeCases:contextReader.store.history(entryId).cases});
    validator.validate(SCHEMA('ArcaJavCorrectionBasis'),basis);
    return {context,basis};
  }
  function snapshotFor(anchor) {
    const sites=[...JAV_SITES_BY_CLASS[anchor.codeClass]];
    if(/^T38-/.test(anchor.javCode))sites.sort((a,b)=>Number(b==='javdb')-Number(a==='javdb'));
    const sources=[];
    for(const siteRef of sites) {
      let handle;
      try{handle=options.resolveJavSourceHandle({siteRef,operationId:OPERATION});}
      catch(error){if(error.code==='PLATFORM_INTEGRATION_NOT_CONFIGURED')continue;throw error;}
      if(!handle)continue;
      if(handle.integrationType!=='jav_source'||handle.siteRef!==siteRef||handle.authMode!=='anonymous'||handle.allowedOperation!==OPERATION)
        fail('ARCA_JAV_CORRECTION_SOURCE_INVALID','Correction source Handle does not conserve its allowed operation.');
      sources.push({ordinal:sources.length,siteRef,integrationId:handle.integrationId,configRevision:handle.configRevision,
        authMode:handle.authMode,queryKind:anchor.queryKind,endpointProfileDigest:handle.endpointProfileDigest,networkRouteDigest:handle.networkRouteDigest});
    }
    if(!sources.length)fail('PLATFORM_INTEGRATION_NOT_CONFIGURED','No eligible JAV source is configured for this code class.');
    return buildJavSourceSelectionSnapshot({ruleRef:RULE.ruleRef,ruleRevision:RULE.ruleRevision,queryAnchor:anchor,ruleDigest:canonicalDigest(RULE),sources});
  }
  function handleFor(source) {
    const handle=options.resolveJavSourceHandle({siteRef:source.siteRef,operationId:OPERATION});
    if(!handle||handle.allowedOperation!==OPERATION||['integrationId','configRevision','siteRef','authMode','endpointProfileDigest','networkRouteDigest'].some(key=>handle[key]!==source[key]))
      fail('ARCA_JAV_CORRECTION_SOURCE_STALE','Correction source configuration changed after preview.');
    return handle;
  }
  function assertCurrent(entryId,basis) {
    const current=read(entryId);
    if(current.basis.basisDigest!==basis.basisDigest)fail('ARCA_JAV_CORRECTION_PREVIEW_STALE','Shelf Entry changed after correction preview.');
    return current;
  }
  function placementFor(current,proposal) {
    const identity=proposal.newIdentity,observation=proposal.sourceQualification.observation;
    const placementContext={...current.context,raw:{...current.context.raw,identity:{...current.context.raw.identity,
      provider_key:proposal.newJavCode,identity_digest:identity.identityDigest},facts:current.context.raw.facts
        .filter(row=>!['resolved_identity','product_metadata','media_cast'].includes(row.fact_kind)).concat([
          {fact_kind:'resolved_identity',value:identity},{fact_kind:'product_metadata',value:{descriptiveFacts:{entries:observation.descriptiveEntries}}}])}};
    const placement=buildJavCorrectionPlacementRequest(placementContext,options.inventoryPort,now(),'arca-jav-correction-preview-'+proposal.proposalDigest);
    let reality;
    try{reality=options.inventoryPort.inspectJavCorrectionPlacement(placement);}
    catch(error){if(error.code==='CLEAN_ARCA_TARGET_COLLISION')fail('ARCA_JAV_CORRECTION_TARGET_COLLISION','Correction target is occupied by materials outside the approved Entry.');throw error;}
    if(reality?.schema!=='arca.jav-correction-target-reality@1'||!/^[a-f0-9]{64}$/.test(reality.targetRealityDigest||''))
      fail('ARCA_JAV_CORRECTION_PLACEMENT_INVALID','Correction placement observation is incomplete.');
    const paths=placement.finalInventoryDecision.members.map(member=>({materialKey:member.sourceMaterialKey,role:member.role,
      previousLocation:current.context.raw.materials.find(row=>row.material_key===member.sourceMaterialKey)?.location,
      targetEndpointId:member.targetEndpointId,targetLocation:member.targetLocation}));
    const placementPreviewDigest=canonicalDigest({shelfEntryId:current.basis.shelfEntryId,basisDigest:current.basis.basisDigest,
      proposalDigest:proposal.proposalDigest,paths,targetRealityDigest:reality.targetRealityDigest});
    return {paths,placementPreviewDigest,targetRealityDigest:reality.targetRealityDigest};
  }
  async function preview(entryId,input) {
    if(!input||Object.getPrototypeOf(input)!==Object.prototype||Object.keys(input).some(key=>!['javCode','siteRef','resourceKey'].includes(key))||
        ((input.siteRef===undefined)!==(input.resourceKey===undefined))||
        (input.resourceKey!==undefined&&(typeof input.resourceKey!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(input.resourceKey))))
      fail('ARCA_JAV_CORRECTION_INPUT_INVALID','Correction requires one complete code and an optional exact source resource.');
    let anchor;try{anchor=buildJavQueryAnchor('jav_code',input.javCode);}catch{fail('ARCA_JAV_CORRECTION_INPUT_INVALID','Enter one complete supported JAV code.');}
    const initial=read(entryId),snapshot=snapshotFor(anchor),attempts=[],deadline=now()+90000;
    if(input.siteRef&&!snapshot.sources.some(source=>source.siteRef===input.siteRef))
      fail('ARCA_JAV_CORRECTION_INPUT_INVALID','Selected resource does not belong to an eligible source.');
    for(const source of snapshot.sources.filter(item=>!input.siteRef||item.siteRef===input.siteRef)) {
      let image;
      for(let attemptOrdinal=0;attemptOrdinal<2;attemptOrdinal++) {
        const remaining=deadline-now();if(remaining<100)fail('ARCA_JAV_CORRECTION_PREVIEW_TIMEOUT','Correction preview exhausted its source budget.');
        try{image=await options.observeJavSourceForPreview({operationId:OPERATION,siteRef:source.siteRef,integrationHandle:handleFor(source),
          timeoutMs:Math.min(30000,remaining),input:{queryAnchor:anchor,...(input.resourceKey?{resourceKey:input.resourceKey}:{})}});break;}
        catch(error){if(!unavailable.has(error.code))throw error;attempts.push({siteRef:source.siteRef,attemptOrdinal,result:'unavailable',reasonCode:error.code});
          if(!['JAV_SOURCE_UNAVAILABLE','JAV_SOURCE_TIMEOUT'].includes(error.code))break;}
      }
      if(!image)continue;
      const observation=image.observation;
      if(observation?.schema!=='integration.jav-source-observation@1'||observation.observationDigest!==canonicalDigest(Object.fromEntries(Object.entries(observation).filter(([key])=>key!=='observationDigest')))||
          observation.siteRef!==source.siteRef||observation.queryAnchorDigest!==anchor.anchorDigest||
          observation.endpointProfileDigest!==source.endpointProfileDigest||observation.networkRouteDigest!==source.networkRouteDigest)
        fail('ARCA_JAV_CORRECTION_SOURCE_INVALID','Correction source observation is inconsistent.');
      attempts.push({siteRef:source.siteRef,result:observation.result,observationDigest:observation.observationDigest});
      if(observation.result==='ambiguous') {assertCurrent(entryId,initial.basis);return {result:'ambiguous',javCode:anchor.javCode,candidates:observation.candidates,attempts};}
      if(observation.result!=='qualified')continue;
      const proposal=buildJavCorrectionProposal({basis:initial.basis,sourceSnapshot:snapshot,sourceOrdinal:source.ordinal,observation});
      validator.validate(SCHEMA('ArcaJavCorrectionProposal'),proposal);
      if(image.sourceCoverDigest!==observation.cover.byteDigest||typeof image.posterUrl!=='string'||image.posterUrl.length>65536||
          !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(image.posterUrl))
        fail('ARCA_JAV_CORRECTION_SOURCE_INVALID','Correction preview image must bind the qualified cover.');
      const current=assertCurrent(entryId,initial.basis),identity=proposal.newIdentity,
        {paths,placementPreviewDigest,targetRealityDigest}=placementFor(current,proposal);
      const previewId=randomUUID(),clock=now();
      for(const [key,value] of cache)if(value.expiresAtMs<=clock)cache.delete(key);
      if(cache.size>=32)cache.delete(cache.keys().next().value);
      const proofJson=canonicalJson({schema:'arca.jav-correction-preview-proof@1',basis:initial.basis,proposal,paths,placementPreviewDigest,targetRealityDigest});
      if(Buffer.byteLength(proofJson)>2*1024*1024)fail('ARCA_JAV_CORRECTION_PREVIEW_TOO_LARGE','Correction preview exceeds its complete Entry proof budget.');
      const proof=JSON.parse(proofJson);
      cache.set(previewId,{proof,expiresAtMs:clock+600000});
      return {result:'qualified',previewId,shelfEntryId:entryId,basisDigest:initial.basis.basisDigest,proposalDigest:proposal.proposalDigest,
        placementPreviewDigest,oldIdentity:{javCode:initial.basis.javCode,title:metadataIdentity(current.context).title},
        newIdentity:{javCode:anchor.javCode,title:identity.displayIdentity.entries.find(item=>item.key==='title').value,posterUrl:image.posterUrl,siteRef:source.siteRef},paths,attempts};
    }
    assertCurrent(entryId,initial.basis);return {result:'not_qualified',javCode:anchor.javCode,attempts};
  }
  function readPreview(entryId,previewId) {
    const cached=cache.get(previewId);
    if(!cached||cached.expiresAtMs<=now()){cache.delete(previewId);fail('ARCA_JAV_CORRECTION_PREVIEW_EXPIRED','Correction preview expired.');}
    if(cached.proof.basis.shelfEntryId!==entryId)fail('ARCA_JAV_CORRECTION_PREVIEW_STALE','Correction preview belongs to a different Entry.');
    const current=assertCurrent(entryId,cached.proof.basis);
    handleFor(cached.proof.proposal.sourceQualification.sourceSnapshot.sources[cached.proof.proposal.sourceQualification.sourceOrdinal]);
    if(placementFor(current,cached.proof.proposal).placementPreviewDigest!==cached.proof.placementPreviewDigest)
      fail('ARCA_JAV_CORRECTION_PREVIEW_STALE','Correction target reality changed after preview.');
    return JSON.parse(canonicalJson(cached.proof));
  }
  return Object.freeze({preview,readPreview});
}

module.exports=Object.freeze({createJavIdentityCorrectionPreview});
