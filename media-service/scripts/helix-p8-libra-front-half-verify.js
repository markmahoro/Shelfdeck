'use strict';

const childProcess=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');

const serviceRoot=path.resolve(__dirname,'..'),testRoot=path.join(serviceRoot,'test','helix-architecture');
function spawn(args){return childProcess.spawnSync(process.execPath,args,{cwd:serviceRoot,encoding:'utf8',maxBuffer:80*1024*1024,
  env:{...process.env,NODE_ENV:'test',HELIX_SSOT_PATH:process.env.HELIX_SSOT_PATH||path.resolve(serviceRoot,'../docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md')}});}
function gate(script){const child=spawn([script]);let output;try{output=JSON.parse(child.stdout);}catch(error){output={ok:false,parseError:error.message};}
  return {ok:child.status===0&&output.ok===true,status:child.status,scope:output.scope,findings:output.findings||[],prohibitedActionsRun:output.prohibitedActionsRun||[],
    failure:output.failure,stderr:child.status===0?undefined:child.stderr.slice(-4000)};}
function manifests(){const root=path.join(serviceRoot,'src','helix','contracts','capabilities','libra'),values=[];function visit(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
  const target=path.join(directory,entry.name);if(entry.isDirectory())visit(target);else if(entry.name==='manifest.json')values.push(JSON.parse(fs.readFileSync(target,'utf8')));}}visit(root);return values;}

const p8Files=fs.readdirSync(testRoot).filter((name)=>/^p8-.*\.test\.js$/.test(name)).sort().map((name)=>path.join('test','helix-architecture',name));
const fixtures=spawn(['--test',...p8Files]),libraFrontHalfRefs=new Set(['libra.decision.query.resolve@1','libra.decision_basis.commit@1','libra.intake.candidate.verify@1',
  'libra.intake.material.verify@1','libra.intake.binding.resolve@1','libra.intake.accept.commit@1','libra.intake.rejection.commit@1',
  'libra.routing.fact.observe@1']);
const registered=manifests().filter((item)=>libraFrontHalfRefs.has(item.capabilityRef)).sort((a,b)=>a.capabilityRef.localeCompare(b.capabilityRef));
// Keep the routine harness bounded; the phase Exit Audit runs the heavier
// P4-P7 aggregates once, while Architecture and Persistence protect every run.
const regressions={architecture:gate('scripts/helix-architecture-verify.js'),persistence:gate('scripts/helix-p3-persistence-verify.js')};
const findings=[];if(fixtures.status!==0)findings.push({code:'P8_FIXTURE_FAILED',stdout:fixtures.stdout.slice(-10000),stderr:fixtures.stderr.slice(-4000)});
if(registered.length!==8)findings.push({code:'P8_CAPABILITY_COUNT_MISMATCH',actual:registered.length});for(const [name,value] of Object.entries(regressions))if(!value.ok)findings.push({code:'P8_REGRESSION_GATE_FAILED',gate:name});
const prohibitedActionsRun=[...new Set(Object.values(regressions).flatMap((value)=>value.prohibitedActionsRun))];if(prohibitedActionsRun.length)findings.push({code:'P8_PROHIBITED_ACTION_REPORTED',actions:prohibitedActionsRun});
const result={ok:findings.length===0,scope:'P8_LOCAL_ISOLATED_LIBRA_FRONT_HALF',libraFrontHalf:{fixtureFileCount:p8Files.length,fixturesOk:fixtures.status===0,
  capabilityCount:registered.length,capabilities:registered.map(({capabilityRef,effectClass,packageDigest})=>({capabilityRef,effectClass,packageDigest}))},regressions,prohibitedActionsRun,findings};
process.stdout.write(JSON.stringify(result,null,2)+'\n');if(!result.ok)process.exitCode=1;
