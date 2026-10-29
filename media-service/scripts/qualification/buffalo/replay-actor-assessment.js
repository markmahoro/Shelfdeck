'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {policy,assessCatalogueActors}=require('../../../src/helix/domains/libra/model/us-adult-catalogue-assessment');
// This explicit fixture policy is not a calibrated production default.
const frozen=policy({maximumDistance:0.5,minimumDistanceMargin:0.05,minimumRepresentativeStrata:2,minimumCoverageStrata:3});
const source=JSON.parse(fs.readFileSync('/evidence/video-report.json','utf8'));
assert.equal(source.outcome,'completed');
const report={schema:'buffalo-actor-assessment-qualification@1',qualificationOnly:true,policy:frozen,grids:[],genderInvariantReplays:0};
for(const sample of source.samples){
  assert.equal(sample.outcome,'completed');
  for(const grid of sample.groups){
    const result=assessCatalogueActors({groups:grid.clusters,policy:frozen});
    for(const variant of ['MALE','FEMALE',null,undefined,'conflicting_value']){
      const groups=structuredClone(grid.clusters);
      for(const group of groups)for(const candidate of group.candidates)for(const item of candidate.observations){
        if(variant===undefined)delete item.gender;else item.gender=variant;
      }
      assert.deepEqual(assessCatalogueActors({groups,policy:frozen}),result);
      report.genderInvariantReplays++;
    }
    report.grids.push({sampleOrdinal:sample.sampleOrdinal,threshold:grid.threshold,status:result.status,winner:result.winner,
      qualifiedGroups:result.qualifiedGroupCount,assessmentDigest:result.assessmentDigest});
  }
}
fs.writeFileSync('/output/actor-assessment.json',JSON.stringify(report));
console.log(JSON.stringify({grids:report.grids.length,genderInvariantReplays:report.genderInvariantReplays,
  statuses:report.grids.map(x=>({sample:x.sampleOrdinal,threshold:x.threshold,status:x.status,winner:x.winner?.name||null}))}));
