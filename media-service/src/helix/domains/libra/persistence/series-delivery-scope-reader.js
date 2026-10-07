"use strict";

// These statements are executed by the calling Libra reader in its own snapshot.
const deliveryScopeStatements = Object.freeze({
  scope_runs: {kind:'select-all',tableId:'libra_runs',columns:['libra_run_id','state','run_material_manifest_id'],keyColumns:['subject_id']},
  scope_packages: {kind:'select-all',tableId:'libra_product_packages',columns:['offer_id'],keyColumns:['libra_run_id']},
  scope_receipt: {kind:'select-one',tableId:'libra_delivery_receipts',columns:['result'],keyColumns:['offer_id']},
  scope_members: {kind:'select-all',tableId:'libra_run_material_members',columns:['material_key'],keyColumns:['run_material_manifest_id']},
});

function readDeliveryScopes(repo, subjectId) {
  return repo.invoke('scope_runs',{subject_id:subjectId}).map(run=>({
    runId:run.libra_run_id,state:run.state,
    accepted:repo.invoke('scope_packages',{libra_run_id:run.libra_run_id}).some(pkg=>
      repo.invoke('scope_receipt',{offer_id:pkg.offer_id})?.result==='accepted'),
    materialKeys:repo.invoke('scope_members',{run_material_manifest_id:run.run_material_manifest_id}).map(row=>row.material_key),
  }));
}

module.exports=Object.freeze({deliveryScopeStatements,readDeliveryScopes});
