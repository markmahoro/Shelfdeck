'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
function createMappingJourney({db,request,confirmOnlyFrozen=false}) {
  let oldRunId=null, savedBasis=null, confirmation=null;
  return {
    async advance() {
      if(oldRunId)return;
      const row=db.prepare("SELECT r.* FROM libra_runs r JOIN libra_product_fact_revisions f ON f.libra_run_id=r.libra_run_id AND f.fact_kind='resolved_identity' WHERE r.state IN ('active','suspended','frozen') AND r.package_revision_head=0").get();
      if(!row)return;
      if(confirmOnlyFrozen&&row.state!=='frozen')return;
      if(confirmOnlyFrozen)assert.ok(db.prepare("SELECT 1 FROM fx_supporting_works w JOIN fx_workflow_events e ON e.work_id=w.work_id JOIN fx_event_attempts a ON a.event_id=e.event_id WHERE w.process_id=? AND e.capability_ref='libra.product_metadata.fetch@1' AND a.outcome_kind='failed' LIMIT 1").get(row.libra_run_id),
        'The frozen Run must come from real metadata execution failure.');
      oldRunId=row.libra_run_id;savedBasis=row.execution_basis_record_json;
      const base='/v1/admin/formation/runs/'+oldRunId;
      const before=db.prepare('SELECT count(*) n FROM libra_episode_metadata_reviews').get().n;
      const state=(await request('GET',base+'/episode-metadata-mapping')).json();
      assert.equal(db.prepare('SELECT count(*) n FROM libra_episode_metadata_reviews').get().n,before);
      const body={idempotencyKey:'mapping-review',expectedRunStateRevision:state.runStateRevision,expectedMappingRevision:0,providerSeasons:[0,2]};
      const reviewed=(await request('POST',base+'/actions/review-episode-metadata',body)).json().reviewRecord;
      await request('POST',base+'/actions/review-episode-metadata',{...body,idempotencyKey:'unused-mapping-review'});
      assert.equal(reviewed.review.members.length,2);
      const evidence=[0,2].map(season=>reviewed.review.evidence.find(item=>item.providerEpisode.seasonNumber===season&&item.providerEpisode.episodeNumber===1));
      assert.ok(evidence.every(Boolean));
      confirmation={idempotencyKey:'mapping-confirm',reviewId:reviewed.recordId,reviewDigest:reviewed.review.reviewDigest,
        choices:reviewed.review.members.map((member,index)=>({materialKey:member.materialKey,localScope:member.localScope,evidenceDigest:evidence[index].evidenceDigest}))};
      await request('POST',base+'/actions/confirm-episode-metadata',confirmation);
      await request('POST',base+'/actions/confirm-episode-metadata',confirmation);
      assert.equal(db.prepare('SELECT count(*) n FROM libra_episode_metadata_mapping_intents').get().n,1);
      assert.equal(db.prepare('SELECT execution_basis_record_json FROM libra_runs WHERE libra_run_id=?').get(oldRunId).execution_basis_record_json,savedBasis);
    },
    verify() {
      assert.ok(oldRunId,'The fixture must confirm an actual Run before collection.');
      const old=db.prepare('SELECT * FROM libra_runs WHERE libra_run_id=?').get(oldRunId);
      assert.equal(old.state,'superseded');assert.equal(old.execution_basis_record_json,savedBasis);
      const current=db.prepare('SELECT * FROM libra_runs WHERE supersedes_run_id=?').get(oldRunId);
      assert.ok(current);assert.equal(JSON.parse(current.execution_basis_record_json).episodeMetadataMappingRef.intentId,current.episode_metadata_mapping_intent_id);
      assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1);
      const facts=db.prepare("SELECT * FROM arca_inventory_product_facts WHERE fact_kind='product_metadata'").all();
      const episodes=facts.flatMap(row=>require('../../src/helix/contracts/episode-metadata-records').readStoredMetadataValue(row).episodeMetadata);
      assert.deepEqual(episodes.map(item=>[item.episodeScope.seasonNumber,item.episodeScope.episodeNumber]).sort(),[[1,1],[1,2]]);
      assert.ok(episodes.every(item=>item.descriptiveFacts.entries.find(field=>field.key==='episode_plot')?.value==='Episode 1 plot'),
        'Each selected local Episode must use its explicitly confirmed Provider Episode, even when local NFO has a plot.');
      const nfos=db.prepare("SELECT location FROM arca_inventory_materials WHERE role='metadata_sidecar'").all().map(row=>fs.readFileSync(row.location,'utf8')).filter(xml=>xml.includes('<episodedetails>'));
      assert.equal(nfos.length,2);assert.ok(nfos.every(xml=>xml.includes('<season>1</season>')));
      for(const number of [1,2])assert.ok(nfos.some(xml=>xml.includes('<episode>'+number+'</episode>')));
      assert.equal(db.pragma('integrity_check')[0].integrity_check,'ok');assert.deepEqual(db.pragma('foreign_key_check'),[]);
      return {oldRunId,newRunId:current.libra_run_id,confirmedFromFrozen:confirmOnlyFrozen,localEpisodes:2,providerSeasons:[0,2],commits:1};
    },
    verifyColdCopy() {
      const Database=require('better-sqlite3'),sourcePath=db.name,targetPath=path.join(path.dirname(sourcePath),'mapping-retained.db');
      const schemaManifest=require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
      const schemaDdl=fs.readFileSync(path.join(__dirname,'../../src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8');
      const owner=require('../../scripts/formation-reset-owner-snapshot').readResetOwnerSnapshot({Database,sourcePath});
      const policy=require('../../scripts/formation-reset-owner-policy').buildOwnerRetentionPolicy(schemaManifest,owner);
      const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
      const files=db.prepare('SELECT DISTINCT location FROM arca_inventory_materials').all().map(row=>({path:row.location,bytes:fs.readFileSync(row.location)}));
      const copy=require('../../scripts/formation-reset-copy').createRetainedDatabase({Database,sourcePath,targetPath,policy,targetSchema:{schemaManifest,schemaDdl}});
      require('../../scripts/formation-reset-normalize').normalizeRetainedSubjects({Database,targetPath,schemaManifest,schemaDdl,
        generationId:canonicalDigest('isolated-mapping-reset'),backupDigest:canonicalDigest('isolated-copy-only'),manifestDigest:copy.retainedDigest,
        seriesRetention:owner.seriesRetention,assertIsolated:value=>assert.equal(value,targetPath)});
      const verified=require('../../scripts/formation-reset-verify').verifyRetainedCollections({Database,sourcePath,targetPath,schemaManifest,schemaDdl});
      assert.equal(verified.reconstructedCommits,1);
      const target=new Database(targetPath,{readonly:true});
      try{
        assert.equal(db.prepare('SELECT count(*) n FROM libra_episode_metadata_reviews').get().n,2);
        assert.equal(target.prepare('SELECT count(*) n FROM libra_episode_metadata_reviews').get().n,1,'Unselected review is not a collection dependency.');
        for(const table of ['libra_episode_metadata_mapping_intents','libra_episode_metadata_mapping_heads'])
          assert.deepEqual(target.prepare('SELECT * FROM '+table).all(),db.prepare('SELECT * FROM '+table).all());
      }finally{target.close();}
      for(const file of files)assert.deepEqual(fs.readFileSync(file.path),file.bytes);
      return {commits:verified.reconstructedCommits,packages:verified.reconstructedPackages,selectedReviews:1,discardedReviews:1};
    },
  };
}
module.exports={createMappingJourney};
