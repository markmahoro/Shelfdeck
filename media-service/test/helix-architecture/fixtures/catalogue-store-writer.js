'use strict';
const {workerData,parentPort,isMainThread}=require('node:worker_threads');
if(isMainThread||workerData?.protocol!=='catalogue-store-writer-test@1')throw new Error('This fixture requires its test thread.');
const {schemaManifest,schemaDdl,contractValidator,Database}=require('./us-adult-catalogue-store');
const {openSqliteKernel}=require('../../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createUsAdultCatalogueStore}=require('../../../src/helix/domains/libra/persistence/us-adult-catalogue-store');
let kernel,result;
try{
  kernel=openSqliteKernel({Database,databasePath:workerData.databasePath,schemaDdl,schemaManifest,now:()=>1700000000000});
  const store=createUsAdultCatalogueStore({schemaManifest,contractValidator,unitOfWork:createSqliteUnitOfWork({kernel})}),barrier=new Int32Array(workerData.barrier);
  parentPort.postMessage({kind:'ready'});
  if(Atomics.load(barrier,0)===0&&Atomics.wait(barrier,0,0,10000)==='timed-out')throw new Error('Test barrier expired.');
  result={kind:'result',status:'fulfilled',basisDigest:store.freeze(workerData.basis).basisDigest};
}catch(error){result={kind:'result',status:'rejected',code:error.code||error.name};}
finally{kernel?.close();}
parentPort.postMessage(result);
