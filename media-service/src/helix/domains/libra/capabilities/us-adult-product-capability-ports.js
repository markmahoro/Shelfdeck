'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {US_ADULT_PRESENTATION_VERSION}=require('../../../contracts/us-adult-presentation');
const {REQUEST,OBSERVE,NORMALIZE,POSTER,readActorContext,productWork,frameInputs,analysisSpec,analysisVariant,assertSame,productRequirements}=require('../model/us-adult-product-work');
const {buildWesternProductMetadataDraft}=require('../model/product-fact-contracts');
const {exactResult,resultRef}=require('../model/us-adult-analysis-work');
const EFFECTS=Object.freeze({[REQUEST]:'workspace_write',[OBSERVE]:'pure_observation',[NORMALIZE]:'pure_observation',[POSTER]:'workspace_write'});
function createUsAdultProductCapabilityPorts(options){
  const now=options.now||Date.now;
  function state(context){
    if(context.ownerScope.domain!=='libra'||context.ownerScope.processType!=='libra_run')throw new Error('US Adult product execution requires its Libra Owner scope.');
    const value=readActorContext(options,context.ownerScope.processId);
    if(!value.selection)throw new Error('US Adult product requires one selected actor.');
    if(context.capabilityRef!==POSTER&&context.workId!==productWork(value,context.capabilityRef===NORMALIZE?'normalize':'analysis').workId)
      throw new Error('US Adult product Work differs from the selected actor.');
    return value;
  }
  function validate(context){
    const value=state(context),input=context.namedInputs;
    if(context.capabilityRef===NORMALIZE){
      assertSame(input.westernAnalysisVariant,analysisVariant(value,exactResult(options,productWork(value,'analysis'),OBSERVE)),
        'US Adult Normalize input differs from its complete Analysis Result.');
    }else{
      const frames=frameInputs(options,value);
      if(context.capabilityRef===POSTER){
        assertSame(input.usAdultActorSelectionBasis,value.selection,'US Adult poster actor selection changed.');
        assertSame(input.frameArtifactSet,frames.frameArtifactSet,'US Adult poster source frames changed.');
      }else{
        for(const [key,expected] of Object.entries({...frames,analysisSpec:analysisSpec(value,frames)}))
          assertSame(input[key],expected,'US Adult product analysis source or actor selection changed.');
        if(context.capabilityRef===OBSERVE)assertSame(input.artifactHandle,exactResult(options,productWork(value,'analysis'),REQUEST).result,
          'US Adult observation requires the exact requested analysis Artifact.');
        else if(context.capabilityRef===REQUEST){
          const target=input.workspaceArtifactOutputTarget;
          if(target.libraRunId!==value.basis.libraRunId||target.workspaceId!==value.basis.workspaceId||
            target.sourceInputDigest!==canonicalDigest({...frames,analysisSpec:input.analysisSpec}))throw new Error('US Adult analysis target source changed.');
        }else throw new Error('US Adult product Capability is unsupported.');
      }
    }
    return value;
  }
  return Object.freeze(Object.fromEntries(Object.keys(EFFECTS).map(capabilityRef=>[capabilityRef,Object.freeze({validateInputs:validate,
    async execute(context){
      const value=validate(context),input=context.namedInputs,
        port=options.createUsAdultAnalysisPort({context,basis:value.basis,actorPresentation:value.actorPresentation});
      let result;
      if(capabilityRef===REQUEST)result=await port.requestAnalysis({...input,outputTarget:input.workspaceArtifactOutputTarget});
      else if(capabilityRef===OBSERVE)result=await port.observeAnalysis(input);
      else if(capabilityRef===POSTER)result=await port.renderPoster({actorSelectionBasis:input.usAdultActorSelectionBasis,frameArtifactSet:input.frameArtifactSet,
        relativePath:'product/us-adult-poster-'+canonicalDigest({selectionDigest:value.selection.selectionDigest,
          frameManifestDigest:input.frameArtifactSet.manifestDigest,presentationVersion:US_ADULT_PRESENTATION_VERSION})+'.jpg'});
      else{
        const variant=input.westernAnalysisVariant,observed=variant.analysisResults[0].result,payload=port.readAnalysisPayload(observed),
          {requiredFields,requirements:artifactRequirements}=productRequirements(value.snapshot),
          normalized=buildWesternProductMetadataDraft({analysisVariant:variant,requiredFields,producedAtMs:observed.observedAtMs,
            descriptiveFacts:payload.descriptiveFacts,providerIdentities:[],artifactRequirements,
            fieldProvenance:payload.descriptiveFacts.map(item=>({fieldPath:item.key,sourceKind:'western_analysis',
              sourceRef:observed.resultArtifactHandle.artifactHandleId,evidenceDigest:observed.payloadDigest}))
              .sort((a,b)=>Buffer.compare(Buffer.from(a.fieldPath),Buffer.from(b.fieldPath)))});
        if(!normalized.ready)throw Object.assign(new Error('US Adult metadata lacks required fields.'),{code:'US_ADULT_METADATA_UNRESOLVED',details:{missingFields:normalized.missingFields}});
        result=normalized.draft;
      }
      const digest=canonicalDigest(result),id=canonicalDigest({eventId:context.eventId,digest}),
        payloadDigest=capabilityRef===OBSERVE?result.payloadDigest:digest;
      return Object.freeze({kind:'succeeded',resultSchemaRef:resultRef(capabilityRef),result,
        evidenceSchemaRef:resultRef(capabilityRef).replace(/\/result$/,'/evidence'),
        evidence:{evidenceId:'us-adult-product-evidence-'+id,evidenceKind:'us_adult_product',producerRef:capabilityRef,
          basisDigest:value.selection.selectionDigest,payloadDigest,observedAtMs:now()},
        ...(EFFECTS[capabilityRef]==='workspace_write'?{effectReceipt:{schemaRef:'helix://contracts/types/EffectReceipt/v1',schemaVersion:1,
          effectReceiptId:'us-adult-product-effect-'+id,effectId:canonicalDigest(['workspace_write',context.idempotencyKey]),
          effectClass:'workspace_write',idempotencyKey:context.idempotencyKey,commitMarker:'us-adult-product-marker-'+id,
          externalReceiptRef:null,outputDigest:digest,verificationEvidenceDigest:digest,committedAtMs:now()}}:{})});
    },
    validateResult(context,outcome){
      const value=state(context),result=outcome.result;
      if(capabilityRef===NORMALIZE){
        const variant=analysisVariant(value,exactResult(options,productWork(value,'analysis'),OBSERVE));
        if(result.sourceBasisKind!=='western_analysis'||result.westernAnalysisVariantDigest!==variant.variantDigest||
          result.resolvedIdentityDigest!==value.identity.factValue.identityDigest)throw new Error('US Adult metadata Result crossed its analysis or identity.');
      }else if(capabilityRef===OBSERVE){
        if(result.libraRunId!==value.basis.libraRunId||result.analysisSpecDigest!==analysisSpec(value,frameInputs(options,value)).specDigest)
          throw new Error('US Adult Analysis Result crossed its frozen specification.');
      }else if(result.ownerScope?.scopeId!==value.basis.libraRunId||result.artifactKind!==(capabilityRef===POSTER?'poster':'western_analysis'))
        throw new Error('US Adult product Artifact crossed its Owner or kind.');
    }
  })])));
}
function createUsAdultProductCapabilityRegistrations({manifests,ports}){
  return Object.freeze(Object.keys(manifests).map(capabilityRef=>{
    const manifest=manifests[capabilityRef],port=ports[capabilityRef];
    if(!EFFECTS[capabilityRef]||manifest.effectClass!==EFFECTS[capabilityRef]||!port)throw new TypeError('US Adult product registration Effect class changed.');
    return Object.freeze({manifest,executor:{version:1,execute:context=>port.execute(context)},semanticValidator:{ref:manifest.semanticValidatorRef,
      validateInputs:context=>port.validateInputs(context),validateResult:(context,outcome)=>port.validateResult(context,outcome)}});
  }));
}
module.exports=Object.freeze({EFFECTS,createUsAdultProductCapabilityPorts,createUsAdultProductCapabilityRegistrations});
