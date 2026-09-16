import { closeSync, existsSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export interface Charge { id:string; label:string; reservedUsd:number; chargedUsd?:number; costKnown?:boolean; pricingSource?:'tokens'|'header'|'tokens-and-header'; responseCostUsd?:number; httpStatus?:number; status:'pending'|'settled'; usage?:unknown; seconds?:number; }
export class CampaignBudget {
  readonly records:Charge[];
  constructor(readonly file:string, readonly limitUsd:number) {
    if(!Number.isFinite(limitUsd)||limitUsd<=0)throw new Error('A positive dollar ceiling is required.');
    const saved=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):undefined;
    if(saved&&saved.limitUsd!==limitUsd)throw new Error('Cannot silently change an existing campaign ceiling.');
    this.records=saved?.records??[];
  }
  get committedUsd(){return this.records.reduce((sum,r)=>sum+(r.chargedUsd??r.reservedUsd),0);}
  reserve(label:string,ceilingUsd:number){
    if(!Number.isFinite(ceilingUsd)||ceilingUsd<=0)throw new Error('A finite positive request reservation is required.');
    if(this.committedUsd+ceilingUsd>this.limitUsd)throw new Error('Campaign spending ceiling reached. No request sent.');
    const record:Charge={id:randomUUID(),label,reservedUsd:ceilingUsd,status:'pending'};
    this.records.push(record);this.save();return record.id;
  }
  settle(id:string,charge:number|undefined,details:Pick<Charge,'usage'|'seconds'|'pricingSource'|'responseCostUsd'|'httpStatus'>={}){
    const record=this.records.find(r=>r.id===id);
    if(!record||record.status!=='pending')throw new Error('Unknown or already settled reservation.');
    if(charge!==undefined&&(!Number.isFinite(charge)||charge<0))throw new Error('Invalid charge.');
    Object.assign(record,details,{chargedUsd:charge??record.reservedUsd,costKnown:charge!==undefined,status:'settled'});this.save();
  }
  private save(){const tmp=this.file+'.tmp';writeFileSync(tmp,JSON.stringify({limitUsd:this.limitUsd,committedUsd:this.committedUsd,records:this.records},null,2),{mode:0o600});renameSync(tmp,this.file);}
}

export function lockCampaign(directory:string):()=>void {
  const file=directory+'/gateway.lock';
  let descriptor:number;
  try{descriptor=openSync(file,'wx',0o600);}catch{throw new Error('This campaign is locked. Stop its existing gateway first. After a crash, verify that process is gone before removing gateway.lock.');}
  writeFileSync(descriptor,JSON.stringify({pid:process.pid,started:new Date().toISOString()}));closeSync(descriptor);
  let released=false;
  return ()=>{if(!released){unlinkSync(file);released=true;}};
}

export const FLASH_MODEL='fireworks_ai/deepseek-v4p1-flash';
export const FLASH_PRICES={input:0.22/1e6,cachedInput:0.007/1e6,output:0.66/1e6};
export function usageCost(usage:unknown):number|undefined {
  const u=usage as {prompt_tokens?:number;completion_tokens?:number;prompt_tokens_details?:{cached_tokens?:number}}|undefined;
  if(!u||![u.prompt_tokens,u.completion_tokens].every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0))return;
  if(u.prompt_tokens_details?.cached_tokens!==undefined&&(typeof u.prompt_tokens_details.cached_tokens!=='number'||!Number.isFinite(u.prompt_tokens_details.cached_tokens)))return;
  const cached=Math.max(0,Math.min(u.prompt_tokens!,u.prompt_tokens_details?.cached_tokens??0));
  return (u.prompt_tokens!-cached)*FLASH_PRICES.input+cached*FLASH_PRICES.cachedInput+u.completion_tokens!*FLASH_PRICES.output;
}

/** An explicit gateway charge is useful even if a stream omits token usage.
 * A missing/empty header is unknown; Number(null) must never turn it into zero.
 */
export function responseCharge(usage:unknown,header:string|null):{costUsd?:number;responseCostUsd?:number;pricingSource?:Charge['pricingSource']} {
  const calculated=usageCost(usage),parsed=header?.trim()?Number(header):undefined;
  const reported=parsed!==undefined&&Number.isFinite(parsed)&&parsed>=0?parsed:undefined;
  if(calculated===undefined&&reported===undefined)return {};
  return {costUsd:Math.max(calculated??0,reported??0),responseCostUsd:reported,pricingSource:calculated===undefined?'header':reported===undefined?'tokens':'tokens-and-header'};
}
