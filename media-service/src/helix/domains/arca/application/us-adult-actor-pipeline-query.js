'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {assertIntent}=require('../model/us-adult-actor-refresh');
const {sourceWork,executionScope}=require('../model/us-adult-actor-refresh-execution');
const {matchWork,exactSource}=require('../model/us-adult-actor-match-work');
const {buildSelection}=require('../model/us-adult-actor-selection');
const {assertSelection}=require('../../../contracts/us-adult-actor-selection');
const {phaseWork,dependency,completed}=require('../model/us-adult-actor-pipeline');
const {assertProof:assertPublicationFailure}=require('../persistence/actor-publication-failure');
const {readRequirement}=require('../model/us-adult-actor-refresh-objective');
function fail(message){throw Object.assign(new Error(message),{code:'ARCA_US_ADULT_PHASE_PROOF_INVALID'});}
function createUsAdultActorPipelineQuery(options){
  const source=options.actorRefreshSource,reader=options.aftercareContextReader;
  function base(entryId,caseId){
    const record=source.store.byCase(caseId),care=reader.store.getCase(caseId),context=reader.read(entryId);
    if(!record||record.intent.shelfEntryId!==entryId||!care||care.shelfEntryId!==entryId||!context)fail('Actor Case, Intent or Entry is absent.');
    assertIntent(record.intent,options.contractValidator);const intent=record.intent,objective=readRequirement(care.careRequirement);
    if(!objective||objective.intentId!==intent.intentId||objective.intentDigest!==intent.intentDigest||!['queued','active','resolved'].includes(care.state)||
        context.raw.entry.status!=='active'||context.raw.shelf.status!=='active'||context.raw.correctionGate||context.raw.reservations.some(item=>item.state==='active')||
        Number(context.raw.entry.current_deck_fact_revision)!==intent.deckFactRevision||Number(context.raw.entry.canonical_identity_revision)!==intent.canonicalIdentityRevision||
        context.raw.entry.canonical_identity_key!==intent.canonicalIdentityKey||context.raw.identity.identity_digest!==intent.canonicalIdentityDigest)
      fail('Actor Case no longer has its exact active Shelf, Entry, Deck and Canonical authority.');
    const revision=Number(context.raw.entry.current_inventory_revision);
    if(revision===intent.inventoryRevision){
      if(care.state==='active')executionScope({context,care,intent,rootHandleRef:reader.store.aftercareWorkspaceRootSnapshot.rootHandleRef});
      else if(context.basis.digest!==intent.careBasisDigest||context.knownBindings.digest!==intent.knownBindingsDigest)fail('Queued actor Case Basis changed.');
    }else if(revision===intent.inventoryRevision+1){
      const commit=reader.store.history(entryId).commits.find(item=>item.aftercareCaseId===caseId&&item.newInventoryRevision===revision);
      if(!commit||context.raw.facts.find(item=>item.fact_kind==='media_cast')?.value?.intentDigest!==intent.intentDigest||
          Number(context.raw.shelf.current_standard_revision)!==care.careBasis.standardRevision||Number(context.raw.shelf.current_placement_revision)!==care.careBasis.placementRevision)
        fail('Post-commit recovery requires this exact Case commit and unchanged Shelf revisions.');
    }else fail('A different Inventory revision replaced the actor Case.');
    return {intent,care,context};
  }
  function assertAuthority(entryId,caseId,allowResolved=false){
    const value=base(entryId,caseId);if(value.care.state!=='active'&&!(allowResolved&&value.care.state==='resolved'))return false;
    const materials=value.context.raw.materials;
    for(let offset=0;offset<materials.length;offset+=500){const keys=materials.slice(offset,offset+500).map(item=>item.material_key).sort(),
      projections=options.materialControlProjectionPort.getMaterialControlProjections(keys);
      if(projections.length!==keys.length||projections.some(item=>item.resultKind!=='available'||item.controlState!=='controlled'||item.ownerDomain!=='arca'||
          item.ownerScopeType!=='shelf_entry'||item.ownerScopeId!==entryId))return false;}
    return true;
  }
  function portFor(value,execution=null){
    const {intent,care}=value,store=reader.store,context=execution||{ownerScope:{domain:'arca',processType:'arca_shelf_entry',processId:intent.shelfEntryId},
      assertExecutionActive(){if(!assertAuthority(intent.shelfEntryId,care.aftercareCaseId,true))fail('Actor Case artifact read lost current authority.');}};
    return options.createUsAdultInventoryAnalysisPort({context,intent,aftercareCaseId:care.aftercareCaseId,contractValidator:options.contractValidator,
      assertAuthority:()=>assertAuthority(intent.shelfEntryId,care.aftercareCaseId,!execution),workspaceRegistry:{rootSnapshot:store.aftercareWorkspaceRootSnapshot,
        ensureWorkspace:id=>store.ensureAftercareWorkspace(id),registerMaterial:handle=>store.registerAftercareWorkspaceMaterial(handle),listHandles:id=>store.listAftercareWorkspaceHandles(id)}});
  }
  function publicationFailure(snapshot){
    const work=snapshot.stages.publish?.work;
    if(!work||options.workResultReader.status(work.workId)?.state!=='failed')return null;
    const failures=options.workResultReader.readFailures(work.workId,{includeEvidence:true});
    if(failures.length!==1||failures[0].evidence?.diagnostics?.schema!=='arca.actor-publication-precondition@1')return null;
    const binding={work,failure:failures[0]},proof=assertPublicationFailure(binding,{caseId:snapshot.care.aftercareCaseId,
      intentDigest:snapshot.intent.intentDigest,shelfEntryId:snapshot.intent.shelfEntryId});
    if(proof.planDigest!==snapshot.plan?.planDigest)fail('Failed publication refers to a different frozen File Plan.');
    return binding;
  }
  function inspect(entryId,caseId){
    const current=base(entryId,caseId),{intent,care}=current,snapshot={...current,stages:{},source:{work:sourceWork(intent,caseId)},matching:[],selection:null,completion:null,plan:null,facts:null};
    if(options.workResultReader.status(snapshot.source.work.workId)?.state!=='succeeded')return snapshot;
    snapshot.source.record=exactSource(options,intent,caseId);
    const pages=[],records=[];
    if(intent.mode==='automatic')for(let ordinal=0;ordinal<intent.pageCount;ordinal++){
      const page=source.store.page(intent.intentId,ordinal),work=matchWork(intent,caseId,ordinal,page.pageDigest,snapshot.source.record.resultDigest),
        status=options.workResultReader.status(work.workId);snapshot.matching.push({work,page,status});pages.push(page);
      if(status?.state==='succeeded'){
        const values=options.workResultReader.read(work.workId).filter(item=>item.outcomeKind==='succeeded'&&item.capabilityRef==='arca.us_adult.references.match@1');
        if(values.length!==1)fail('A matching page lacks its one actual successful Result.');
        snapshot.matching[snapshot.matching.length-1].record=values[0];records.push(values[0]);
      }
    }
    if(intent.mode==='automatic'&&records.length!==intent.pageCount)return snapshot;
    const selected=buildSelection({intent,aftercareCaseId:caseId,sourceRecord:snapshot.source.record,pages,records,contractValidator:options.contractValidator});
    if(selected.kind==='unchanged'){
      snapshot.completion=selected.completion;snapshot.stages.unchanged={work:phaseWork(intent,care,'unchanged',[
        dependency(snapshot.source.work,snapshot.source.record.resultDigest),{ownerDomain:'arca',objectType:'complete_actor_matching',objectId:caseId,revision:1,digest:selected.completion.completionDigest}])};
      snapshot.stages.unchanged.record=completed(options,snapshot.stages.unchanged.work,'unchanged');return snapshot;
    }
    snapshot.selection=selected.selection;assertSelection(snapshot.selection,{validator:options.contractValidator});
    const assets=phaseWork(intent,care,'assets',[dependency(snapshot.source.work,snapshot.source.record.resultDigest),
      {ownerDomain:'arca',objectType:'actor_refresh_selection',objectId:caseId,revision:1,digest:snapshot.selection.selectionDigest}]);
    snapshot.stages.assets={work:assets,record:completed(options,assets,'assets')};
    if(!snapshot.stages.assets.record)return snapshot;
    const result=snapshot.stages.assets.record.result,port=portFor(current);
    if(result.intentDigest!==intent.intentDigest||result.aftercareCaseId!==caseId||result.selectionDigest!==snapshot.selection.selectionDigest||
        result.sourceResultDigest!==snapshot.source.record.resultDigest)fail('Prepared actor assets lost their exact source selection.');
    snapshot.plan=port.readJson(result.planHandle);options.contractValidator.validate('helix://contracts/domain-types/UsAdultActorFilePlan/v1',snapshot.plan);
    const {planDigest,...planBody}=snapshot.plan;
    if(planDigest!==canonicalDigest(planBody)||planDigest!==result.planDigest||snapshot.plan.intentDigest!==intent.intentDigest||snapshot.plan.aftercareCaseId!==caseId||
        snapshot.plan.selectionDigest!==snapshot.selection.selectionDigest)fail('Frozen Actor File Plan changed after asset preparation.');
    snapshot.facts=port.readJson(result.factsHandle);
    if(canonicalJson(snapshot.facts.selection)!==canonicalJson(snapshot.selection))fail('Prepared Facts replaced the exact frozen actor selection.');
    for(const name of ['metadata','cast']){const fact=snapshot.facts[name],{factDigest,...body}=fact||{};
      options.contractValidator.validate(fact.schemaRef,fact);
      if(factDigest!==canonicalDigest(body)||fact.selectionDigest!==snapshot.selection.selectionDigest||fact.intentDigest!==intent.intentDigest)fail('Prepared Arca facts changed their actor provenance.');}
    let previous=snapshot.stages.assets;
    for(const action of ['stage','publish','verify','commit','retire','close']){
      const dependencies=[dependency(assets,snapshot.stages.assets.record.resultDigest),
        ...(previous.work.workId===assets.workId?[]:[dependency(previous.work,previous.record.resultDigest)])],work=phaseWork(intent,care,action,dependencies),
        record=completed(options,work,action);snapshot.stages[action]={work,record};
      if(!record){
        if(action==='publish'){
          const failure=publicationFailure(snapshot);
          if(failure){
            const discardWork=phaseWork(intent,care,'discard',[dependency(assets,snapshot.stages.assets.record.resultDigest),
              dependency(snapshot.stages.stage.work,snapshot.stages.stage.record.resultDigest),
              {ownerDomain:'arca',objectType:'failed_actor_publication',objectId:work.workId,revision:1,digest:failure.failure.evidenceDigest}]),
              discarded=completed(options,discardWork,'discard');
            snapshot.publicationFailure=failure;snapshot.stages.discard={work:discardWork,record:discarded};
            if(discarded){const result=discarded.result;
              if(result.action!=='discard'||result.aftercareCaseId!==caseId||result.intentDigest!==intent.intentDigest||result.planDigest!==planDigest||
                  result.receiptDigest!==canonicalDigest(result.receipt)||result.receipt.schema!=='arca.us-adult-discarded-stage@1'||
                  result.receipt.stagedManifestDigest!==snapshot.stages.stage.record.result.receipt.manifestDigest)
                fail('Stage discard did not preserve its exact Case, Plan and original Stage manifest.');
            }
          }
        }
        break;
      }
      if(['stage','publish','verify','retire'].includes(action)&&
          (record.result.aftercareCaseId!==caseId||record.result.intentDigest!==intent.intentDigest||record.result.planDigest!==planDigest||
           record.result.selectionDigest!==snapshot.selection.selectionDigest||record.result.action!==action||record.result.receiptDigest!==canonicalDigest(record.result.receipt)))
        fail('A file Effect Result lost its exact Case, Plan or stage provenance.');
      previous=snapshot.stages[action];
    }
    return snapshot;
  }
  return Object.freeze({base,inspect,assertAuthority,portFor});
}
module.exports=Object.freeze({createUsAdultActorPipelineQuery});
