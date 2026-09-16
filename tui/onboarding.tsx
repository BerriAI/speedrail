/** @jsxImportSource @opentui/react */
import { LiteFusionSettings } from './litefusion.js';
import { liteFusionPreset, liteFusionConfiguration, specialistGateway, withLiteFusionLead } from '../shared/architecture-config.js';
import { bindExactModels, type LiteFusionSelection } from '../shared/litefusion.js';
import { liteFusionReadinessLabel, type LiteFusionReadiness } from '../shared/litefusion-readiness.js';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { architectureWorker, selectArchitecture, type ArchitectureKind, type ModelRoute } from '../shared/architectures.js';
import { SETUP_ARCHITECTURES, modelGuidance, providerIsConfigured, roleGuidance, roleStepTitle } from '../shared/setup.js';
import { SHUNT_DESCRIPTION, SHUNT_MODEL_HINT, shuntConfigured, type ShuntSelection } from '../shared/shunt.js';
import {
  backFromReview, backFromRole, modelRoles, nextAfterArchitecture, nextAfterRole, saveEnabled, type SetupStep,
} from '../shared/setupFlow.js';
import type { Session } from '../shared/types.js';
import type { TerminalController } from './controller.js';
import { Menu } from './ui.js';
import { ModelChooser, ShuntSettings } from './models.js';
import { GatewaySetup } from './gateway.js';
import { Providers } from './providers.js';
import { SkillImporter } from './skillImport.js';

const workerLabel = (kind: 'single' | ArchitectureKind) => kind === 'expert-fusion' ? 'Expert' : kind === 'team-fusion' ? 'Worker' : 'Sidekick';

