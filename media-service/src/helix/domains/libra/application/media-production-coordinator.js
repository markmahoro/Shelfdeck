'use strict';

const {buildWorkspaceMediaHandle}=require('../model/media-production-contracts');
const {buildProductConformanceFactSnapshot,buildProductConformanceInputSnapshot}=require('../model/product-conformance');
const {canonicalDigest}=require('../../../contracts/canonical-json');

class MediaProductionCoordinatorError extends Error{
  constructor(code,message){super(message);this.name='MediaProductionCoordinatorError';this.code=code;}
}
const fail=(code,message)=>{throw new MediaProductionCoordinatorError(code,message);};

function createMediaProductionCoordinator(options){
  if(!options?.mediaEffectPort||typeof options.mediaEffectPort.executeRemux!=='function'||typeof options.mediaEffectPort.executeTranscode!=='function')
    fail('P9_MEDIA_EFFECT_PORT','A typed media Effect port is required.');
  async function execute(kind,value){
    if(kind==='encode'&&value.transcodeInputVerification?.result!=='passed')
      fail('P9_TRANSCODE_INPUT_NOT_VERIFIED','Transcode requires the exact passed input verification.');
    if(value.outputTarget?.productionIntentDigest!==value.productionIntent?.intentDigest)
      fail('P9_MEDIA_TARGET_INTENT','Output target and production intent do not match.');
    const receipt=await (kind==='remux'?options.mediaEffectPort.executeRemux(value):options.mediaEffectPort.executeTranscode(value));
    if(!receipt||receipt.outputTargetId!==value.outputTarget.targetId||receipt.outputTargetDigest!==value.outputTarget.targetDigest||
        receipt.effectScopeDigest!==value.outputTarget.effectScopeDigest)
      fail('P9_MEDIA_EFFECT_RECEIPT','Media Effect receipt does not bind the frozen target.');
    return buildWorkspaceMediaHandle({sourceHandle:value.sourceHandle,outputTarget:value.outputTarget,
      workspaceMaterialHandle:receipt.workspaceMaterialHandle,productionIntentKind:kind,productionIntent:value.productionIntent,
      deviceSnapshot:kind==='encode'?value.deviceSnapshot:null,producingEventId:value.producingEventId,effectReceipt:receipt});
  }
  return Object.freeze({executeRemux:(value)=>execute('remux',value),executeTranscode:(value)=>execute('encode',value)});
}

const CONFORMANCE_READERS=Object.freeze(['runBasis','acceptanceSpec','productFact','inventory','verifiedArtifactManifest',
  'artifactVerificationResult','selectedProductResult','productMediaVerificationResult','directInputMaterial','stagingReference']);

