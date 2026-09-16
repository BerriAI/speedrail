/** @jsxImportSource @opentui/react */
import { LiteFusionSettings } from './litefusion.js';
import { architectureConfiguration, architectureKey, liteFusionConfiguration, rememberArchitecture, specialistGateway, withLiteFusionLead, type ArchitectureConfigurations } from '../shared/architecture-config.js';
import { bindExactModels, type LiteFusionSelection } from '../shared/litefusion.js';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Model, ModelReasoning, Session, Settings } from '../shared/types.js';
import { SHUNT_DESCRIPTION, SHUNT_BENEFIT, SHUNT_MODEL_HINT, shuntCanEnable, shuntConfigured, shuntToggle, type ShuntSelection } from '../shared/shunt.js';
import { REASONING_EFFORTS } from '../shared/types.js';
import { ARCHITECTURES, architectureWorker, selectArchitecture, type ArchitectureKind, type ModelRoute } from '../shared/architectures.js';
import { SETUP_ARCHITECTURES, modelGuidance } from '../shared/setup.js';
import { TerminalController } from './controller.js';
import { Menu, TextPrompt, type MenuItem } from './ui.js';

export function ModelChooser({ controller, settings, value, title, onChange, onClose, simple = false, feedback, guidance, onChangeGateway }: { simple?: boolean; feedback?: string; guidance?: string; onChangeGateway?: () => void; controller: TerminalController; settings: Settings; value: ModelRoute; title: string; onChange: (route: ModelRoute) => void; onClose: () => void }) {
  const [provider, setProvider] = useState(settings.providers.some(provider => provider.id === value.providerId) ? value.providerId : settings.providers[0]?.id || ''), [models, setModels] = useState<Model[]>([]);
  const [view, setView] = useState<'models' | 'providers' | 'custom'>('models'), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true; setLoading(true); setError(''); setModels([]);
    controller.client.api<{ models: Model[]; error?: string }>(`/models?providerId=${encodeURIComponent(provider)}`).then(result => { if (live) { setModels(result.models); setError(result.error || ''); } }).catch(error => { if (live) setError(String(error.message ?? error)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [provider, controller]);
  if (view === 'providers') return <Menu title="Provider" onClose={() => setView('models')} items={settings.providers.map(item => ({ id: item.id, label: item.name, description: item.kind, action: () => { setProvider(item.id); setView('models'); } }))} />;
  if (view === 'custom') return <TextPrompt title="Model ID" placeholder="provider/model-name" onClose={() => setView('models')} onSave={model => { if (model.trim()) onChange({ providerId: provider, model: model.trim() }); }} />;
  const configured = settings.providers.find(item => item.id === provider);
  const all = [...models, ...(configured?.models ?? []).filter(id => !models.some(model => model.id === id)).map(id => ({ id, name: id, providerId: provider }))];
  return <Menu key={`${provider}:${title}`} title={title} onClose={onClose} header={guidance} footer={simple ? feedback || error || (loading ? 'Loading your models…' : 'Type to search · Enter choose · Esc back') : feedback} items={[
    ...(!simple ? [{ id: 'provider', label: `Provider: ${configured?.name ?? provider}`, description: 'Change provider', action: () => setView('providers') },
    { id: 'custom', label: 'Enter a model ID…', description: error || (loading ? 'Loading models…' : undefined), action: () => setView('custom') }] : []),
    ...all.map(model => ({ id: `model:${model.id}`, label: `${model.id === value.model && provider === value.providerId ? '✓ ' : ''}${model.name || model.id}`, description: model.name && model.name !== model.id ? model.id : undefined, action: () => onChange({ providerId: provider, model: model.id }) })),
    ...(simple && !loading && !all.length ? [{id:'retry',label:'Change gateway',action:onChangeGateway ?? onClose}] : []),
  ]} />;
}

/** Edits a complete selection locally, then validates and saves once with the
 * revision captured when this screen opened. Other clients cannot be overwritten. */
export function ModelSettings({ controller, initial, settings, onClose, onProviders }: { controller: TerminalController; initial: Session; settings: Settings; onClose: () => void; onProviders: () => void }) {
  const state=useSyncExternalStore(controller.subscribe,controller.getState);
  const [draft,setDraft]=useState(()=>initial.pendingArchitecture?.configuration??architectureConfiguration(initial));
  const [saved,setSaved]=useState<ArchitectureConfigurations>(initial.architectureConfigurations??{});
  const [kind,setKind]=useState(architectureKey(draft)),[view,setView]=useState('main'),[loading,setLoading]=useState(false);
  const [catalog,setCatalog]=useState<Model[]>([]),[styles,setStyles]=useState(['concise','explanatory','learning']);
  const worker=draft.architecture?architectureWorker(draft.architecture):null,back=()=>setView('main');
  const route=view.includes('shunt')?draft.shunt?.model:view.includes('worker')?worker:view.includes('planner')?draft.planner:draft;
  useEffect(()=>{let live=true;controller.client.api<{styles:string[]}>(`/styles?workspace=${encodeURIComponent(initial.workspace)}`).then(result=>{if(live)setStyles(current=>[...new Set([...current,...result.styles])]);}).catch(()=>{});return()=>{live=false;};},[]);
  useEffect(()=>{if(!view.startsWith('reasoning:')||!route)return;let live=true;setCatalog([]);controller.client.api<{models:Model[]}>(`/models?providerId=${encodeURIComponent(route.providerId)}`).then(result=>{if(live)setCatalog(result.models);}).catch(()=>{});return()=>{live=false;};},[view,route?.providerId]);
  const fusion=draft.architecture?.kind==='litefusion'?draft.architecture:undefined;
  const updateFusion=(value:LiteFusionSelection)=>setDraft(liteFusionConfiguration(value,draft));
  const workerLabel=kind==='team-fusion'?'Worker':kind==='expert-fusion'?'Expert':'Sidekick';
  async function chooseArchitecture(next:typeof kind) {
    const configs=rememberArchitecture({...draft,architectureConfigurations:saved});setSaved(configs);
    if(configs[next]){setDraft(configs[next]!);setKind(next);back();return;}
    if(next==='litefusion'){
      setLoading(true);
      try{const result=await controller.client.api<{selection:LiteFusionSelection;discoveryError?:string}>(`/litefusion/preset?providerId=${encodeURIComponent(specialistGateway(settings.providers,draft.providerId))}`);updateFusion(result.selection);setKind(next);back();if(result.discoveryError)controller.notice(`Preset loaded; gateway discovery failed: ${result.discoveryError}`);}
      catch(error){controller.notice((error as Error).message);}finally{setLoading(false);}return;
    }
    setKind(next);setDraft({...draft,architecture:next==='single'?null:next==='litellm-specific'?{kind:next}:worker?selectArchitecture(next,worker):null,planner:null,shunt:null});back();
  }
  if(view==='litefusion'&&fusion)return <LiteFusionSettings controller={controller} settings={settings} value={fusion} onChange={updateFusion} onClose={back}/>;
  if(view==='advanced')return <ShuntSettings controller={controller} settings={settings} value={draft.shunt??{enabled:false}} onChange={shunt=>setDraft({...draft,shunt})} onClose={back} reasoning={draft.shunt?.model?draft.modelReasoning[JSON.stringify([draft.shunt.model.providerId,draft.shunt.model.model])]:undefined} onReasoning={()=>setView('reasoning:shunt')}/>;
  if(view==='architecture')return <Menu title="Architecture" search={false} onClose={back} footer={loading?'Loading preset…':state.notice} items={SETUP_ARCHITECTURES.map(item=>({id:item.kind,label:`${item.name}${item.recommended?' · Recommended':''}`,description:item.description,disabled:loading,action:()=>{void chooseArchitecture(item.kind);}}))}/>;
  if(view.startsWith('model:'))return <ModelChooser controller={controller} settings={settings} value={route??draft} title={view==='model:worker'?workerLabel:view==='model:planner'?'Planner':(kind==='single'||kind==='litellm-specific')?'Model':fusion?'Lead':'Driver'} onClose={back} onChange={value=>{
    if(view==='model:worker'&&kind!=='single')setDraft({...draft,architecture:selectArchitecture(kind,value)});
    else if(view==='model:planner')setDraft({...draft,planner:value});
    else if(fusion)updateFusion(withLiteFusionLead(fusion,value,fusion.lead?.effort));
    else setDraft({...draft,...value});back();
  }}/>;
  if(view.startsWith('reasoning:')&&route){const key=JSON.stringify([route.providerId,route.model]),supported=catalog.find(item=>item.id===route.model)?.reasoningEfforts??REASONING_EFFORTS;return <Menu title={`Reasoning · ${route.model}`} search={false} onClose={back} items={['',...supported].map(effort=>({id:effort||'default',label:effort||'Default',action:()=>{const modelReasoning={...draft.modelReasoning};if(effort)modelReasoning[key]=effort as typeof REASONING_EFFORTS[number];else delete modelReasoning[key];if(fusion)updateFusion(withLiteFusionLead(fusion,route,effort as typeof REASONING_EFFORTS[number]||undefined));else setDraft({...draft,modelReasoning});back();}}))}/>;}
  if(view==='concurrency')return <Menu title="Workers at once" search={false} onClose={back} items={[undefined,1,2,3,4].map(count=>({id:String(count),label:count?String(count):'Automatic',action:()=>{if(draft.architecture?.kind==='team-fusion'||draft.architecture?.kind==='expert-fusion')setDraft({...draft,architecture:{...draft.architecture,concurrency:count as 1|2|3|4|undefined}});back();}}))}/>;
  if(view==='style')return <Menu title="Output style" onClose={back} items={['',...styles].map(outputStyle=>({id:outputStyle||'default',label:outputStyle||'Default',action:()=>{setDraft({...draft,outputStyle:outputStyle||null});back();}}))}/>;
  const fields=(id:string,label:string,value:ModelRoute|null):MenuItem[]=>[
    {id:`model:${id}`,label:`${label}: ${value?.model||'Choose a model'}`,description:modelGuidance(kind,id as 'driver'|'worker'|'planner'),action:()=>setView(`model:${id}`)},
    ...(value?[{id:`reasoning:${id}`,label:`Reasoning: ${draft.modelReasoning[JSON.stringify([value.providerId,value.model])]??'Default'}`,action:()=>setView(`reasoning:${id}`)}]:[]),
  ];
  return <Menu title="Models" search={false} onClose={onClose} footer={state.notice||(initial.status==='running'||initial.status==='waiting'?'Save queues this configuration after active work finishes.':'Save applies changes · Esc cancels this draft')} items={[
    {id:'architecture',label:`Architecture: ${SETUP_ARCHITECTURES.find(item=>item.kind===kind)!.name}`,action:()=>setView('architecture')},
    ...fields('driver',(kind==='single'||kind==='litellm-specific')?'Model':fusion?'Lead':'Driver',draft),
    ...(kind!=='single'&&kind!=='litefusion'&&kind!=='litellm-specific'?fields('worker',workerLabel,worker):[]),
    ...(draft.architecture?.kind==='team-fusion'||draft.architecture?.kind==='expert-fusion'?[{id:'workers',label:`Workers at once: ${draft.architecture.concurrency??'Automatic'}`,action:()=>setView('concurrency')}]:[]),
    ...(fusion?[{id:'litefusion',label:'LiteFusion policy · 63 task routes and handoffs',action:()=>setView('litefusion')}]:[
      {id:'advanced',label:`Advanced settings · Shunt ${draft.shunt?.enabled?'On':'Off'}`,action:()=>setView('advanced')},
      {id:'planner',label:`Planner model: ${draft.planner?'On':'Off'}`,action:()=>{if(draft.planner)setDraft({...draft,planner:null});else setView('model:planner');}},
      ...(draft.planner?fields('planner','Planner',draft.planner):[]),
    ]),
    {id:'style',label:`Output style: ${draft.outputStyle||'Default'}`,action:()=>setView('style')},
    {id:'save',separatorBefore:true,label:state.pending?'Saving…':'Save',disabled:Boolean(state.pending)||!shuntConfigured(draft.shunt,settings.providers)||!draft.model.trim()||(kind!=='single'&&kind!=='litefusion'&&kind!=='litellm-specific'&&!worker),action:()=>{void controller.configureArchitecture(draft,initial.configRevision??0,initial.pendingArchitecture?.id??null).then(saved=>{if(saved)onClose();});}},
    {id:'providers',label:'Manage providers',action:onProviders},
  ]}/>;
}

export function ShuntSettings({controller,settings,value,onChange,onClose,reasoning,onReasoning}:{controller:TerminalController;settings:Settings;value:ShuntSelection;onChange:(value:ShuntSelection)=>void;onClose:()=>void;reasoning?:string;onReasoning?:()=>void}) {
  const [choosing,setChoosing]=useState(false);
  const providers=settings.providers.filter(provider=>provider.kind!=='codex');
  const canEnable=shuntCanEnable(providers);
  const modelConfigured=shuntConfigured(value,providers);
  if(choosing)return <ModelChooser controller={controller} settings={{...settings,providers}} title="Shunt model" guidance={SHUNT_MODEL_HINT} value={value.model??{providerId:providers[0]?.id??'',model:''}} onClose={()=>setChoosing(false)} onChange={model=>{onChange({...value,enabled:true,model});setChoosing(false);}}/>;
  return <Menu title="Advanced settings" search={false} onClose={onClose} footer={`${SHUNT_BENEFIT} Reported by Spotify; results vary.`} items={[
    {id:'shunt',label:`Shunt: ${value.enabled?'On':'Off'}`,description:SHUNT_DESCRIPTION,disabled:!value.enabled&&!canEnable,action:()=>onChange(shuntToggle(value,!value.enabled))},
    ...(value.enabled?[{id:'shunt-model',label:`Shunt model: ${value.model?.model || 'Choose a model'}`,description:value.model?.model?SHUNT_MODEL_HINT:'Choose a fast, efficient model to enable Shunt.',action:()=>setChoosing(true)}]:[]),
    ...(value.enabled&&modelConfigured&&onReasoning?[{id:'reasoning',label:`Reasoning: ${reasoning??'Default'}`,action:onReasoning}]:[]),
    ...(!canEnable?[{id:'connect',label:'Connect an API-key provider to use Shunt',disabled:true,action:()=>{}}]:[]),
    {id:'back',label:'Back',action:onClose},
  ]}/>;
}
