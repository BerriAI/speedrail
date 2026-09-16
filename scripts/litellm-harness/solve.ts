import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Store } from '../../server/store.js';
import { createApp } from '../../server/app.js';
import { FLASH_MODEL } from './budget.js';
import type { ReasoningEffort } from '../../shared/types.js';

const directory=process.argv[2],kind=process.argv[3],effort=process.argv[4] as ReasoningEffort;
const timeoutSeconds=Number(process.argv[5]);
const task=JSON.parse(readFileSync(join(directory,'solver-task.json'),'utf8'));
const {id}=task,label=process.argv[6],workspace=join(directory,'workspace');
const prompt=readFileSync(join(directory,'prompt.txt'),'utf8');
const started=Date.now();let timedOut=false;
if(kind==='codex'){
  // Seatbelt is already enforced by the parent. Applying a second macOS
  // sandbox fails with sandbox_apply; this disables only Codex's inner layer.
  const command=['exec','--ignore-user-config','--ignore-rules','--ephemeral','-m','gpt-6-astra','-c','model_reasoning_effort='+JSON.stringify(effort),'-c','approval_policy="never"','-c','web_search="disabled"','-s','danger-full-access','--json','-C',workspace,'-'];
  const child=spawn('codex',command,{env:{...process.env,LITELLM_LOCAL_MODEL_COST_MAP:'True',PYTHON_DOTENV_DISABLED:'1'},stdio:['pipe','pipe','pipe']});
  const out:string[]=[],err:string[]=[];child.stdout.on('data',s=>out.push(String(s)));child.stderr.on('data',s=>err.push(String(s)));child.stdin.end(prompt);
  const timeout=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},timeoutSeconds*1000);
  const exit=await new Promise<number|null>((resolve,reject)=>{child.on('close',resolve);child.on('error',reject);});clearTimeout(timeout);
  writeFileSync(join(directory,'codex.jsonl'),out.join(''));writeFileSync(join(directory,'codex.stderr'),err.join(''));
  writeFileSync(join(directory,'result.json'),JSON.stringify({id,kind,label,promptRevision:task.prompt_revision,snapshotRevision:task.snapshot_revision,evaluationProtocol:6,isolation:'macOS-seatbelt',timeoutSeconds,seconds:(Date.now()-started)/1000,exit,timedOut,model:'gpt-6-astra',effort},null,2));
}else{
  const connection=JSON.parse(readFileSync(join(directory,'runner-connection.json'),'utf8'));
  const store=new Store(join(directory,'state'));
  const provider={id:'campaign',name:'Metered campaign',kind:'openai' as const,...connection,contextWindows:{[FLASH_MODEL]:1048576}};
  store.saveSettings({workspace,providers:[provider],defaultProvider:provider.id,defaultModel:FLASH_MODEL,permissionMode:'auto',memoryEnabled:false});
  const {runner}=createApp({store,external:{capture:()=>({definitions:[],scope:()=>'',assertCurrent:()=>{},execute:async()=>'',release:()=>{}})}});
  const session=store.createSession({workspace,providerId:provider.id,model:FLASH_MODEL,permissionMode:'auto',modelReasoning:{[JSON.stringify([provider.id,FLASH_MODEL])]:effort},...(kind==='single'?{}:{architecture:{kind:'litellm-specific'}})});
  const timeout=setTimeout(()=>{timedOut=true;void runner.cancel(session.id);},timeoutSeconds*1000);
  try{runner.start(session.id,prompt);await runner.whenIdle();}finally{clearTimeout(timeout);runner.stopAll();await runner.whenIdle();}
  const messages=store.messages(session.id),last=messages.findLast(m=>m.role==='assistant');
  writeFileSync(join(directory,'messages.json'),JSON.stringify(messages,null,2));
  const archives=store.sessions('',true).filter(s=>s.parentId===session.id).sort((a,b)=>a.createdAt-b.createdAt).map(s=>({sessionId:s.id,messages:store.messages(s.id)}));
  writeFileSync(join(directory,'archives.json'),JSON.stringify(archives,null,2));
  writeFileSync(join(directory,'result.json'),JSON.stringify({id,kind,label,promptRevision:task.prompt_revision,snapshotRevision:task.snapshot_revision,contextWindow:1048576,effort,evaluationProtocol:6,isolation:'macOS-seatbelt',timeoutSeconds,seconds:(Date.now()-started)/1000,timedOut,status:store.session(session.id).status,usage:last?.turnUsage,errors:messages.flatMap(m=>m.error?[m.error]:[]),final:last?.content},null,2));
  store.close();
}