function createProductConformanceCoordinator(options){
  const readers=options?.readers;
  if(!readers||CONFORMANCE_READERS.some((name)=>!readers[name]||typeof readers[name].readExact!=='function'))
    fail('P9_CONFORMANCE_READERS','Conformance assembly requires all exact typed readers.');
  const read=(name,ref)=>readers[name].readExact(Object.freeze({...ref}));
  async function assemble(binding){
    if(!binding||!Array.isArray(binding.productFactRefs)||!Array.isArray(binding.artifactVerificationRefs)||
        !Array.isArray(binding.selectedProductRefs))fail('P9_CONFORMANCE_BINDING','Conformance Plan binding is incomplete.');
    const runBasis=await read('runBasis',binding.runBasisRef),acceptanceSpec=await read('acceptanceSpec',binding.acceptanceSpecRef);
    if(runBasis.libraRunId!==binding.runBasisRef.libraRunId||runBasis.runExecutionBasisDigest!==binding.runBasisRef.runExecutionBasisDigest||
        acceptanceSpec.acceptanceSpecId!==binding.acceptanceSpecRef.acceptanceSpecId||
        acceptanceSpec.specRevision!==binding.acceptanceSpecRef.specRevision||acceptanceSpec.recordDigest!==binding.acceptanceSpecRef.recordDigest)
      fail('P9_CONFORMANCE_RUN_BASIS','Run Basis or Acceptance Spec exact read drifted.');
    const productFactSnapshots=[];
    for(const ref of binding.productFactRefs){
      const factValue=await read('productFact',ref);
      productFactSnapshots.push(buildProductConformanceFactSnapshot({productFactId:ref.productFactId,factKind:ref.factKind,
        factRevision:ref.factRevision,factValue,factDigest:ref.factDigest,evidenceDigest:ref.evidenceDigest}));
    }
    productFactSnapshots.sort((a,b)=>Buffer.from(a.factKind).compare(Buffer.from(b.factKind))||
      Buffer.from(a.productFactId).compare(Buffer.from(b.productFactId))||a.factRevision-b.factRevision);
    const inventorySnapshot=await read('inventory',binding.inventoryRef),
      verifiedArtifactManifest=await read('verifiedArtifactManifest',binding.verifiedArtifactManifestRef),artifactVerificationSnapshots=[];
    for(const ref of binding.artifactVerificationRefs){
      const verificationValue=await read('artifactVerificationResult',ref.verificationResultRef),
        verifiedManifestItem=verifiedArtifactManifest.items.find((item)=>item.ordinal===ref.ordinal),
        artifactManifestItem=inventorySnapshot.artifactManifest.items.find((item)=>item.artifactHandleId===verifiedManifestItem?.artifactHandleId)||null;
      const item={ordinal:ref.ordinal,verifiedManifestItem,artifactManifestItem,verificationResultRef:ref.verificationResultRef,verificationValue};
      item.snapshotDigest=canonicalDigest(item);artifactVerificationSnapshots.push(item);
    }
    const selectedProducts=[];
    for(const ref of binding.selectedProductRefs){
      const selectedProduct=await read('selectedProductResult',ref.selectedProductResultRef),
        verification=await read('productMediaVerificationResult',ref.verificationResultRef);
      let workspaceHandleDigest=null;
      if(verification.candidateKind==='workspace_output'){
        const staging=await read('stagingReference',ref.provenanceRef);
        if(staging.productMaterialHandleId!==verification.productMaterialHandleId||staging.workspaceHandleDigest!==ref.workspaceHandleDigest)
          fail('P9_CONFORMANCE_STAGING_REF','Product Staging Reference does not match the selected Product.');
        workspaceHandleDigest=staging.workspaceHandleDigest;
      }else{
        const input=await read('directInputMaterial',ref.provenanceRef);
        if(input.productMaterialHandleId!==verification.productMaterialHandleId)
          fail('P9_CONFORMANCE_INPUT_REF','Immutable Run input does not match the selected Product.');
      }
      selectedProducts.push({selectedProduct,verification,workspaceHandleDigest});
    }
    selectedProducts.sort((a,b)=>Buffer.from(a.selectedProduct.selectedHandleId).compare(Buffer.from(b.selectedProduct.selectedHandleId))||
      Buffer.from(a.selectedProduct.selectedVerificationId).compare(Buffer.from(b.selectedProduct.selectedVerificationId)));
    const resolvedRef=binding.productFactRefs.find((item)=>item.factKind==='resolved_identity');
    const resolvedIdentitySnapshot=productFactSnapshots.find((item)=>item.factKind==='resolved_identity');
    if(!resolvedRef||!resolvedIdentitySnapshot)fail('P9_CONFORMANCE_RESOLVED_REF','Plan lacks the exact resolved identity Fact ref.');
    return buildProductConformanceInputSnapshot({libraRunId:runBasis.libraRunId,runExecutionBasisDigest:runBasis.runExecutionBasisDigest,
      acceptanceSpecId:acceptanceSpec.acceptanceSpecId,acceptanceSpecRecordDigest:acceptanceSpec.recordDigest,acceptanceSpec,
      resolvedIdentitySnapshot,productFactSnapshots,verifiedArtifactManifest,artifactVerificationSnapshots,inventorySnapshot,selectedProducts});
  }
  return Object.freeze({assemble});
}

module.exports=Object.freeze({MediaProductionCoordinatorError,createMediaProductionCoordinator,createProductConformanceCoordinator});
