import { WorkspacePreferences } from '../server/workspace-preferences.js';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer as createViteServer } from 'vite';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';
import { attachTerminals } from '../server/terminal.js';
import { McpManager } from '../server/mcp.js';

const root=await realpath(await mkdtemp(join(tmpdir(),'litespeed-e2e-')));
await mkdir(join(root,'src'));await writeFile(join(root,'src','hello.ts'),'export const hello = "world";\n');await writeFile(join(root,'README.md'),'# Fixture project\nA small project for browser tests.\n');
let providerRequests=0;
const profileRequests:{model:string;messages:any[];tools:any[]}[]=[];
const pendingSummaries=new Set<()=>void>();
const delegationRequests:{model:string;messages:any[];tools:any[];reasoningEffort?:string}[]=[];
const pendingDelegations=new Set<()=>void>();
const mock=createServer(async(req,res)=>{
  if(req.url?.startsWith('/setup-auth/')&&req.headers.authorization!=='Bearer fixture-key'){res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Invalid API key'}}));return;}
  if(req.url==='/no-specialists/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'unknown-lead'}]}));return;}
  if(req.url?.endsWith('/models')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'test-model',model_info:{base_model:'claude-opus-5'}},{id:'test-fast',model_info:{base_model:'gemini-3.8-flash'}},{id:'budget-model',context_window:16384}]}));return;}
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);let data:any;
  try{data=JSON.parse(Buffer.concat(chunks).toString());}catch{res.writeHead(400);res.end();return;}
  providerRequests++;
  const lastUser=data.messages.filter((m:any)=>m.role==='user').at(-1)?.content||'';
  const prompt=typeof lastUser==='string'?lastUser:JSON.stringify(lastUser);
  if(prompt.includes('PROFILE_BROWSER')){profileRequests.push({model:data.model,messages:data.messages,tools:data.tools||[]});if(profileRequests.length>30)profileRequests.shift();}
  if(prompt.includes('DELEGATE_BROWSER')||prompt.includes('DELEGATE_CHILD')||prompt.includes('SIDEKICK_BROWSER')||prompt.includes('SIDEKICK_CHILD')||prompt.includes('FUSION_BROWSER')||prompt.includes('FUSION_CHILD')){delegationRequests.push({model:data.model,messages:data.messages,tools:data.tools||[],reasoningEffort:data.reasoning_effort});if(delegationRequests.length>100)delegationRequests.shift();}
  if(prompt.includes('provider failure')||(prompt.includes('DELEGATE_CHILD')&&prompt.includes('CHILD_FAILURE'))){res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Fixture provider rejected the request.'}}));return;}
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const emit=(delta:any,finish_reason?:string)=>res.write(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason}]})}\n\n`);
  let toolCall=false;
  const summarizing=data.messages.some((message:any)=>message.role==='system'&&typeof message.content==='string'&&message.content.includes('Summarize the supplied conversation data'));
  if(data.messages.some((message:any)=>message.role==='system'&&typeof message.content==='string'&&message.content.includes('You are a precise code analyst.'))) {
    emit({content:'The fixture exports a greeting. Shunt kept the source out of the caller context.'});
    if(prompt.includes('LIVE_SHUNT'))await new Promise<void>(resolve=>{const release=()=>{pendingDelegations.delete(release);res.off('close',release);resolve();};pendingDelegations.add(release);res.once('close',release);});
    if(res.destroyed)return;
  }else if(prompt.includes('LITELLM_BROWSER')) {
    if(!data.messages.some((message:any)=>message.role==='tool')) {
      toolCall=true;emit({tool_calls:[{index:0,id:'litellm-navigation',type:'function',function:{name:'litellm_context',arguments:JSON.stringify({path:'litellm/example.py',symbol:'transform_request'})}}]});
    }else emit({content:'Located transform_request and its existing tests. Planning complete.'});
  }else if(prompt.includes('LITEFUSION_HANDOFF_BROWSER')) {
    const child=data.messages.some((m:any)=>m.role==='system'&&String(m.content).includes('You are a LiteFusion worker.'));
    const call=(args:any)=>{toolCall=true;emit({tool_calls:[{index:0,id:`handoff-${providerRequests}`,type:'function',function:{name:'delegate',arguments:JSON.stringify(args)}}]});};
    if(child) {
      if(prompt.includes('Follow up')) {
        emit({content:'Retry worker is checking the result.'});
        await new Promise<void>(resolve=>{const release=()=>{pendingDelegations.delete(release);res.off('close',release);resolve();};pendingDelegations.add(release);res.once('close',release);});if(res.destroyed)return;
        toolCall=true;emit({tool_calls:[{index:0,id:'handoff-help',type:'function',function:{name:'worker_request',arguments:JSON.stringify({outcome:'needs_help',reason:'Workspace history needs recovery. '+ 'Detailed blocker context. '.repeat(80),evidence:'FULL_WORKER_EVIDENCE '+ 'Observed test output.\n'.repeat(300)})}}]});
      }else emit({content:'Initial check complete.'});
    }else {
      const count=data.messages.flatMap((m:any)=>m.tool_calls??[]).filter((c:any)=>c.function.name==='delegate').length;
      const reports=data.messages.filter((m:any)=>m.role==='system'&&String(m.content).startsWith('LiteFusion task result.')).map((m:any)=>JSON.parse(m.content.slice(m.content.indexOf('\n')+1)));
      const assignment={roleId:'bounded_patch',workstream:'markdown',description:'Fix heading rendering',prompt:'Initial check',reason:'Reproduce handoff recovery',acceptance:['Report evidence'],hard:true};
      if(!count)call(assignment);
      else if(reports.length&&count===1)call({...assignment,prompt:'Follow up',continueFrom:reports[0].taskId,repairOf:reports[0].attemptId});
      else if(reports.length&&count===2)call({...assignment,prompt:'Follow up',continueFrom:reports[0].taskId});
      else if(reports.length<2){toolCall=true;emit({tool_calls:[{index:0,id:'handoff-wait',type:'function',function:{name:'wait_tasks',arguments:'{}'}}]});}
      else emit({content:'The worker needs lead attention. Evidence is retained in its inspector.'});
    }
  }else if(prompt.includes('LITEFUSION_BROWSER')) {
    const child=data.messages.some((m:any)=>m.role==='system'&&typeof m.content==='string'&&m.content.includes('You are a LiteFusion worker.'));
    if(child) {
      const name=prompt.includes('alpha.txt')?'alpha':'beta';
      if(data.messages.at(-1)?.role!=='tool') {toolCall=true;emit({tool_calls:[{index:0,id:`lf-write-${name}`,type:'function',function:{name:'write_file',arguments:JSON.stringify({path:`${name}.txt`,content:`${name} written`})}}]});}
      else {emit({content:`${name} worker report`});await new Promise<void>(resolve=>{const release=()=>{pendingDelegations.delete(release);res.off('close',release);resolve();};pendingDelegations.add(release);res.once('close',release);});if(res.destroyed)return;}
    } else if(!data.messages.some((message:any)=>message.role==='assistant'&&message.tool_calls?.some((call:any)=>call.function.name==='delegate'))) {
      toolCall=true;emit({tool_calls:['alpha','beta'].map((name,index)=>({index,id:`lf-${name}`,type:'function',function:{name:'delegate',arguments:JSON.stringify({roleId:'bounded_patch',workstream:name,description:`Write ${name}`,prompt:`Write ${name}.txt`,files:[`${name}.txt`],reason:'Independent bounded files',acceptance:[`${name}.txt contains ${name} written`]})}}))});
    } else if(data.messages.filter((message:any)=>message.role==='system'&&String(message.content).startsWith('LiteFusion task result.')).length<2){toolCall=true;emit({tool_calls:[{index:0,id:'lf-wait',type:'function',function:{name:'wait_tasks',arguments:'{}'}}]});}
    else emit({content:'LiteFusion fixture finished. Review the integrated files.'});
  }else if(prompt.includes('SHUNT_WORKERS')&&data.messages.at(-1)?.role!=='tool') {
    toolCall=true;emit({tool_calls:['alpha','beta'].map((name,index)=>({index,id:`shunt-worker-${name}`,type:'function',function:{name:'delegate',arguments:JSON.stringify({description:`Read ${name}`,prompt:`SHUNT_CHILD ${name}`})}}))});
  }else if((prompt.includes('SHUNT_BROWSER')||prompt.includes('SHUNT_CHILD'))&&data.messages.at(-1)?.role!=='tool') {
    toolCall=true;emit({tool_calls:[{index:0,id:'shunt-reader',type:'function',function:{name:'bulk_read',arguments:JSON.stringify({paths:['README.md'],question:`LIVE_SHUNT explain the fixture ${prompt.includes('beta')?'beta':'alpha'}`})}}]});
  }else if(summarizing){
    if(prompt.includes('WAIT_BUDGET_SUMMARY')) {
      await new Promise<void>(resolve=>{const release=()=>{pendingSummaries.delete(release);res.off('close',release);resolve();};pendingSummaries.add(release);res.once('close',release);});
      if(res.destroyed)return;
    }
    if(!prompt.includes('EMPTY_BUDGET_SUMMARY'))emit({content:'Earlier context: the user discussed a local fixture project and wants accurate, tested changes. Preserve the latest user request and continue. No tools or tests were run while summarizing.'});
  }else if(prompt.includes('CACHE_PARTIAL_BROWSER')){
    if(data.messages.at(-1)?.role==='tool'){
      emit({content:'Partial answer before the connection dropped.'});
      await new Promise(resolve=>setTimeout(resolve,50));res.destroy();return;
    }
    toolCall=true;emit({tool_calls:[{index:0,id:'cache-read',type:'function',function:{name:'glob',arguments:JSON.stringify({pattern:'*'})}}]});
  }else if(prompt.includes('TUI_FLOW_')){
    const child=prompt.includes('TUI_FLOW_CHILD'), count=data.messages.filter((m:any)=>m.role==='tool').length;
    const pause=()=>new Promise(resolve=>setTimeout(resolve,200));
    const say=async(text:string)=>{for(const part of text.match(/.{1,24}|\n/g)||[]){if(res.destroyed)return;emit({content:part});await pause();}};
    const call=(name:string,args:any)=>{toolCall=true;emit({tool_calls:[{index:0,id:`flow-${child?'child':'driver'}-${count}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]});};
    const todos=(stage:number)=>({todos:(child?['Inspect project files','Update the project note','Report the result']:['Review the project','Check the Sidekick change']).map((content,index)=>({id:String(index),content,status:index<stage?'completed':index===stage?'in_progress':'pending'}))});
    if(count===0){emit({reasoning_content:child?'**Sidekick reasoning**\n\nI will inspect the project before writing.':'**Driver reasoning**\n\nI will plan the change before handing it off.'});await pause();await pause();await say(child?'Sidekick begins the inspection.':'Driver explains the plan.');call('todo_write',todos(0));}
    else if(child){
      if(count===1)call('read_file',{path:'README.md'});
      else if(count===2)call('todo_write',todos(1));
      else if(count===3){await say(Array.from({length:18},(_,i)=>`Inspection line ${i+1}: the project note will describe the result.\n`).join(''));call('write_file',{path:'sidekick-note.txt',content:'Project inspection complete.\nThe note records the observed result.\nNo configuration changes are needed.\n'});}
      else if(count===4)call('todo_write',todos(3));
      else await say('Sidekick finished the project note.');
    }else if(count===1){await say('Driver hands the note to Sidekick.');call('sidekick',{description:'Update the project note',prompt:'TUI_FLOW_CHILD inspect the project and write its note.'});}
    else if(count===2){await say('Driver checks the Sidekick result.');call('bash',{command:'cat sidekick-note.txt'});}
    else if(count===3)call('todo_write',todos(2));
    else await say('Driver report: the project note is verified.\n\n## What changed\n\nThe **project note** now describes the result. See `sidekick-note.txt`.');
  }else if(prompt.includes('DELEGATE_CHILD')){
    if(data.messages.at(-1)?.role!=='tool'){
      const name=prompt.includes('FORCE_WRITE')?'write_file':prompt.includes('FORCE_NESTED')?'task':prompt.includes('FORCE_QUESTION')?'ask_user':'read_file';
      const args=name==='write_file'?{path:'child-forbidden.txt',content:'Child writes must never execute.'}:name==='task'?{description:'Forbidden nested research',prompt:'This nested task must never run.'}:name==='ask_user'?{question:'This child must not ask.',options:[{id:'no',label:'No'}]}:{path:'research.txt'};
      toolCall=true;emit({tool_calls:[{index:0,id:'delegated-read',type:'function',function:{name,arguments:JSON.stringify(args)}}]});
    }else{
      emit({content:'Researcher is reviewing the observed tool result.\n\n'});
      if(prompt.includes('HOLD_CHILD')){
        await new Promise<void>(resolve=>{const release=()=>{pendingDelegations.delete(release);res.off('close',release);resolve();};pendingDelegations.add(release);res.once('close',release);});
        if(res.destroyed)return;
      }
      emit({content:`Research result: ${data.messages.at(-1).content}\n\nThis researcher made no file changes.`});
    }
  }else if(prompt.includes('DELEGATE_BROWSER')){
    if(data.messages.at(-1)?.role==='tool')emit({content:`Delegation outcome: ${data.messages.at(-1).content}`});
    else if(prompt.includes('ADVERTISE_ONLY'))emit({content:data.tools?.some((tool:any)=>tool.function.name==='task')?'Research task is available.':'Research task is unavailable under this profile.'});
    else{toolCall=true;emit({tool_calls:[{index:0,id:'browser-research-task',type:'function',function:{name:'task',arguments:JSON.stringify({description:'Inspect fixture project',prompt:prompt.replace('DELEGATE_BROWSER','DELEGATE_CHILD')})}}]});}
  }else if(prompt.includes('WORKERS_CHILD')){
    const name=prompt.includes('alpha')?'alpha':'beta';
    if(data.messages.at(-1)?.role!=='tool'){
      emit({content:`${name} is inspecting its assignment.`});
      toolCall=true;emit({tool_calls:[{index:0,id:`${name}-read`,type:'function',function:{name:'read_file',arguments:JSON.stringify({path:'README.md'})}}]});
    }else{
      emit({content:`${name} progress: reviewed the project.`});
      await new Promise<void>(resolve=>{const release=()=>{pendingDelegations.delete(release);res.off('close',release);resolve();};pendingDelegations.add(release);res.once('close',release);});
      if(res.destroyed)return;
      emit({content:` ${name} final report: inspection complete.`});
    }
  }else if(prompt.includes('WORKERS_BROWSER')){
    if(data.messages.at(-1)?.role==='tool')emit({content:'Driver report: both assignments are complete.'});
    else{
      emit({content:'I’m assigning two independent reviews.'});
      toolCall=true;emit({tool_calls:['alpha','beta'].map((name,index)=>({index,id:`worker-${name}`,type:'function',function:{name:'delegate',arguments:JSON.stringify({description:`Review ${name}`,prompt:`WORKERS_CHILD ${name}`})}}))});
    }
  }else if(prompt.includes('LIVE_STEPS_BROWSER')){
    const count=data.messages.filter((message:any)=>message.role==='tool').length;
    if(count<5){
      if(!count)emit({content:'I’ll inspect the project files.'});
      toolCall=true;emit({tool_calls:Array.from({length:count?3:2},(_,index)=>({index,id:`live-read-${count+index}`,type:'function',function:{name:'read_file',arguments:JSON.stringify({path:(count+index)%2?'src/hello.ts':'README.md'})}}))});
    }else{
      await new Promise<void>(resolve=>{const release=()=>{pendingDelegations.delete(release);res.off('close',release);resolve();};pendingDelegations.add(release);res.once('close',release);});
      if(res.destroyed)return;
      emit({content:'The five file reads are complete.'});
    }
  }else if(prompt.includes('FUSION_CHILD')){
    if(data.messages.at(-1)?.role==='tool')emit({content:'Implementation complete. The driver must verify the root workspace.'});
    else{toolCall=true;emit({tool_calls:[{index:0,id:'fusion-write',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'answer.txt',content:'42\n'})}}]});}
  }else if(prompt.includes('FUSION_BROWSER')){
    if(!data.tools?.some((tool:any)=>tool.function.name==='delegate'))emit({content:'Planning only. Write-capable delegation is unavailable.'});
    else if(data.messages.at(-1)?.role!=='tool'){toolCall=true;emit({tool_calls:[{index:0,id:'fusion-delegate',type:'function',function:{name:'delegate',arguments:JSON.stringify({description:'Implement the answer file',prompt:prompt.replace('FUSION_BROWSER','FUSION_CHILD')})}}]});}
    else if(data.messages.slice(data.messages.findLastIndex((message:any)=>message.role==='user')).some((message:any)=>message.role==='assistant'&&message.tool_calls?.some((call:any)=>call.function.name==='verify')))emit({content:'The answer file is implemented and npm test passed in the root workspace.'});
    else{toolCall=true;emit({tool_calls:[{index:0,id:'fusion-verify',type:'function',function:{name:'verify',arguments:JSON.stringify({command:'npm test'})}}]});}
  }else if(prompt.includes('SIDEKICK_CHILD')){
    // The persistent sidekick: writes a per-turn marker file, then reports.
    const turn=data.messages.filter((m:any)=>m.role==='user').length;
    if(data.messages.at(-1)?.role==='tool')emit({content:`Sidekick report for turn ${turn}: ${data.messages.at(-1).content}`});
    else if(prompt.includes('FAILING_CHECK')){toolCall=true;emit({tool_calls:[{index:0,id:`sidekick-check-${turn}`,type:'function',function:{name:'bash',arguments:JSON.stringify({command:'npm test'})}}]});}
    else{toolCall=true;emit({tool_calls:[{index:0,id:`sidekick-write-${turn}`,type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'sidekick-note.txt',content:`sidekick turn ${turn}`})}}]});}
  }else if(prompt.includes('SIDEKICK_BROWSER')){
    if(data.messages.at(-1)?.role==='tool')emit({content:`Sidekick outcome: ${data.messages.at(-1).content}`});
    else if(prompt.includes('ADVERTISE_ONLY'))emit({content:data.tools?.some((tool:any)=>tool.function.name==='sidekick')?'Sidekick tool is available.':'Sidekick tool is unavailable in this session.'});
    else{toolCall=true;emit({tool_calls:[{index:0,id:'browser-sidekick-task',type:'function',function:{name:'sidekick',arguments:JSON.stringify({description:'Write the fixture note',prompt:prompt.replace('SIDEKICK_BROWSER','SIDEKICK_CHILD')})}}]});}
  }else if(prompt.includes('RECEIPTS_BROWSER')){
    // A real write with no check: the sealed turn must carry a receipts notice.
    if(data.messages.at(-1)?.role==='tool')emit({content:'The write is complete.'});
    else{toolCall=true;emit({tool_calls:[{index:0,id:'receipts-write',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'receipts-demo.txt',content:'Written for the receipts test.\n'})}}]});}
  }else if(prompt.includes('GOAL_BROWSER')){
    // Reports progress against the session goal, honoring a FORCE_* marker.
    if(data.messages.at(-1)?.role==='tool')emit({content:'Goal progress recorded.'});
    else{const status=prompt.includes('FORCE_COMPLETE')?'complete':prompt.includes('FORCE_BLOCKED')?'blocked':'continue';
      toolCall=true;emit({tool_calls:[{index:0,id:'goal-report',type:'function',function:{name:'update_goal',arguments:JSON.stringify({status,note:`Reporting ${status} from the browser fixture.`})}}]});}
  }else if(prompt.includes('SEARCH_BROWSER')){
    // Actual history_search calls: search then around, driven by markers so
    // tests can steer the query; the run then reports the actual tool results.
    if(data.messages.at(-1)?.role==='tool')emit({content:`Search outcome: ${data.messages.filter((m:any)=>m.role==='tool').map((m:any)=>m.content).join(' | ')}`});
    else{
      const query=/SEARCH_FOR\[(.+?)\]/.exec(prompt)?.[1];
      if(query){toolCall=true;emit({tool_calls:[{index:0,id:'browser-history-search',type:'function',function:{name:'history_search',arguments:JSON.stringify({operation:'search',query})}}]});}
      else emit({content:'No search was requested.'});
    }
  }else if(prompt.includes('MEMORY_BROWSER')){
    if(data.messages.at(-1)?.role==='tool')emit({content:`Memory outcome: ${data.messages.filter((m:any)=>m.role==='tool').map((m:any)=>m.content).join(' | ')}`});
    else if(prompt.includes('MEMORY_ADVERTISE'))emit({content:`Advertised tools: ${(data.tools||[]).map((tool:any)=>tool.function.name).join(', ')}`});
    else{
      const remember=/REMEMBER\[(.+?)\]/.exec(prompt)?.[1],recall=/RECALL\[(.+?)\]/.exec(prompt)?.[1];
      if(remember){toolCall=true;emit({tool_calls:[{index:0,id:'browser-memory-remember',type:'function',function:{name:'memory_remember',arguments:JSON.stringify({name:'browser-fact',description:'Recorded by the browser test',body:remember})}}]});}
      else if(recall){toolCall=true;emit({tool_calls:[{index:0,id:'browser-memory-recall',type:'function',function:{name:'memory_recall',arguments:JSON.stringify({query:recall})}}]});}
      else emit({content:'No memory operation was requested.'});
    }
  }else if(prompt.includes('RULES_BROWSER')){
    // Actual rule-governed calls: one bash command and one file write drawn from
    // the prompt so tests can steer subjects; the run then reports its results.
    if(data.messages.at(-1)?.role==='tool')emit({content:`Rules outcome: ${data.messages.filter((m:any)=>m.role==='tool').map((m:any)=>m.content).join(' | ')}`});
    else if(prompt.includes('RULES_ADVERTISE'))emit({content:`Advertised tools: ${(data.tools||[]).map((tool:any)=>tool.function.name).join(', ')}`});
    else{
      const command=/RUN_COMMAND\[(.+?)\]/.exec(prompt)?.[1];const target=/WRITE_PATH\[(.+?)\]/.exec(prompt)?.[1];
      const calls=[];if(command)calls.push({index:calls.length,id:'rules-bash',type:'function',function:{name:'bash',arguments:JSON.stringify({command})}});
      const readTarget=/READ_PATH\[(.+?)\]/.exec(prompt)?.[1];
      if(readTarget)calls.push({index:calls.length,id:'rules-read',type:'function',function:{name:'read_file',arguments:JSON.stringify({path:readTarget})}});
      if(target)calls.push({index:calls.length,id:'rules-write',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:target,content:'Rule-governed write.\n'})}});
      if(calls.length){toolCall=true;emit({tool_calls:calls});}else emit({content:'No rule-governed call was requested.'});
    }
  }else if(prompt.includes('MCP_BROWSER')&&data.messages.at(-1)?.role!=='tool'){
    const external=data.tools?.find((tool:any)=>tool.function?.name.startsWith('mcp_'));
    if(external){toolCall=true;emit({tool_calls:[{index:0,id:'browser-mcp-call',type:'function',function:{name:external.function.name,arguments:JSON.stringify({text:prompt})}}]});}
    else emit({content:'No connected MCP tool is available for this turn.'});
  }else if(prompt.includes('MCP_BROWSER')){
    emit({content:'MCP tool finished. Inspect its activity card for the recorded result.'});
  }else if(prompt.includes('PROFILE_BROWSER forbidden write')&&data.messages.at(-1)?.role!=='tool'){
    toolCall=true;emit({tool_calls:[{index:0,id:'profile-forbidden-write',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'profile-forbidden.txt',content:'This excluded tool must never execute.\n'})}}]});
  }else if(prompt.includes('ask fixture question')&&data.messages.at(-1)?.role!=='tool'){
    toolCall=true;emit({tool_calls:[{index:0,id:'fixture-question',type:'function',function:{name:'ask_user',arguments:JSON.stringify({question:'Which storage should this project use?',options:[{id:'sqlite',label:'SQLite',description:'A local database with no extra service.'},{id:'postgres',label:'PostgreSQL',description:'A separate database server.'}]})}}]});
  }else if(prompt.includes('ask fixture question')&&prompt.includes('then write')&&data.messages.at(-1)?.tool_call_id==='fixture-question'){
    toolCall=true;emit({tool_calls:[{index:0,id:'fixture-after-answer',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'answered.txt',content:'The answer did not grant tool permission.\n'})}}]});
  }else if(prompt.includes('TUI_MARKDOWN_STREAM')){
    // Streams prose with inline markdown two characters at a time so a test can
    // observe every intermediate frame, then calls one tool so the same run has
    // live activity rows and, once settled, a collapsed step summary.
    if(data.messages.at(-1)?.role==='tool'){emit({content:'Done. The **transcript** is stable.'});}
    else{
      emit({reasoning_content:'Planning the streamed transcript check.'});
      const text='Reviewing the **streaming transcript** for `conceal` markers and ~~stale~~ current layout.';
      for(const part of text.match(/.{1,2}|\n/g)||[]){if(res.destroyed)return;emit({content:part});await new Promise(r=>setTimeout(r,40));}
      toolCall=true;emit({tool_calls:[{index:0,id:'stream-read',type:'function',function:{name:'bash',arguments:JSON.stringify({command:'sleep 2'})}}]});
    }
  }else if(prompt==='TUI_QUEUE_HOLD'){
    emit({content:'Waiting for an interrupt.'});
    await new Promise<void>(resolve=>res.once('close',resolve));
    if(res.destroyed)return;
  }else if(prompt.includes('create fixture')&&data.messages.at(-1)?.role!=='tool'){
    toolCall=true;emit({tool_calls:[{index:0,id:'fixture-write',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'result.txt',content:`Created by the browser test.\n${prompt}\n`})}}]});
  }else{
    emit({reasoning_content:'Checking the request and preparing a clear response.'});
    const text=prompt.includes('ask fixture question')?'Your answer is saved. Continuing with your choice.':prompt.includes('create fixture')?'The file operation is complete. Check the activity card for its result.':prompt.includes('Summarize this coding session')?'The user asked for a fixture response. A small test workspace is available. Continue from here.':'Hello from Litespeed.\n\nYour workspace is ready. Here is a small example:\n\n```typescript\nconst answer = 42;\n```';
    for(const part of text.match(/.{1,12}|\n/g)||[]){if(res.destroyed)return;emit({content:part});await new Promise(r=>setTimeout(r,prompt.includes('slow response')?150:15));}
  }
  emit({},toolCall?'tool_calls':'stop');res.write(`data: ${JSON.stringify({choices:[],usage:{prompt_tokens:25,completion_tokens:35,...(/CACHE_(HIT|PARTIAL)_BROWSER/.test(prompt)?{prompt_tokens_details:{cached_tokens:20}}:{})}})}\n\n`);res.end('data: [DONE]\n\n');
});
await new Promise<void>(resolve=>mock.listen(0,'127.0.0.1',resolve));
const store=new Store(join(root,'state'));
store.saveSettings({workspace:root,providers:[{id:'fixture',name:'Test gateway',kind:'openai',baseUrl:`http://127.0.0.1:${(mock.address() as any).port}`,apiKey:'fixture-key'}],defaultProvider:'fixture',defaultModel:'test-model'});
new WorkspacePreferences(store).save(root,{providerId:'fixture',model:'test-model',setupComplete:process.env.LITESPEED_E2E_ONBOARDING !== '1'});
const mcp=new McpManager(()=>store.settings().mcpServers);
const{app,runner}=createApp({store,external:mcp});
app.get('/fixture/requests',(_req,res)=>res.json({count:providerRequests}));
app.get('/fixture/profiles',(_req,res)=>res.json({requests:profileRequests}));
app.get('/fixture/delegations',(_req,res)=>res.json({requests:delegationRequests,pending:pendingDelegations.size}));
app.post('/fixture/delegations/release',(_req,res)=>{for(const release of [...pendingDelegations])release();res.json({ok:true});});
app.get('/fixture/summaries',(_req,res)=>res.json({pending:pendingSummaries.size}));
app.post('/fixture/summaries/release',(_req,res)=>{for(const release of [...pendingSummaries])release();res.json({ok:true});});
const vite=process.env.LITESPEED_E2E_NO_VITE ? undefined : await createViteServer({server:{middlewareMode:true,hmr:{port:24679}},appType:'spa'});if(vite)app.use(vite.middlewares);
const fixturePort=Number(process.env.LITESPEED_E2E_PORT || 3211);
const server=app.listen(fixturePort,'127.0.0.1',()=>console.log(`Litespeed E2E ready at http://127.0.0.1:${(server.address() as {port:number}).port}`));
const terminals=attachTerminals(server,store);
let closing=false;
async function close(){if(closing)return;closing=true;runner.stopAll();await Promise.all([runner.whenIdle(),terminals.close(),mcp.close()]);server.closeAllConnections();server.close();mock.closeAllConnections();mock.close();await vite?.close();store.close();await rm(root,{recursive:true,force:true});process.exit(0);}
process.on('SIGINT',close);process.on('SIGTERM',close);
