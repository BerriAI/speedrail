/** Local-only acceptance of the LiteLLM picker and navigator in a real PTY. */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import pty from 'node-pty';
import xterm from '@xterm/headless';

const root=resolve(import.meta.dirname,'..');
const config=await realpath(await mkdtemp(join(tmpdir(),'litellm-pty-')));
const workspace=join(config,'workspace');
await mkdir(join(workspace,'litellm'),{recursive:true});
await writeFile(join(workspace,'litellm/__init__.py'),'');
await writeFile(join(workspace,'litellm/example.py'),'def transform_request(value):\n    return value\n');
const artifacts=join(root,'test-results-tui','litellm');await mkdir(artifacts,{recursive:true});
const server=spawn(process.execPath,['--import','tsx','scripts/e2e-server.ts'],{cwd:root,env:{...process.env,LITESPEED_E2E_PORT:'0',LITESPEED_E2E_NO_VITE:'1'},stdio:['ignore','pipe','pipe']});
let log='',terminal,emulator,base,session;
server.stdout.on('data',data=>log+=data);server.stderr.on('data',data=>log+=data);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const screen=()=>emulator?Array.from({length:emulator.rows},(_,row)=>emulator.buffer.active.getLine(emulator.buffer.active.viewportY+row)?.translateToString(true,0,emulator.cols)??'').join('\n'):'';
async function waitFor(check,label){const end=Date.now()+20000;while(Date.now()<end){if(await check())return;await delay(50);}throw new Error(`${label}\n${screen()}\n${log.slice(-1000)}`);}
async function api(path,body){const response=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});const data=await response.json();assert(response.ok,JSON.stringify(data));return data;}
function click(marker){const lines=screen().split('\n'),row=lines.findIndex(line=>line.includes(marker));assert(row>=0,screen());const column=lines[row].indexOf(marker)+2;terminal.write(`\x1b[<0;${column};${row+1}M\x1b[<0;${column};${row+1}m`);}
try{
  await waitFor(()=>/Litespeed E2E ready at (http:\/\/[^\s]+)/.test(log),'fixture ready');base=log.match(/Litespeed E2E ready at (http:\/\/[^\s]+)/)[1];
  session=await api('/sessions',{workspace,providerId:'fixture',model:'test-model',permissionMode:'auto',mode:'plan'});
  emulator=new xterm.Terminal({cols:100,rows:34,allowProposedApi:true});
  terminal=pty.spawn(process.execPath,['bin/litespeed.mjs','tui','--url',base,'--session',session.id],{cwd:root,name:'xterm-256color',cols:100,rows:34,env:{...process.env,TERM:'xterm-256color',LITESPEED_DISABLE_PROJECT_CONFIG:'1',LITESPEED_CONFIG_DIR:config,XDG_CONFIG_HOME:config,XDG_STATE_HOME:config}});
  terminal.onData(data=>emulator.write(data));
  await waitFor(()=>screen().includes('Commands [Ctrl+P]')&&screen().includes('Ask Litespeed'),'composer ready');
  terminal.write('/models\r');await waitFor(()=>screen().includes('Architecture: Single model'),'model settings');
  click('Architecture: Single model');await waitFor(()=>screen().includes('LiteLLM specific'),'architecture choices');
  click('LiteLLM specific');await waitFor(()=>screen().includes('Architecture: LiteLLM specific'),'architecture selected');
  assert(!screen().includes('Sidekick:')&&!screen().includes('Worker:')&&!screen().includes('Workers at once'));
  await writeFile(join(artifacts,'picker.txt'),screen());
  click('Save');await waitFor(()=>!screen().includes('Architecture:')&&screen().includes('test-model · LiteLLM'),'saved Plan label');
  const configured=await api(`/sessions/${session.id}`);
  assert.deepEqual(configured.session.architecture,{kind:'litellm-specific'});assert.equal(configured.session.model,'test-model');
  terminal.write('LITELLM_BROWSER inspect the transformation.\r');
  await waitFor(()=>screen().includes('Planning complete.'),'navigation completes');
  const completed=await api(`/sessions/${session.id}`);
  assert.equal(completed.session.status,'idle');assert.equal(completed.delegations?.length??0,0);
  const calls=completed.messages.flatMap(message=>message.toolCalls??[]);
  assert.equal(calls.length,1);assert.equal(calls[0].name,'litellm_context');assert.equal(calls[0].status,'completed');assert(calls[0].output.includes('def transform_request'));
  terminal.resize(80,24);emulator.resize(80,24);await delay(200);
  assert(screen().includes('· LiteLLM'));assert(!/^\s*Driver\s*$/m.test(screen()));await writeFile(join(artifacts,'narrow.txt'),screen());
  console.log('LiteLLM PTY passed: picker, one saved model, Plan navigation, no workers, and narrow header.');
}finally{
  if(session&&base)await api(`/sessions/${session.id}/cancel`,{}).catch(()=>{});
  terminal?.kill();emulator?.dispose();server.kill('SIGTERM');await rm(config,{recursive:true,force:true});
}
