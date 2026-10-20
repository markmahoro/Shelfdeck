'use strict';

const {javSourceSelectionSnapshotSchema}=require('../../../contracts/jav-source-contracts');
const {javQualificationSchema}=require('../../../contracts/jav-identity-evidence');
const digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'});
const text=(maxLength=256)=>({type:'string',minLength:1,maxLength});
const integer=(minimum=1)=>({type:'integer',minimum,maximum:Number.MAX_SAFE_INTEGER});
const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const physicalIdentity=()=>object({schemaRef:{const:'helix://contracts/types/PhysicalMaterialIdentity/v2'},schemaVersion:{const:2},
  materialKey:digest(),mountScopeId:text(),inode:{type:'string',pattern:'^(0|[1-9][0-9]*)$'},sizeBytes:integer(0),
  fingerprintAlgorithm:{const:'middle-256k-sha256'},fingerprintVersion:{const:1},contentFingerprint:digest()});

function javCorrectionBasisSchema() {
  return object({schema:{const:'arca.jav-correction-basis@1'},shelfEntryId:text(),shelfId:text(),canonicalIdentityRevision:integer(),
    canonicalIdentityKey:digest(),canonicalIdentityDigest:digest(),javCode:text(64),inventoryRevision:integer(),inventoryDigest:digest(),
    deckFactRevision:integer(),shelfTargetDigest:digest(),standardRevision:integer(),standardDigest:digest(),placementRevision:integer(),placementDigest:digest(),
    originalSourcePackageId:text(),originalCommitDigest:digest(),materials:{type:'array',minItems:1,maxItems:1024,
      items:object({ordinal:integer(0),role:{enum:['primary_payload','structural_dependency','metadata_sidecar','poster','fanart','subtitle','external_audio','chapter','sidecar']},
        physicalIdentity:physicalIdentity(),endpointId:text(),location:text(4096),bindingRevision:integer(),controlRevision:integer(),controlProjectionDigest:digest()})},
    relatedSetDigest:digest(),acceptedFactSetDigest:digest(),peopleSetDigest:digest(),basisDigest:digest()});
}

function javCorrectionIdentitySchema() {
  return object({schema:{const:'arca.jav-canonical-identity-proposal@1'},shelfEntryId:text(),shelfId:text(),structureKind:{const:'single'},
    contentProfile:{const:'jav'},identityKind:{const:'jav_code'},providerIdentities:{type:'array',minItems:1,maxItems:1,
      items:object({provider:{const:'jav'},namespace:{const:'jav_code'},providerKey:text(64),seasonNumber:{type:'null'}})},
    displayIdentity:object({entries:{type:'array',minItems:2,maxItems:2,items:object({key:{enum:['title','jav_code']},value:text(16384)})}}),identityDigest:digest()});
}

function javCorrectionProposalSchema() {
  return object({schema:{const:'arca.jav-correction-proposal@1'},shelfEntryId:text(),shelfId:text(),basisDigest:digest(),oldJavCode:text(64),newJavCode:text(64),
    newIdentity:javCorrectionIdentitySchema(),newCanonicalIdentityKey:digest(),sourceQualification:object({sourceSnapshot:javSourceSelectionSnapshotSchema(),
      sourceOrdinal:{type:'integer',minimum:0,maximum:7},observation:javQualificationSchema()}),retainedPrimaryMaterialKey:digest(),proposalDigest:digest()});
}

function javCorrectionPreviewProofSchema() {
  return object({schema:{const:'arca.jav-correction-preview-proof@1'},basis:javCorrectionBasisSchema(),proposal:javCorrectionProposalSchema(),
    paths:{type:'array',minItems:1,maxItems:1024,items:object({materialKey:digest(),role:text(64),previousLocation:text(4096),targetEndpointId:text(),targetLocation:text(4096)})},
    targetRealityDigest:digest(),placementPreviewDigest:digest()});
}

