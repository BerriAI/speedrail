import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CampaignBudget, usageCost, responseCharge, lockCampaign } from '../scripts/litellm-harness/budget.js';

describe('paid harness campaign admission',()=>{
  it('allows only one gateway process to own a campaign ledger',()=>{
    const root=mkdtempSync(join(tmpdir(),'campaign-lock-'));
    try{const release=lockCampaign(root);expect(()=>lockCampaign(root)).toThrow('locked');release();release();lockCampaign(root)();}
    finally{rmSync(root,{recursive:true,force:true});}
  });
  it('reserves before dispatch, retains unknown charges after restart and refuses overspend',()=>{
    const root=mkdtempSync(join(tmpdir(),'campaign-budget-'));
    try{
      const path=join(root,'spend.json');const budget=new CampaignBudget(path,1);
      const id=budget.reserve('first',0.6);expect(()=>budget.reserve('parallel',0.6)).toThrow('ceiling');
      expect(new CampaignBudget(path,1).committedUsd).toBe(0.6);
      budget.settle(id,0.1);const failed=budget.reserve('ambiguous',0.8);budget.settle(failed,undefined);
      expect(budget.committedUsd).toBeCloseTo(0.9);expect(()=>budget.reserve('over',0.2)).toThrow('ceiling');
      expect(()=>new CampaignBudget(path,100)).toThrow('silently');
      expect(()=>budget.settle(id,0)).toThrow('already settled');
    }finally{rmSync(root,{recursive:true,force:true});}
  });
  it('prices uncached, cached and generated tokens independently and does not invent missing usage',()=>{
    expect(usageCost({prompt_tokens:1e6,completion_tokens:1e6,prompt_tokens_details:{cached_tokens:500000}})).toBeCloseTo(0.7735);
    expect(usageCost(undefined)).toBeUndefined();expect(usageCost({prompt_tokens:10})).toBeUndefined();
    expect(usageCost({prompt_tokens:-1,completion_tokens:0})).toBeUndefined();
    expect(usageCost({prompt_tokens:10,completion_tokens:1,prompt_tokens_details:{cached_tokens:NaN}})).toBeUndefined();
  });
  it('accepts an explicit zero-cost header but retains uncertainty when the header is absent or invalid',()=>{
    expect(responseCharge(undefined,null)).toEqual({});
    for(const header of ['', ' ', '-1', 'NaN', 'Infinity'])expect(responseCharge(undefined,header)).toEqual({});
    expect(responseCharge(undefined,'0')).toMatchObject({costUsd:0,pricingSource:'header'});
    expect(responseCharge(undefined,'0.017')).toMatchObject({costUsd:0.017,pricingSource:'header'});
    expect(responseCharge({prompt_tokens:1e6,completion_tokens:0},'0.10')).toMatchObject({costUsd:0.22,pricingSource:'tokens-and-header'});
    expect(responseCharge({prompt_tokens:1e6,completion_tokens:0},'0.30')).toMatchObject({costUsd:0.30,pricingSource:'tokens-and-header'});
  });
});
