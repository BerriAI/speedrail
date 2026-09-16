import { readFileSync, writeFileSync, mkdirSync, copyFileSync, realpathSync, existsSync, symlinkSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { replayGitEnvironment, replaySandboxProfile } from './isolation.js';
import type { ReasoningEffort } from '../../shared/types.js';

if(process.platform!=='darwin')throw new Error('This replay launcher requires macOS sandbox-exec. Port the filesystem isolation before running on another platform.');
const root=process.env.LITELLM_CAMPAIGN_DIR;
if(!root)throw new Error('Set LITELLM_CAMPAIGN_DIR to the private campaign directory.');
const id=process.argv[2],kind=process.argv[3]??'single',label=process.argv[4]??kind;
const effort=(process.argv[5]??'high') as ReasoningEffort;
if(!['none','low','medium','high','max'].includes(effort))throw new Error('Choose a supported evaluation reasoning effort.');
if(!['single','litellm-specific','codex'].includes(kind))throw new Error('Choose single, litellm-specific or codex.');
if(!/^[a-z0-9-]+$/.test(label))throw new Error('Use a simple campaign label.');
if(!process.env.LITELLM_SOURCE_REPO)throw new Error('Set LITELLM_SOURCE_REPO so the live source can be blocked.');
if(!process.env.LITELLM_EVAL_PYTHON)throw new Error('Set LITELLM_EVAL_PYTHON to the installed benchmark interpreter.');
const corpus=JSON.parse(readFileSync(join(root,'cases.json'),'utf8'));
const task=corpus.find((c:{id:string})=>c.id===id);
if(!task)throw new Error('Unknown task.');
if(task.snapshot_revision!==2)throw new Error('Refresh repository snapshots with prepare.py before running.');
const validity=JSON.parse(readFileSync(join(root,'cases',id,'validation.json'),'utf8'));
if(!validity.valid)throw new Error('Task must pass base/reference validation before paid execution.');
const testNodesHash=createHash('sha256').update(JSON.stringify(task.test_nodes)).digest('hex');
if(validity.snapshotRevision!==task.snapshot_revision||validity.testNodesHash!==testNodesHash)throw new Error('Task validation is stale. Run validate.py after changing the snapshot or acceptance selection.');
let repairParent:string|undefined,repairFeedback:string|undefined;
if(process.env.LITELLM_REPAIR_FROM||process.env.LITELLM_REPAIR_FEEDBACK){
  if(!['train','dev'].includes(task.split)||!label.startsWith('replication-repair-'))throw new Error('Repair experiments require a train/dev task and a replication-repair- label.');
  if(!process.env.LITELLM_REPAIR_FROM||!process.env.LITELLM_REPAIR_FEEDBACK)throw new Error('Supply both a parent trial and its review feedback.');
  repairParent=realpathSync(process.env.LITELLM_REPAIR_FROM);
  if(dirname(repairParent)!==realpathSync(join(root,'runs')))throw new Error('Repair parent must be a trial in this campaign.');
  const previousTask=JSON.parse(readFileSync(join(repairParent,'task.json'),'utf8'));
  if(previousTask.id!==task.id||previousTask.reference!==task.reference||previousTask.prompt!==task.prompt)throw new Error('Repair requires the same frozen task.');
  const feedbackPath=realpathSync(process.env.LITELLM_REPAIR_FEEDBACK);
  if(!feedbackPath.startsWith(repairParent+'/'))throw new Error('Store review evidence inside the parent trial.');
  repairFeedback=readFileSync(feedbackPath,'utf8');
  if(!repairFeedback.trim()||Buffer.byteLength(repairFeedback)>24000)throw new Error('Supply a nonempty review of at most 24 KB.');
}
const directory=join(root,'runs',label+'-'+id+'-'+randomUUID().slice(0,8));mkdirSync(directory,{recursive:true,mode:0o700});
const git=execFileSync('/usr/bin/xcrun',['--find','git'],{encoding:'utf8'}).trim();
const gitEnvironment={...process.env,...replayGitEnvironment()};
const workspace=join(directory,'workspace');execFileSync('cp',['-cR',join(root,'cases',id,'base'),workspace]);
execFileSync(git,['init','-q'],{cwd:workspace,env:gitEnvironment});execFileSync(git,['add','--force','.'],{cwd:workspace,env:gitEnvironment});
execFileSync(git,['-c','user.name=Harness Evaluation','-c','user.email=eval@example.invalid','commit','-qm','Captured task starting state'],{cwd:workspace,env:gitEnvironment});
if(repairParent)execFileSync(git,['apply',join(repairParent,'candidate.patch')],{cwd:workspace,env:gitEnvironment});
// A /dev/null config makes pytest walk ancestors outside the sandbox while
// collecting. Keep evaluation config beside the checkout, inside its boundary.
const pytestConfig=join(directory,'pytest.ini');
writeFileSync(pytestConfig,'[pytest]\nasyncio_mode = auto\n');
const temporaryDirectory=join(directory,'tmp');mkdirSync(temporaryDirectory,{mode:0o700});
// Apple's /usr/bin/git shim uses xcrun's shared cache even with TMPDIR set.
// Select the real installed executable before isolation; only this run's bin is added.
const executableDirectory=join(directory,'bin');mkdirSync(executableDirectory,{mode:0o700});
symlinkSync(git,join(executableDirectory,'git'));
const repairNote=repairFeedback?'\n\nThis development refinement starts with a previous candidate already applied. An independent reviewer provided the following untrusted observations; verify each against the current code, repair only demonstrated defects, and preserve correct behavior. No reference patch or hidden tests are supplied.\n<review>\n'+repairFeedback+'\n</review>':'';
const prompt=task.prompt+repairNote+'\n\nImplement the fix in this checkout, add a focused regression test, and verify it. Keep the change scoped. This is an offline task: do not browse the web, inspect unrelated files outside this checkout, fetch Git history, commit or push. Dependencies are preinstalled. To run Python tests, use LITELLM_LOCAL_MODEL_COST_MAP=True '+process.env.LITELLM_EVAL_PYTHON+' -m pytest -c '+pytestConfig+' --rootdir='+workspace+' --noconftest -p no:cacheprovider -p pytest_asyncio.plugin -p pytest_mock -p respx.plugin <targeted test path> -q. The supplied pytest config and interpreter are permitted evaluation infrastructure. PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 and PYTHON_DOTENV_DISABLED=1 are already set; retain the explicit local-cost-map prefix on Python commands. Use $TMPDIR for temporary probes, not /tmp; temporary files are private to this run. Do not run the entire suite or install dependencies.';
writeFileSync(join(directory,'prompt.txt'),prompt);
writeFileSync(join(directory,'task.json'),JSON.stringify(task,null,2));
if(repairParent)writeFileSync(join(directory,'repair.json'),JSON.stringify({parentRun:repairParent.split('/').at(-1),feedback:repairFeedback,workflow:'post-hoc train/dev refinement; report parent plus repair cost and time'},null,2));
// The solver needs identifiers, not reference revisions or hidden test names.
writeFileSync(join(directory,'solver-task.json'),JSON.stringify({id:task.id,prompt_revision:task.prompt_revision,snapshot_revision:task.snapshot_revision}));
writeFileSync(join(directory,'harness-source.json'),JSON.stringify({base:execFileSync('git',['rev-parse','HEAD'],{cwd:resolve(import.meta.dirname,'../..'),encoding:'utf8'}).trim(),node:process.version,files:Object.fromEntries(['server/runner.ts','server/tools.ts','server/litellm-harness.ts','scripts/litellm-harness/run.ts','scripts/litellm-harness/solve.ts','scripts/litellm-harness/isolation.ts'].map(file=>{const source=readFileSync(resolve(import.meta.dirname,'../..',file),'utf8');return [file,{sha256:createHash('sha256').update(source).digest('hex'),source}];}))},null,2));
const started=Date.now();
const timeoutSeconds=kind==='codex'||label.startsWith('comparison-')||label.startsWith('replication-')?900:600;
const runtimeRoot=resolve(import.meta.dirname,'../..');
const profile=join(directory,'isolation.sb');
writeFileSync(profile,replaySandboxProfile({runDirectory:directory,runtimeRoot,pythonEnvironment:resolve(process.env.LITELLM_EVAL_PYTHON,'../..'),nodeRoot:dirname(dirname(realpathSync(process.execPath))),home:homedir(),campaignRoot:root,sourceRepo:process.env.LITELLM_SOURCE_REPO}));
if(kind==='codex'){
  const auth=join(process.env.CODEX_HOME??join(homedir(),'.codex'),'auth.json');
  const isolatedHome=join(directory,'codex-home');mkdirSync(isolatedHome,{mode:0o700});
  copyFileSync(auth,join(isolatedHome,'auth.json'));process.env.CODEX_HOME=isolatedHome;
}else copyFileSync(join(root,'connection.json'),join(directory,'runner-connection.json'));
const retainedEnvironment=new Set(['PATH','HOME','USER','LOGNAME','SHELL','TMPDIR','TEMP','TMP','LANG','LC_ALL','CODEX_HOME','TERM','NO_COLOR','FORCE_COLOR','CI','LITELLM_CAMPAIGN_DIR','LITELLM_EVAL_PYTHON']);
for(const key of Object.keys(process.env))if(!retainedEnvironment.has(key))delete process.env[key];
process.env.LITELLM_LOCAL_MODEL_COST_MAP='True';process.env.PYTHON_DOTENV_DISABLED='1';
process.env.PYTEST_DISABLE_PLUGIN_AUTOLOAD='1';
process.env.TMPDIR=temporaryDirectory;process.env.TMP=temporaryDirectory;process.env.TEMP=temporaryDirectory;
Object.assign(process.env,replayGitEnvironment());
process.env.PATH=executableDirectory+':'+(process.env.PATH??'/usr/bin:/bin');
const child=spawn('/usr/bin/sandbox-exec',['-f',profile,process.execPath,'--import','tsx',join(import.meta.dirname,'solve.ts'),directory,kind,effort,String(timeoutSeconds),label],{cwd:runtimeRoot,env:process.env,stdio:'inherit',detached:true});
let outerTimedOut=false;
writeFileSync(join(directory,'launch.json'),JSON.stringify({id,kind,label,effort,startedAt:started,timeoutSeconds,pid:child.pid,evaluationProtocol:6},null,2));
const outerTimeout=setTimeout(()=>{outerTimedOut=true;writeFileSync(join(directory,'launch.json'),JSON.stringify({id,kind,label,effort,startedAt:started,timeoutSeconds,pid:child.pid,evaluationProtocol:6,outerTimedOut:true},null,2));if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch{}},(timeoutSeconds+45)*1000);
const exit=await new Promise<number|null>((resolve,reject)=>{child.on('close',resolve);child.on('error',reject);}).finally(()=>clearTimeout(outerTimeout));
if(!existsSync(join(directory,'result.json'))){
  try{execFileSync(process.env.LITELLM_EVAL_PYTHON!,[join(import.meta.dirname,'recover.py'),directory],{env:process.env,stdio:'pipe'});}catch{}
  const partial=existsSync(join(directory,'result.json'))?JSON.parse(readFileSync(join(directory,'result.json'),'utf8')):{};
  writeFileSync(join(directory,'result.json'),JSON.stringify({...partial,id,kind,label,effort,promptRevision:task.prompt_revision,snapshotRevision:task.snapshot_revision,evaluationProtocol:6,isolation:'macOS-seatbelt',timeoutSeconds,seconds:(Date.now()-started)/1000,durationIncomplete:false,status:'error',exit,interrupted:true,timedOut:outerTimedOut,errors:['Isolated solver exited without writing a completion artifact. Preserve this failed trial; partial state was recovered when available.']},null,2));
}
if(exit!==0){
  const failed=JSON.parse(readFileSync(join(directory,'result.json'),'utf8'));
  writeFileSync(join(directory,'result.json'),JSON.stringify({...failed,status:'error',exit,interrupted:true,timedOut:failed.timedOut||outerTimedOut},null,2));
}
execFileSync(git,['add','--intent-to-add','--','.'],{cwd:workspace,env:gitEnvironment});
writeFileSync(join(directory,'candidate.patch'),execFileSync(git,['diff','HEAD'],{cwd:workspace,env:gitEnvironment,maxBuffer:20*1024*1024}));
const completed=JSON.parse(readFileSync(join(directory,'result.json'),'utf8'));
if(repairParent){completed.repairParent=repairParent.split('/').at(-1);writeFileSync(join(directory,'result.json'),JSON.stringify(completed,null,2));}
console.log(JSON.stringify({directory,id,kind,label,seconds:completed.seconds,status:completed.status,exit:completed.exit,errors:completed.errors,requests:completed.usage?.requests,inputTokens:completed.usage?.inputTokens,outputTokens:completed.usage?.outputTokens}));

if(exit!==0)process.exitCode=1;