function javCorrectionAdmissionReceiptSchema() {
  return object({schemaRef:{const:'helix://contracts/application-types/ArcaJavCorrectionAdmissionReceipt/v1'},schemaVersion:{const:1},
    correctionId:text(),shelfEntryId:text(),state:{const:'admitted'},stateRevision:{const:1},basisDigest:digest(),proposalDigest:digest(),
    placementPreviewDigest:digest(),admissionDigest:digest(),admittedAtMs:integer(0)});
}
function javCorrectionMetadataFactSchema() {
  const observation=javQualificationSchema();
  return object({schemaRef:{const:'helix://contracts/application-types/ArcaJavCorrectionMetadataFact/v1'},schemaVersion:{const:1},
    correctionId:text(),shelfEntryId:text(),admissionDigest:digest(),canonicalIdentityDigest:digest(),contentProfile:{const:'jav'},identityKind:{const:'jav_code'},javCode:text(64),
    descriptiveFacts:object({entries:observation.properties.descriptiveEntries}),peopleHints:observation.properties.peopleHints,
    sourceQualification:object({sourceSnapshot:javSourceSelectionSnapshotSchema(),sourceOrdinal:{type:'integer',minimum:0,maximum:7},observation}),factDigest:digest()});
}
function javCorrectionFilePlanSchema() {
  const original=javCorrectionBasisSchema().properties.materials.items;
  return object({schemaRef:{const:'helix://contracts/application-types/ArcaJavCorrectionFilePlan/v1'},schemaVersion:{const:1},
    correctionId:text(),shelfEntryId:text(),admissionDigest:digest(),scopeDigest:digest(),basisDigest:digest(),placementPreviewDigest:digest(),
    verifiedSourcePayloadDigest:digest(),preparedAssetsPayloadDigest:digest(),retainedPrimaryMaterialKey:digest(),planDigest:digest(),
    target:object({endpointId:text(),rootLocation:text(4096),mountScopeId:text(),mountScopeRevision:integer()}),
    members:{type:'array',minItems:4,maxItems:1024,items:object({ordinal:integer(0),role:original.properties.role,original,
      source:{oneOf:[object({kind:{const:'retained_inventory'},workspaceMaterialHandle:{type:'null'},artifactHandle:{type:'null'}}),
        object({kind:{const:'correction_artifact'},workspaceMaterialHandle:{$ref:'helix://contracts/types/WorkspaceMaterialHandle/v1'},artifactHandle:{$ref:'helix://contracts/types/ArtifactHandle/v1'}})]},
      retainedLocation:text(4096),targetEndpointId:text(),targetLocation:text(4096)})}});
}

function javCorrectionCastFactSchema() {
  const nullable=value=>({anyOf:[value,{type:'null'}]}),relation=object({relationId:text(),personId:nullable(text()),displayName:text(16384),
    displayNameNormalized:text(16384),role:{const:'actor'},source:text(),providerIdentities:javQualificationSchema().properties.peopleHints.items.properties.providerIdentities,
    originEvidenceDigest:digest(),confidenceClass:text(),relationDigest:digest()});
  return object({schemaRef:{const:'helix://contracts/application-types/ArcaJavCorrectionCastFact/v1'},schemaVersion:{const:1},
    correctionId:text(),shelfEntryId:text(),admissionDigest:digest(),canonicalIdentityDigest:digest(),sourceObservationDigest:digest(),
    relations:{type:'array',maxItems:64,items:relation},relationCount:{type:'integer',minimum:0,maximum:64},relationsDigest:digest(),
    referenceProofs:{type:'array',maxItems:64,items:object({relationId:text(),inputDigest:digest(),resultDigest:digest(),
      resolutionKind:{enum:['resolved','unresolved']},reasonCode:text(),personId:nullable(text()),personRevision:nullable(integer()),
      personFactDigest:nullable(digest()),proofDigest:nullable(digest())})},factDigest:digest()});
}
function javCorrectionMetadataRecordSchema() {
  const {peopleHints,sourceQualification,factDigest,...properties}=javCorrectionMetadataFactSchema().properties;
  return object({...properties,schemaRef:{const:'helix://contracts/application-types/ArcaJavCorrectionMetadataRecord/v1'},sourceFactDigest:digest(),recordDigest:digest(),
    sourceQualificationReference:object({sourceVerifiedPayloadDigest:digest(),sourceSnapshotDigest:digest(),sourceOrdinal:{type:'integer',minimum:0,maximum:7},
      siteRef:text(),resourceKey:text(2048),resourceUrl:text(4096),observationDigest:digest()}),
    peopleHintsReference:object({hintCount:{type:'integer',minimum:0,maximum:64},hintsDigest:digest()})});
}
function javCorrectionCastRecordSchema() {
  const {relations,factDigest,...properties}=javCorrectionCastFactSchema().properties;
  return object({...properties,schemaRef:{const:'helix://contracts/application-types/ArcaJavCorrectionCastRecord/v1'},sourceFactDigest:digest(),recordDigest:digest()});
}
module.exports=Object.freeze({javCorrectionBasisSchema,javCorrectionIdentitySchema,javCorrectionProposalSchema,javCorrectionPreviewProofSchema,javCorrectionAdmissionReceiptSchema,javCorrectionMetadataFactSchema,javCorrectionFilePlanSchema,javCorrectionCastFactSchema,javCorrectionMetadataRecordSchema,javCorrectionCastRecordSchema});