export function Onboarding({ controller, initial, onClose, quick = false }: { controller: TerminalController; quick?: boolean; initial: Session; onClose: () => void }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const [step, setStep] = useState<SetupStep>('architecture'), [kind, setKind] = useState<'single' | ArchitectureKind>(initial.architecture?.kind ?? (quick || !initial.model ? 'litefusion' : 'single'));
  const [from, setFrom] = useState<'walkthrough' | 'review'>('walkthrough');
  const [shunt, setShunt] = useState<ShuntSelection>(initial.shunt ?? { enabled: false });
  const [driver, setDriver] = useState<ModelRoute>({ providerId: initial.providerId, model: initial.model });
  const [fusion,setFusion]=useState<LiteFusionSelection>(initial.architecture?.kind==='litefusion'?initial.architecture:{kind:'litefusion',gatewayProviderId:initial.providerId});
  const [worker, setWorker] = useState<ModelRoute | null>(initial.architecture ? architectureWorker(initial.architecture) : null);
  const [permissionMode, setPermissionMode] = useState(initial.permissionMode), [view, setView] = useState<'main' | 'providers' | 'advanced' | 'skills' | 'litefusion'>('main');
  const [loading,setLoading]=useState(false);
  const [revision, setRevision] = useState(initial.configRevision ?? 0);

  const [readiness,setReadiness]=useState<LiteFusionReadiness|null>(null);
  useEffect(()=>{let live=true;setReadiness(null);if(kind==='litefusion'&&fusion.gatewayProviderId)void controller.client.api<{readiness:LiteFusionReadiness}>('/litefusion/routes',fusion).then(result=>{if(live)setReadiness(result.readiness);}).catch(()=>{});return()=>{live=false;};},[kind,fusion]);

  if (!state.settings) return null;
  const back = () => setView('main');
  const changeFusion=(value:LiteFusionSelection)=>{setFusion(value);const config=liteFusionConfiguration(value,{...driver,modelReasoning:initial.modelReasoning});setDriver({providerId:config.providerId,model:config.model});};
  if(view==='litefusion')return <LiteFusionSettings controller={controller} settings={state.settings} value={fusion} onChange={changeFusion} onClose={back}/>;
  if (view === 'skills') return <SkillImporter controller={controller} workspace={initial.workspace} onClose={back} onImported={() => {}} />;
  if (view === 'providers') return <Providers controller={controller} onClose={back} />;
  if (view === 'advanced') return <ShuntSettings controller={controller} settings={state.settings} value={shunt} onChange={setShunt} onClose={back} />;

  const hasConfigured = state.settings.providers.some(provider => providerIsConfigured(provider));
  const providerConfigured = (id: string) => state.settings!.providers.some(provider => provider.id === id && providerIsConfigured(provider));
  const roles = modelRoles(kind);
  const defaultProviderId = state.settings.defaultProvider || state.settings.providers[0]?.id || 'litellm';

  // Transition helpers shared by the role pickers and the review rows.
  const openRole = (role: 'driver' | 'worker', editing: boolean) => { setFrom(editing ? 'review' : 'walkthrough'); setStep(role); };
  const onRoleChange = (role: 'driver' | 'worker', route: ModelRoute) => {
    if(role==='driver'){setDriver(route);if(kind==='litefusion')setFusion(withLiteFusionLead(fusion,route,fusion.lead?.effort));}else setWorker(route);
    setStep(from === 'review' ? 'review' : nextAfterRole(kind, role));
  };
  const onRoleClose = (role: 'driver' | 'worker') => setStep(from === 'review' ? 'review' : backFromRole(role));

  async function chooseArchitecture(next:typeof kind,providerId?:string) {
    setKind(next);setFrom('walkthrough');
    if(next!=='litefusion'||!hasConfigured&&!providerId){setStep(nextAfterArchitecture(hasConfigured));return;}
    if(initial.architecture?.kind==='litefusion'&&!providerId){changeFusion(initial.architecture);setStep('review');return;}
    setLoading(true);
    try {const result=await controller.client.api<{selection:LiteFusionSelection;discoveryError?:string}>(`/litefusion/preset?providerId=${encodeURIComponent(providerId??specialistGateway(state.settings!.providers,driver.providerId))}`);changeFusion(result.selection);setStep('review');if(result.discoveryError)controller.notice(result.discoveryError);}
    catch(error){controller.notice((error as Error).message);}finally{setLoading(false);}
  }
  if (step === 'architecture') {
    return <Menu title="How would you like to work?" search={false} onClose={onClose} footer="Choose how to work first. You can change this later with /setup." items={
      SETUP_ARCHITECTURES.map(item => ({ id: item.kind, label: `${kind === item.kind ? '● ' : '○ '}${item.name}${item.recommended ? ' · Recommended' : ''}`, description: item.description, disabled:loading,action:()=>{void chooseArchitecture(item.kind);} }))
    } />;
  }

  if (step === 'gateway') {
    return <GatewaySetup quick={quick} controller={controller} settings={state.settings} providerId={driver.providerId || defaultProviderId} onClose={() => setStep('architecture')} onProviders={() => setView('providers')} onContinue={providerId => {if(kind==='litefusion'){void chooseArchitecture(kind,providerId);return;}setDriver(current=>({providerId,model:current.providerId===providerId?current.model:''}));setStep(nextAfterArchitecture(true));}} onConnected={result => {
      if(kind==='litefusion'){changeFusion(liteFusionPreset(result.providerId,result.models));setFrom('walkthrough');setStep('review');return;}
      setDriver(current => ({ providerId: result.providerId, model: current.providerId === result.providerId && result.models.some(model => model.id === current.model) ? current.model : '' }));
      setWorker(current => current?.providerId === result.providerId && result.models.some(model => model.id === current.model) ? current : null);
      setShunt(current => current.enabled && current.model.providerId === result.providerId && !result.models.some(model => model.id === current.model.model) ? { ...current, model: { providerId: result.providerId, model: '' } } : current);
      setFrom('walkthrough'); setStep(nextAfterArchitecture(true));
    }} />;
  }

  if (step === 'driver' || step === 'worker') {
    const isDriver = step === 'driver';
    const role = (isDriver ? 'driver' : 'worker') as 'driver' | 'worker';
    return <ModelChooser key={`${kind}:${role}`} simple={quick && state.settings.providers.length === 1} guidance={roleGuidance(kind, role)} onChangeGateway={() => setStep('gateway')} controller={controller} settings={state.settings} title={roleStepTitle(kind, role)} value={isDriver ? driver : worker ?? { providerId: driver.providerId || defaultProviderId, model: '' }} onClose={() => onRoleClose(role)} onChange={route => onRoleChange(role, route)} />;
  }

  // Review
  const canSave = saveEnabled({ step, kind, driver, worker, shuntOk:kind==='litefusion'||shuntConfigured(shunt,state.settings.providers), providerConfigured });
  return <Menu title="Review your setup" search={false} onClose={() => { setFrom('walkthrough'); setStep(backFromReview(kind)); }} footer={state.notice || (kind==='litefusion'?'Your lead plans and selects specialists. Use /models to customize.':`${SHUNT_DESCRIPTION} Use /models for advanced options.`)} items={[
    { id: 'architecture', label: `Architecture: ${SETUP_ARCHITECTURES.find(item => item.kind === kind)!.name}`, description: SETUP_ARCHITECTURES.find(item => item.kind === kind)!.description, action: () => { setFrom('walkthrough'); setStep('architecture'); } },
    { id: 'driver', label: `${kind === 'single' || kind === 'litellm-specific' ? 'Model' : kind==='litefusion'?'Lead':'Driver'}: ${driver.model || 'Choose a model'}`, description: modelGuidance(kind, 'driver'), action: () => openRole('driver', true) },
    ...(roles.includes('worker') ? [{ id: 'worker', label: `${workerLabel(kind)}: ${worker?.model || 'Choose a model'}`, description: modelGuidance(kind, 'worker'), action: () => openRole('worker', true) }] : []),
    ...(kind==='litefusion'?[{id:'litefusion',label:readiness?liteFusionReadinessLabel(readiness):'Connecting specialists…',description:readiness?.discoveryError??'View all 63 task assignments and handoffs',action:()=>setView('litefusion')}]:[]),
    ...(kind!=='litefusion'?[{ id: 'advanced', label: `Advanced settings · Shunt ${shunt.enabled ? 'On' : 'Off'}`, description: `${SHUNT_DESCRIPTION} ${shunt.enabled && !shuntConfigured(shunt, state.settings.providers) ? 'Choose a Shunt model to enable it.' : SHUNT_MODEL_HINT}`, action: () => setView('advanced') }]:[]),
    ...(!quick ? [{ id: 'providers', label: 'Manage providers', description: 'Connect an API or sign in to ChatGPT', action: () => setView('providers') },
    { id: 'permissions', label: `Permissions: ${permissionMode === 'auto' ? 'Allow all tools' : 'Ask first'}`, description: permissionMode === 'ask' ? 'Review actions and remember tools you trust' : 'No routine prompts; explicit project rules still apply', action: () => setPermissionMode(permissionMode === 'auto' ? 'ask' : 'auto') }] : []),
    { id: 'import-skills', label: 'Import Claude/Codex skills…', description: 'Copy skills from your machine into this project', action: () => setView('skills') },
    { id: 'save', label: state.pending ? 'Saving…' : quick ? 'Start chatting' : 'Start with this setup', separatorBefore: true, disabled: Boolean(state.pending) || !canSave, action: () => { void save(); } },
  ]} />;

  async function save() {
    const patch = kind==='litefusion'?{...liteFusionConfiguration(fusion,{...driver,modelReasoning:initial.modelReasoning}),permissionMode}:{ ...driver, architecture: kind === 'single' ? null : kind === 'litellm-specific' ? {kind} : worker ? selectArchitecture(kind, worker) : null, permissionMode, shunt };
    if (!await controller.configure(patch, revision)) return;
    setRevision(controller.detail!.session.configRevision ?? 0);
    if (await controller.action('Remembering setup', () => controller.client.api('/workspace-preferences', { ...controller.detail!.session, ...patch, setupComplete: true }))) onClose();
  }
}
