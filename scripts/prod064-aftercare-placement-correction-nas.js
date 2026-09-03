'use strict';

/**
 * PROD-064 guarded Aftercare placement incident correction and standard deploy.
 * The service is deliberately left stopped if any correction or verification step fails.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname,'..','tools','node_modules','ssh2'));
const { loadNasSshConfig } = require(path.join(__dirname,'..','tools','nas-ssh-config'));
const { INCIDENT_ENTRIES } = require(path.join(__dirname,'..','media-service','scripts','helix-prod064-aftercare-placement-incident-correction'));

const COMPOSE_DIR='/vol1/1000/docker/shelfdeck';
const DATA_DIR=`${COMPOSE_DIR}/data`;
const MEDIA_HOST='/vol02/1000-0-c5b736af';
const CONFIRMATION='PROD064_AFTERCARE_PLACEMENT_INCIDENT_CORRECTION_V1';

function quote(value){return `'${String(value).replace(/'/g,`'\''`)}'`;}
function parseArgs(argv){const parsed={localTar:'',sha256:'',apply:false,incidentStartMs:0};for(let index=0;index<argv.length;index+=1){const item=argv[index];if(item==='--apply')parsed.apply=true;else if(item==='--sha256')parsed.sha256=argv[++index]||'';else if(item.startsWith('--sha256='))parsed.sha256=item.slice(9);else if(item==='--incident-start-ms')parsed.incidentStartMs=Number(argv[++index]);else if(item.startsWith('--incident-start-ms='))parsed.incidentStartMs=Number(item.slice(20));else if(!parsed.localTar)parsed.localTar=item;else throw new Error(`Unknown argument: ${item}`);}if(!parsed.localTar||!/^[a-f0-9]{64}$/i.test(parsed.sha256)||!Number.isSafeInteger(parsed.incidentStartMs)||parsed.incidentStartMs<0)throw new Error('Tarball, exact SHA-256, and --incident-start-ms are required.');const match=path.basename(parsed.localTar).match(/^shelfdeck-(.+)\.tar$/);if(!match)throw new Error('Tarball must be named shelfdeck-<tag>.tar');parsed.remoteTar=`${COMPOSE_DIR}/${path.basename(parsed.localTar)}`;parsed.image=`markmahoro/shelfdeck:${match[1]}`;return parsed;}
function connect(){const client=new Client();return new Promise((resolve,reject)=>{client.on('ready',()=>resolve(client));client.on('error',reject);client.connect(loadNasSshConfig({readyTimeout:20000}));});}
function run(client,command){return new Promise((resolve,reject)=>{let output='',errorOutput='';client.exec(command,{pty:true},(error,stream)=>{if(error)return reject(error);stream.on('close',(code)=>resolve({code,output,errorOutput}));stream.on('data',(chunk)=>{output+=chunk;});stream.stderr.on('data',(chunk)=>{errorOutput+=chunk;});});});}
async function step(client,label,command){console.log(`\n>>> ${label}`);const result=await run(client,command);if(result.output)process.stdout.write(result.output);if(result.errorOutput)process.stderr.write(result.errorOutput);if(result.code!==0)throw new Error(`${label} failed with exit code ${result.code}`);return result;}
function correctionCommand(parsed,backupDir,apply=false){const exact=INCIDENT_ENTRIES.flatMap((id)=>['--expected-shelf-entry-id',id]);const args=['docker run --rm',`-v ${quote(`${DATA_DIR}:/app/data${apply?'':':ro'}`)}`,`-v ${quote(`${MEDIA_HOST}:/media${apply?'':':ro'}`)}`,`-v ${quote(`${backupDir}:/incident${apply?'':':ro'}`)}`,quote(parsed.image),'node scripts/helix-prod064-aftercare-placement-incident-correction.js','--data-dir /app/data','--media-root /media','--quarantine-root /media/.shelfdeck-incidents/prod064-aftercare-placement','--journal-dir /incident','--incident-start-ms',String(parsed.incidentStartMs),...exact.flatMap((item)=>[quote(item)])];if(apply)args.push('--apply','--confirm',CONFIRMATION);return args.join(' ');}
function standardDeploy(parsed,apply){return new Promise((resolve,reject)=>{const args=[path.join(__dirname,'deploy-nas.js'),parsed.remoteTar,'--sha256',parsed.sha256];if(apply)args.push('--apply');const child=spawn(process.execPath,args,{cwd:path.join(__dirname,'..'),stdio:'inherit'});child.on('error',reject);child.on('close',(code)=>code===0?resolve():reject(new Error(`deploy-nas.js exited ${code}`)));});}
async function main(){const parsed=parseArgs(process.argv.slice(2)),timestamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\..+$/,'Z'),backupDir=`${COMPOSE_DIR}/backups/prod064-preapply-${timestamp}`;
  console.log(`PROD-064 Aftercare placement correction (${parsed.apply?'APPLY':'DRY RUN'})`);console.log(`image: ${parsed.image}`);console.log(`backup: ${backupDir}`);console.log(`entries: ${INCIDENT_ENTRIES.length}`);
  if(!parsed.apply){console.log('\nDry run: standard deploy preflight, stopped-service assertion, second complete backup, exact correction plan/apply, converged plan, then standard deploy.');return;}
  if(!fs.existsSync(parsed.localTar))throw new Error('Local tarball is missing.');
  await standardDeploy(parsed,false);const client=await connect();try{
    await step(client,'Verify and load correction image',`test -f ${quote(parsed.remoteTar)} && [ "$(sha256sum ${quote(parsed.remoteTar)} | awk '{print $1}')" = "${parsed.sha256.toLowerCase()}" ] && docker load -i ${quote(parsed.remoteTar)}`);
    await step(client,'Keep ShelfDeck stopped',`cd ${quote(COMPOSE_DIR)} && docker compose stop shelfdeck && [ "$(docker inspect shelfdeck --format '{{.State.Running}}')" = "false" ]`);
    await step(client,'Create immediate complete recovery backup',`test ! -e ${quote(backupDir)} && mkdir -p ${quote(backupDir)} && cp -a ${quote(DATA_DIR)} ${quote(`${backupDir}/data`)} && cp -a ${quote(`${COMPOSE_DIR}/docker-compose.yml`)} ${quote(`${backupDir}/docker-compose.yml`)} && cp -a ${quote(`${COMPOSE_DIR}/secret.env`)} ${quote(`${backupDir}/secret.env`)} && [ "$(sha256sum ${quote(`${DATA_DIR}/shelfdeck.db`)} | awk '{print $1}')" = "$(sha256sum ${quote(`${backupDir}/data/shelfdeck.db`)} | awk '{print $1}')" ] && chmod 700 ${quote(backupDir)} && (cd ${quote(backupDir)} && sha256sum data/shelfdeck.db docker-compose.yml secret.env > SHA256SUMS)`);
    await step(client,'Plan exact physical and Arca correction',correctionCommand(parsed,backupDir,false));
    await step(client,'Apply exact physical and Arca correction',correctionCommand(parsed,backupDir,true));
    await step(client,'Verify correction converged while offline',`${correctionCommand(parsed,backupDir,false)} | tee /tmp/prod064-post-plan.json && grep -q '"moveCount": 0' /tmp/prod064-post-plan.json && grep -q '"inventoryAdvanceCount": 0' /tmp/prod064-post-plan.json && [ "$(docker inspect shelfdeck --format '{{.State.Running}}')" = "false" ]`);
  }finally{client.end();}
  await standardDeploy(parsed,true);
}
if(require.main===module)main().catch((error)=>{console.error(`\nPROD-064 CORRECTION BLOCKED; SHELFDECK REMAINS STOPPED: ${error.message}`);process.exitCode=1;});
module.exports=Object.freeze({parseArgs,correctionCommand});
