'use strict';

const {canonicalDigest}=require('../../../contracts/canonical-json');
const {buildJavSelectedSource}=require('../../../contracts/jav-selected-source');
const {assertJavCoverDerivation}=require('../../../contracts/jav-cover-derivation');
const {buildJavCorrectionProposal}=require('../model/jav-identity-correction');
const {buildJavCorrectionMetadata,renderJavCorrectionNfo}=require('../model/jav-correction-metadata');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};

function createJavCorrectionAssetsPreparation(options) {
  if(typeof options.acquireQualifiedCover!=='function'||typeof options.deriveJavCoverBytes!=='function')
    throw new TypeError('Correction asset preparation requires bounded qualified source and byte-derivation ports.');
  return Object.freeze({async prepare(record) {
    if(record?.state!=='active'||!record.proof||record.proof.basis.shelfEntryId!==record.shelfEntryId)
      fail('ARCA_JAV_CORRECTION_ASSETS_FENCED','Only an active exact correction may prepare new source assets.');
    const {basis,proposal}=record.proof,qualification=proposal.sourceQualification,
      expected=buildJavCorrectionProposal({basis,...qualification});
    if(expected.proposalDigest!==proposal.proposalDigest)fail('ARCA_JAV_CORRECTION_SOURCE_INVALID','Correction proposal does not conserve its frozen qualification.');
    const fresh=await options.acquireQualifiedCover({correctionId:record.correctionId,admissionDigest:record.admissionDigest,
      sourceSnapshot:qualification.sourceSnapshot,sourceOrdinal:qualification.sourceOrdinal,qualifiedObservation:qualification.observation});
    const observed=fresh?.observation,original=qualification.observation;
    if(!Buffer.isBuffer(fresh?.coverBytes)||!observed||observed.resourceKey!==original.resourceKey||observed.resourceUrl!==original.resourceUrl||
        observed.cover?.byteDigest!==original.cover.byteDigest||
        observed.descriptiveEntries?.find(item=>item.key==='title')?.value!==original.descriptiveEntries.find(item=>item.key==='title')?.value)
      fail('ARCA_JAV_CORRECTION_SOURCE_CHANGED','The confirmed film, title or cover changed before asset preparation.');
    const actualProposal=buildJavCorrectionProposal({basis,sourceSnapshot:qualification.sourceSnapshot,sourceOrdinal:qualification.sourceOrdinal,observation:observed});
    if(actualProposal.newIdentity.identityDigest!==proposal.newIdentity.identityDigest)
      fail('ARCA_JAV_CORRECTION_SOURCE_CHANGED','New source evidence must preserve the confirmed canonical identity.');
    const selected=buildJavSelectedSource({sourceSnapshot:qualification.sourceSnapshot,sourceOrdinal:qualification.sourceOrdinal,observation:observed}),
      metadata=buildJavCorrectionMetadata({correctionId:record.correctionId,admissionDigest:record.admissionDigest,basis,proposal:actualProposal}),
      nfo=renderJavCorrectionNfo({basis,proposal:actualProposal}),pictures=[];
    for(const artifactKind of ['poster','fanart']) {
      const value=await options.deriveJavCoverBytes({bytes:fresh.coverBytes,artifactKind,selectedSource:selected,sourceObservationDigest:observed.observationDigest});
      const derivation=assertJavCoverDerivation(value?.derivation);
      if(!Buffer.isBuffer(value?.bytes)||derivation.kind!==artifactKind||derivation.sourceByteDigest!==observed.cover.byteDigest||
          derivation.javSelectedSource.bindingDigest!==selected.bindingDigest)
        fail('ARCA_JAV_CORRECTION_SOURCE_INVALID','Derived correction images must retain the selected qualified cover.');
      pictures.push(Object.freeze({artifactKind,bytes:value.bytes,derivation}));
    }
    const evidence={schema:'arca.jav-correction-prepared-assets-evidence@1',correctionId:record.correctionId,admissionDigest:record.admissionDigest,
      confirmedProposalDigest:proposal.proposalDigest,actualProposalDigest:actualProposal.proposalDigest,sourceObservationDigest:observed.observationDigest,
      metadataFactDigest:metadata.factDigest,nfoRenderDigest:nfo.renderDigest,pictureDerivationDigests:pictures.map(item=>item.derivation.derivationDigest)};
    return Object.freeze({kind:'prepared_correction_asset_bytes',metadata,nfo,pictures:Object.freeze(pictures),evidence:Object.freeze({...evidence,evidenceDigest:canonicalDigest(evidence)})});
  }});
}
module.exports=Object.freeze({createJavCorrectionAssetsPreparation});
