import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import type { Session, SessionDetail } from '../../shared/types';

test('LiteLLM architecture persists one model and displays repository navigation in Plan',async({page,request},testInfo)=>{
  const workspace=await realpath(await mkdtemp(join(tmpdir(),'litespeed-litellm-browser-')));
  await mkdir(join(workspace,'litellm'));await writeFile(join(workspace,'litellm/__init__.py'),'');
  await writeFile(join(workspace,'litellm/example.py'),'def transform_request(value):\n    return value\n');
  let session:Session|undefined;
  try {
    const response=await request.post('/api/sessions',{data:{workspace,providerId:'fixture',model:'test-model',architecture:null,mode:'plan',permissionMode:'auto'}});
    expect(response.status()).toBe(201);session=await response.json();
    const detail=async():Promise<SessionDetail>=>(await request.get(`/api/sessions/${session!.id}`)).json();
    await page.goto(`/#session/${session!.id}`);
    await page.locator('.model-trigger').click();
    await page.getByRole('button',{name:'Architecture',exact:true}).click();
    await page.getByRole('option',{name:/^LiteLLM specific/}).click();
    await expect(page.getByRole('button',{name:'Model',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Worker model',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Sidekick model',exact:true})).toHaveCount(0);
    await expect(page.getByLabel('Workers at once',{exact:true})).toHaveCount(0);
    await page.screenshot({path:testInfo.outputPath('architecture.png')});
    await page.getByRole('button',{name:'Done',exact:true}).click();await page.reload();
    expect((await detail()).session).toMatchObject({architecture:{kind:'litellm-specific'},providerId:'fixture',model:'test-model'});
    await page.getByRole('combobox',{name:'Agent mode',exact:true}).selectOption('build');
    await expect(page.locator('.model-trigger')).toContainText('LiteLLM');
    await expect(page.locator('.model-trigger')).not.toContainText('specialists');
    await page.getByRole('combobox',{name:'Agent mode',exact:true}).selectOption('plan');
    await expect(page.locator('.model-trigger')).toContainText('LiteLLM');
    await page.getByRole('textbox',{name:'Message Litespeed',exact:true}).fill('LITELLM_BROWSER inspect the transformation.');
    await page.getByRole('button',{name:'Send message',exact:true}).click();
    await expect(page.getByRole('article',{name:'Assistant message'}).last()).toContainText('Planning complete.');
    await expect(page.getByRole('button',{name:'Stop generation',exact:true})).toHaveCount(0);
    const completed=await detail();
    expect(completed.delegations??[]).toHaveLength(0);
    const calls=completed.messages.flatMap(message=>message.toolCalls??[]);
    expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject({name:'litellm_context',status:'completed'});
    expect(calls[0].output).toContain('def transform_request');
    await page.locator('.work-log > summary').first().click();
    await expect(page.getByText('Navigate LiteLLM',{exact:true})).toBeVisible();
    await page.screenshot({path:testInfo.outputPath('navigation.png')});
  }finally {
    if(session){await request.post(`/api/sessions/${session.id}/cancel`);await request.delete(`/api/sessions/${session.id}`);}
    await rm(workspace,{recursive:true,force:true});
  }
});
