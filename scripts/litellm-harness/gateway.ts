import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { CampaignBudget, FLASH_MODEL, FLASH_PRICES, responseCharge, lockCampaign } from './budget.js';

const directory=resolve(process.env.LITELLM_CAMPAIGN_DIR??'');
if(!process.env.LITELLM_CAMPAIGN_DIR||!process.env.LITELLM_CAMPAIGN_KEY_FILE)throw new Error('Set LITELLM_CAMPAIGN_DIR and LITELLM_CAMPAIGN_KEY_FILE outside the repository.');
mkdirSync(join(directory,'requests'),{recursive:true,mode:0o700});
const key=readFileSync(process.env.LITELLM_CAMPAIGN_KEY_FILE,'utf8').trim();
if(!key)throw new Error('The gateway key file is empty.');
if(!process.env.LITELLM_CAMPAIGN_BASE_URL)throw new Error('Set LITELLM_CAMPAIGN_BASE_URL to the authorized gateway.');
const upstreamBase=new URL(process.env.LITELLM_CAMPAIGN_BASE_URL);
if(upstreamBase.protocol!=='https:')throw new Error('Use an HTTPS upstream gateway.');
const upstreamUrl=new URL(upstreamBase);
const basePath=upstreamUrl.pathname.replace(/\/+$/,'');
upstreamUrl.pathname=basePath+(basePath.endsWith('/v1')?'':'/v1')+'/chat/completions';
const unlock=lockCampaign(directory);process.once('exit',unlock);
const budget=new CampaignBudget(join(directory,'spend.json'),Number(process.env.LITELLM_CAMPAIGN_LIMIT_USD??100));
const token=randomBytes(24).toString('hex');
const maxOutput=32768;
const reservation=1048576*FLASH_PRICES.input+maxOutput*FLASH_PRICES.output;
const server=createServer(async(req,res)=>{
  if(req.headers.authorization!==`Bearer ${token}`){res.writeHead(401).end();return;}
  if(req.method==='GET'&&req.url==='/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({committedUsd:budget.committedUsd,requests:budget.records.length,limitUsd:budget.limitUsd}));return;}
  if(req.method==='GET'&&['/models','/v1/models','/model/info'].includes(req.url??'')){
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:FLASH_MODEL,model_name:FLASH_MODEL,model_info:{max_input_tokens:1048576,max_output_tokens:maxOutput,input_cost_per_token:FLASH_PRICES.input,output_cost_per_token:FLASH_PRICES.output,cache_read_input_token_cost:FLASH_PRICES.cachedInput,supports_function_calling:true,supports_reasoning:true}}]}));return;
  }
  if(req.method!=='POST'||!['/chat/completions','/v1/chat/completions'].includes(req.url??'')){res.writeHead(404).end();return;}
  let requestId:string|undefined;
  const started=Date.now();
  try {
    const chunks:Buffer[]=[];let bytes=0;
    for await(const chunk of req){bytes+=chunk.length;if(bytes>16*1024*1024)throw new Error('Request exceeds campaign body limit.');chunks.push(chunk);}
    const body=JSON.parse(Buffer.concat(chunks).toString());
    if(body.model!==FLASH_MODEL)throw new Error('This campaign permits only the explicitly authorized model.');
    if(body.n!==undefined&&body.n!==1)throw new Error('Multiple completions are not permitted.');
    const requestedOutput=body.max_tokens??body.max_completion_tokens??maxOutput;
    if(!Number.isSafeInteger(requestedOutput)||requestedOutput<=0)throw new Error('Output token limit must be a positive integer.');
    body.max_tokens=Math.min(requestedOutput,maxOutput);delete body.max_completion_tokens;
    if(body.stream)body.stream_options={include_usage:true};
    const workspaceLabel=JSON.stringify(body.messages).match(/\/runs\/([a-z0-9-]+)\/workspace/)?.[1];
    const label=String(req.headers['x-campaign-label']??workspaceLabel??body.user??'unlabeled').slice(0,150);
    requestId=budget.reserve(label,reservation);
    writeFileSync(join(directory,'requests',requestId+'.request.json'),JSON.stringify(body),{mode:0o600});
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),600_000);
    // Drain an admitted request after the client cancels so its final usage can
    // settle the reservation. Output remains capped and the upstream timer still
    // applies. Aborting here previously left many $0.2523 reservations unpriced.
    let upstream:Response;
    try {upstream=await fetch(upstreamUrl,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});}
    catch(error){clearTimeout(timer);throw error;}
    if(!res.destroyed)res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')??'application/json'});
    const raw:Buffer[]=[];
    try {if(upstream.body){const reader=upstream.body.getReader();try{while(true){const {value,done}=await reader.read();if(done)break;const data=Buffer.from(value);raw.push(data);if(!res.destroyed)res.write(data);}}finally{reader.releaseLock();}}}
    finally {clearTimeout(timer);}
    const text=Buffer.concat(raw).toString();writeFileSync(join(directory,'requests',requestId+'.response.txt'),text,{mode:0o600});
    let usage:unknown;
    if(body.stream){for(const line of text.split('\n'))if(line.startsWith('data: ')){try{const part=JSON.parse(line.slice(6));if(part.usage)usage=part.usage;}catch{}}}
    else {try{usage=JSON.parse(text).usage;}catch{}}
    const {costUsd:charge,...pricing}=responseCharge(usage,upstream.headers.get('x-litellm-response-cost'));
    budget.settle(requestId,charge,{usage,...pricing,httpStatus:upstream.status,seconds:(Date.now()-started)/1000});requestId=undefined;
    appendFileSync(join(directory,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),label,status:upstream.status,chargeUsd:charge,committedUsd:budget.committedUsd})+'\n',{mode:0o600});
    if(!res.destroyed)res.end();
  }catch(error){
    if(requestId)budget.settle(requestId,undefined,{seconds:(Date.now()-started)/1000});
    const message=(error instanceof Error?error.message:'Campaign request failed').split(key).join('[redacted]');
    if(!res.destroyed){if(!res.headersSent)res.writeHead(429,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message}}));}
  }
});
server.listen(0,'127.0.0.1',()=>{
  const port=(server.address() as {port:number}).port;
  writeFileSync(join(directory,'connection.json'),JSON.stringify({baseUrl:`http://127.0.0.1:${port}`,apiKey:token}),{mode:0o600});
  console.log(JSON.stringify({ready:true,port,limitUsd:budget.limitUsd,committedUsd:budget.committedUsd}));
});
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),10_000).unref();});
