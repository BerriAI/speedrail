import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type Server } from 'node:http';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';

describe('LiteLLM-specific runner integration',()=>{
  let root:string,store:Store,server:Server,runner:ReturnType<typeof createApp>['runner'];
  let requests:any[],action:{name:string;args:Record<string,unknown>}|undefined,actions:{name:string;args:Record<string,unknown>}[];
  beforeEach(async()=>{
    root=await mkdtemp(join(tmpdir(),'litellm-runner-'));await mkdir(join(root,'litellm'));await writeFile(join(root,'litellm/__init__.py'),'');
    await writeFile(join(root,'litellm/example.py'),Array.from({length:500},(_,i)=>`value_${i} = ${i}`).join('\n'));
    requests=[];action=undefined;actions=[];
    server=createServer(async(req,res)=>{
      const chunks:Buffer[]=[];for await(const c of req)chunks.push(c);
      const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);
      const call=actions.shift()??action;action=undefined;
      const delta=call?{tool_calls:[{index:0,id:'call_one',type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}]}:{content:'Finished.'};
      res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{delta,finish_reason:call?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);
    });
    const baseUrl=await new Promise<string>(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${(server.address() as {port:number}).port}`)));
    store=new Store(join(root,'state'));store.saveSettings({workspace:root,providers:[{id:'test',name:'Test',kind:'openai',baseUrl}],defaultProvider:'test',defaultModel:'model',memoryEnabled:false,maxSteps:5});
    runner=createApp({store}).runner;
  });
  afterEach(async()=>{runner.stopAll();await runner.whenIdle();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();await rm(root,{recursive:true,force:true});});
  it('uses the real single-agent loop, exposes navigation in Plan and bounds unspecified reads',async()=>{
    const session=store.createSession({workspace:root,providerId:'test',model:'model',permissionMode:'auto',mode:'plan',architecture:{kind:'litellm-specific'}});
    action={name:'read_file',args:{path:'litellm/example.py'}};runner.start(session.id,'Inspect the code.');await runner.whenIdle();
    const names=requests[0].tools.map((t:any)=>t.function.name);
    expect(names).toContain('litellm_context');expect(names).not.toContain('delegate');expect(names).not.toContain('sidekick');expect(names).not.toContain('bash');
    expect(requests[0].messages[0].content).toContain('LiteLLM-specific harness');
    const output=store.messages(session.id).find(m=>m.role==='tool')!.content;
    expect(output).toContain('value_159');expect(output).not.toContain('value_160');
  });
  it('executes navigation through recorded tools and keeps it out of Single model',async()=>{
    const session=store.createSession({workspace:root,providerId:'test',model:'model',permissionMode:'auto',architecture:{kind:'litellm-specific'}});
    action={name:'litellm_context',args:{query:'example'}};runner.start(session.id,'Find example code.');await runner.whenIdle();
    expect(store.messages(session.id).find(m=>m.role==='tool')?.content).toContain('litellm/example.py');
    requests=[];const plain=store.createSession({workspace:root,providerId:'test',model:'model',permissionMode:'auto'});runner.start(plain.id,'Explain.');await runner.whenIdle();
    expect(requests[0].tools.map((t:any)=>t.function.name)).not.toContain('litellm_context');
    expect(store.messages(plain.id).some(m=>m.content.startsWith('LiteLLM starting locations'))).toBe(false);
  });
  it.each(['build','plan'] as const)('supplies current source locations before the first %s request without recording edits',async(mode)=>{
    const session=store.createSession({workspace:root,providerId:'test',model:'model',permissionMode:'auto',mode,architecture:{kind:'litellm-specific'}});
    runner.start(session.id,'Explain example code.');await runner.whenIdle();
    const notes=store.messages(session.id).filter(m=>m.content.startsWith('LiteLLM starting locations'));
    expect(notes).toHaveLength(1);expect(notes[0].content).toContain('litellm/example.py');
    expect(notes[0].content).toContain('untrusted source data');
    expect(JSON.stringify(requests[0].messages)).toContain('LiteLLM starting locations');
    expect(store.messages(session.id).flatMap(m=>m.toolCalls??[])).toEqual([]);
  });
  it('leaves automatic navigation off when a generic tool hook needs interception',async()=>{
    store.saveSettings({hooks:[{event:'PreToolUse',command:'exit 2'}]});
    const session=store.createSession({workspace:root,providerId:'test',model:'model',permissionMode:'auto',architecture:{kind:'litellm-specific'}});
    runner.start(session.id,'Explain example code.');await runner.whenIdle();
    expect(store.messages(session.id).some(m=>m.content.startsWith('LiteLLM starting locations'))).toBe(false);
    expect(requests[0].tools.map((t:any)=>t.function.name)).toContain('litellm_context');
  });
  it('does not bypass a scoped read restriction through navigation',async()=>{
    store.saveSettings({permissionRules:{version:1,rules:[{tool:'read_file',decision:'deny',patterns:['litellm/example.py']}]}});
    const session=store.createSession({workspace:root,providerId:'test',model:'model',permissionMode:'auto',architecture:{kind:'litellm-specific'}});
    action={name:'litellm_context',args:{path:'litellm/example.py'}};runner.start(session.id,'Inspect.');await runner.whenIdle();
    expect(requests[0].tools.map((t:any)=>t.function.name)).not.toContain('litellm_context');
    const messages=store.messages(session.id);expect(messages.find(m=>m.role==='tool')?.content).not.toContain('value_0');
    expect(messages.some(m=>m.content.startsWith('LiteLLM starting locations'))).toBe(false);
    expect(messages.flatMap(m=>m.toolCalls??[])[0].status).toBe('denied');
  });
  it.each(['hook','sidecar'])('preserves %s interception by falling back to ordinary reads',async(kind)=>{
    store.saveSettings(kind==='hook'?{hooks:[{event:'PreToolUse',matcher:'read_file',command:'exit 2'}]}:{sidecars:[{name:'reader',events:['tool_call'],command:'exit 0'}]});
    const session=store.createSession({workspace:root,providerId:'test',model:'model',permissionMode:'auto',architecture:{kind:'litellm-specific'}});
    action={name:'litellm_context',args:{path:'litellm/example.py'}};runner.start(session.id,'Inspect.');await runner.whenIdle();
    expect(requests[0].tools.map((t:any)=>t.function.name)).not.toContain('litellm_context');
    expect(store.messages(session.id).find(m=>m.role==='tool')?.content).not.toContain('value_0');
    expect(store.messages(session.id).some(m=>m.content.startsWith('LiteLLM starting locations'))).toBe(false);
  });
  it('reviews a changed Build turn once and does not loop when the model finishes',async()=>{
    const session=store.createSession({workspace:root,providerId:'test',model:'model',permissionMode:'auto',architecture:{kind:'litellm-specific'}});
    action={name:'write_file',args:{path:'litellm/new.py',content:'value = 1\n'}};
    runner.start(session.id,'Add a constant. Do not run tests.');await runner.whenIdle();
    const reviews=store.messages(session.id).filter(m=>m.role==='system'&&m.content.startsWith('LiteLLM change review.'));
    expect(reviews).toHaveLength(1);expect(reviews[0].content).toContain('litellm/new.py');
    expect(reviews[0].content).toContain("Follow the user's scope and verification constraints");
    expect(requests).toHaveLength(3);expect(store.session(session.id).status).toBe('idle');
  });
  it('reminds the model once after repeated check commands without blocking them',async()=>{
    await writeFile(join(root,'package.json'),JSON.stringify({scripts:{test:'node -e "process.exit(0)"'}}));
    const session=store.createSession({workspace:root,providerId:'test',model:'model',permissionMode:'auto',architecture:{kind:'litellm-specific'}});
    actions=Array.from({length:4},(_,i)=>({name:'bash',args:{command:`npm test -- --no-warnings=${i}`,timeout_ms:5000}}));
    runner.start(session.id,'Run the requested checks.');await runner.whenIdle();
    const messages=store.messages(session.id);
    expect(messages.filter(m=>m.role==='system'&&m.content.startsWith('LiteLLM verification checkpoint:'))).toHaveLength(1);
    expect(messages.flatMap(m=>m.toolCalls??[]).filter(c=>c.status==='completed')).toHaveLength(4);
    expect(requests).toHaveLength(5);
  });
  it('nudges prolonged exploration once without authorizing an edit',async()=>{
    const session=store.createSession({workspace:root,providerId:'test',model:'model',permissionMode:'auto',architecture:{kind:'litellm-specific'}});
    actions=Array.from({length:13},(_,i)=>({name:'read_file',args:{path:'litellm/example.py',offset:i+1,limit:1}}));
    runner.start(session.id,'Explain the file without changing it.');await runner.whenIdle();
    const notices=store.messages(session.id).filter(m=>m.role==='system'&&m.content.startsWith('LiteLLM exploration checkpoint:'));
    expect(notices).toHaveLength(1);expect(notices[0].content).toContain('this notice does not authorize edits');
    expect(requests).toHaveLength(14);
  });
});
