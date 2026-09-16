import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import type { ToolDefinition } from '../shared/types.js';

export const LITELLM_HARNESS_VERSION='2026-09-15.17';
export const litellmContextTool:ToolDefinition={type:'function',function:{name:'litellm_context',description:'Navigate the current LiteLLM checkout. Give a task query to find relevant definitions, inline conditions and existing tests. Give a source path to see its symbol outline and test partners; add a symbol name to read that definition with numbered lines, or callers to find functions invoking a named helper in that file. Reads only this workspace, never Git history or remote answers.',parameters:{type:'object',properties:{query:{type:'string',maxLength:1000},path:{type:'string',maxLength:500},symbol:{type:'string',maxLength:200},callers:{type:'string',maxLength:200,description:'Python helper name whose call sites and enclosing functions to find; requires path.'}},additionalProperties:false}}};

const playbooks = [
  {
    id: 'vertex-version-url-components',
    matches: (query:string) => /vertex/i.test(query) && /(?:base|url|path|version)/i.test(query),
    paths: ['litellm/llms/vertex_ai/vertex_llm_base.py'],
    lessons: [
      'A version-only base is a URL whose parsed path is /v1 or /v1beta1, possibly with a trailing slash. It may still carry a query string. Trace _check_custom_proxy and the subsequent streaming suffix addition; concatenating a resource path to the original URL string puts it after the query.',
      'Probe both version paths with and without a query, in streaming and non-streaming calls. Compose parsed path/query components and retain the base query when adding alt=sse. A malformed URL in the newly supported branch remains a defect even if a neighboring old branch has a similar bug.',
      'Keep full custom paths and Gemini/PSC branches distinct. A path merely ending with /v1 is not necessarily a version-only base.'
    ]
  },
  {
    id: 'router-resolution-and-request-state',
    matches: (query:string) => /(?:rout|deployment)/i.test(query) && /(?:candidat|strateg|override|select|callback|fallback|team|wildcard)/i.test(query),
    paths: ['litellm/router.py', 'litellm/router_strategy/simple_shuffle.py', 'litellm/router_strategy/lowest_tpm_rpm_v2.py'],
    lessons: [
      'Router resolution is ordered, not a union of matching deployments. Inspect aliases, routing groups, _try_early_resolve_deployments_for_model_not_in_names, team/wildcard/default resolution and _get_all_deployments in their existing order. A candidate-list helper should follow that precedence without accidentally applying fallbacks or admission checks.',
      'A per-request strategy override must not replace the router-wide selector or add a callback globally. Inspect _get_strategy_selector and _build_strategy_selector for state registration; keep request-local configuration local.',
      'Removing global callback registration can also remove necessary request accounting. Trace the chosen selector through direct deployment, affinity and normal selection return paths, including sync, async and pass-through methods. Preserve pre_call_check / async_pre_call_check for a request-local selector without running those checks twice for the default selector.',
      'Write the counterexample that distinguishes the override from the default: two consecutive requests with different strategies, a direct deployment return, or a fallback/default candidate. Avoid testing only the new helper in isolation.'
    ]
  },
  {
    id: 'dashscope-compatible-rerank-endpoint',
    matches: (query:string) => /(?:dashscope|qwencloud|qwen.ai.platform)/i.test(query) && /rerank/i.test(query),
    paths: ['litellm/llms/dashscope/rerank/transformation.py', 'litellm/llms/dashscope/common_utils.py', 'litellm/litellm_core_utils/get_llm_provider_logic.py'],
    lessons: [
      'DashScope chat and compatible rerank use different URL families: chat uses /compatible-mode/v1; compatible rerank uses /compatible-api/v1/reranks. Do not infer the native service path from a task calling the endpoint native; inspect the existing request and response contract.',
      'A recognized DashScope chat base can be an implicit default supplied by get_llm_provider, not necessarily an explicit user rerank endpoint. Trace that upstream default and the rerank-specific environment override before deciding precedence.',
      'Only remap a recognized chat-shaped base on aliyuncs.com or its subdomains. Preserve custom endpoints, other hostnames and explicit non-chat paths. Regional hostnames should keep their region. An absent base should follow the rerank environment/default path.',
      'Qwen aliases may define separate rerank environment variables and defaults. Inspect qwen_ai_platform.py and qwencloud.py when present; a shared normalizer can prevent their URL behavior drifting apart. Test custom base, regional chat base, rerank override and no base separately.'
    ]
  },
  {
    id: 'cached-response-boundaries',
    matches: (query:string) => /(?:empty|usage.only|cached)/i.test(query) && /(?:choices?|responses?|stream)/i.test(query),
    paths: ['litellm/litellm_core_utils/llm_response_utils/convert_dict_to_response.py', 'litellm/litellm_core_utils/streaming_handler.py', 'litellm/llms/anthropic/experimental_pass_through/adapters/transformation.py'],
    lessons: [
      'Dictionary conversion, cache replay, and the Anthropic compatibility adapter are separate boundaries. Changing a converter does not cover CustomStreamWrapper._dispatch_provider_chunk: its cached_response branch may index the first choice independently.',
      'An empty choices list, a missing field, and a field of the wrong type are different cases. Check convert_to_model_response_object and both convert_to_streaming_response variants. Model constructors can fabricate a default assistant choice unless empty lists are passed through explicitly.',
      'For malformed choices, useful LiteLLM diagnostics distinguish no choices from choices that is not a list (TYPE), and include raw keys. Retain the APIError type and the actual supplied type.',
      'Verify the complete cached iterator, not only a conversion helper: usage-only/empty chunks must not crash on first-choice access or produce duplicate terminal chunks. Anthropic finish-reason conversion also needs to tolerate an absent first choice.'
    ]
  },
  {
    id: 'budget-cache-reconciliation',
    matches: (query:string) => /(?:budget|spend)/i.test(query) && /(?:team|redis|counter|reserv)/i.test(query),
    paths: ['litellm/proxy/auth/user_api_key_auth.py', 'litellm/proxy/auth/auth_checks.py', 'litellm/proxy/spend_tracking/budget_reservation.py', 'litellm/proxy/proxy_server.py'],
    lessons: [
      'Cached-key authentication can enforce a team-member budget before common_checks. Inspect the inline comparison in user_api_key_auth.py as well as _check_team_member_budget in auth_checks.py; one can be correct while the other admits a request at the cap.',
      'A clean Redis miss and an unreachable Redis server differ. A stale per-process in-memory value must not hide an expired authoritative counter. Audit the actual cache-read path used by _counter_can_apply_adjustment, not only the normal get_current_spend path.',
      'After a reservation disappears, its original delta is no longer meaningful. The database spend used for reseeding is a lagging floor; successful post-call recovery must also preserve the current settled request cost. increment_spend_counters may skip keys already handled as reserved, so merely reseeding can silently lose that cost.',
      'Counter expiry affects mutations, not only admission reads. Trace _set_reserved_entry_actual_cost into _counter_can_apply_adjustment and its actual cache reader before changing SpendCounterReseed.coalesced. A negative reservation adjustment authorized by a stale local value can recreate an expired Redis counter below zero; a DB-floor reseed alone can lose the settled request cost because reserved keys skip the direct increment.',
      'Keep pre-call reservation resizing separate from post-call settlement/release. Do not apply post-call recovery semantics to an in-flight reservation, or change ordinary team/user admission behavior without evidence.'
    ]
  }
];
function learnedContext(query:string,files:string[]) {
  return playbooks.filter(card=>card.matches(query)&&card.paths.some(file=>files.includes(file))).map(card=>({id:card.id,paths:card.paths.filter(file=>files.includes(file)),lessons:card.lessons,provenance:'Learned from training/development fixes. Verify against this checkout and the current user request; this is a debugging guide, not evidence that the bug is present.'}));
}

export const litellmInstructions=`LiteLLM-specific harness ${LITELLM_HARNESS_VERSION}.
The host may supply an initial navigation note from the current checkout. Use its source locations to start a focused investigation. When available, use litellm_context to find the right source and existing tests before broad exploration. Its relevant playbooks summarize prior LiteLLM fixes; verify those hypotheses in the current source. Pass path to inspect a symbol outline, path + query to filter a large outline, then path + symbol to read the definition. Use path + callers to enumerate uses of a shared helper before changing its contract; this catches thin endpoint wrappers whose names do not match the bug report. For router retries and fallbacks, inspect both common wrappers and the endpoint-specific adapters they dispatch, including async batch operations when they use that machinery. A plain read_file defaults to 160 lines in this architecture; choose a range around the relevant definition. Batch independent reads. Once the causal code path and a relevant test are clear, implement and test instead of continuing a broad survey. Apply a complete small edit rather than repeatedly revising comments or speculative helpers. When the cause is uncertain, use the smallest allowed executable probe to distinguish hypotheses; do not repeatedly reconsider the same code without new evidence. Solve the requested behavior instead of trying to reconstruct an imagined upstream patch. Shared helpers can be bypassed by cache-hit or fast paths: trace the actual entrypoint for the reported symptom.
Repository map: litellm/llms/<provider>/<endpoint>/transformation.py translates provider requests/responses; common_utils.py and handler.py handle shared protocol and transport. litellm/types/llms contains provider schemas. litellm/litellm_core_utils contains shared streaming, response conversion, prompt templates and routing helpers. litellm/proxy contains gateway/auth/spend/guardrails; enterprise contains paid features. tests/test_litellm mirrors the source tree. UI source is ui/litellm-dashboard, not litellm/proxy/_experimental/out (generated output). Model capabilities/prices live in model_prices_and_context_window.json.
Read CLAUDE.md when AGENTS.md references it. Prefer extending an existing mapped test. Test intended behavior and the relevant unaffected behavior; a bug fix may require changing an assertion that encoded the bug. Check sync/async and streaming/non-streaming counterparts when the changed behavior crosses them. Preserve caller-owned inputs and existing public interfaces.
Before finalizing a protocol change, check the representation at its boundary. For URLs, compose parsed path/query components rather than appending a path to an arbitrary base string; preserve existing query parameters and add streaming parameters correctly. For images/documents, preserve source kind and MIME metadata, and verify the downstream adapter's expected representation (raw base64 and a data URL are different). For shared parameters, distinguish absent, null and explicit false; preserve caller-owned inputs. These are review heuristics, not instructions to add unrelated behavior.\nUse installed dependencies and focused tests. Inspect pyproject.toml/Makefile or existing environment evidence before guessing a test command. Separate collection/import/infrastructure failures from an assertion failure. Start with your regression test and a small relevant existing selection. If a wider check fails, diagnose whether it is caused by this change before adding more code. Do not repeatedly rerun an unchanged failing setup. Keep your working patch in place during baseline comparisons: temporarily stashing or reverting it can leave the fix absent when the turn ends or is cancelled. If a command can remove edits, inspect the actual diff afterward before reporting completion. Use exact test nodes or a narrow expression in a relevant file. A whole provider/router directory can mix thousands of unit, integration and live-service checks; do not broaden to it just for confidence after focused checks pass. Do not run broad suites, generate dashboard bundles, or install packages unless the task needs them.
Keep the user informed with short, concrete progress messages. Finish with the behavior changed, focused checks actually run, and any unresolved limitation. An announced action is not an executed action; a test command that collected zero tests is not a successful verification.`;

export const litellmTestFocus='LiteLLM verification checkpoint: several check commands have completed. Decide what specific uncertainty remains before spending more time on tests. Many files under tests/test_litellm mix mocked unit tests with live provider or service tests; inspect the selected tests and use exact test nodes where possible. Do not repeatedly run a passing selection, repeatedly toggle the patch to investigate unrelated flakiness, or broaden a -k expression into live API tests. A pre-existing unrelated failure can be reported with evidence. Continue testing when a concrete change, failure, or user requirement calls for it. This notice does not require an extra test run.';
export const litellmExplorationFocus='LiteLLM exploration checkpoint: you have made several tool calls without a recorded edit. If this is an implementation task, state the current hypothesis briefly and use the smallest allowed regression or executable probe to distinguish it from alternatives before another broad search. A failing probe is useful evidence; repeated speculation about an imagined reference patch is not. Then make the scoped correction when the cause is demonstrated. Prefer litellm_context with path + query to locate a symbol in a large module instead of repeatedly surveying files. Existing tests may encode the bug the user asked to change. Continue reading when a concrete dependency or uncertainty requires it. If the user requested explanation or planning, finish that answer when the evidence is sufficient; this notice does not authorize edits.';

const ignored=['**/.*/**','**/node_modules/**','**/__pycache__/**','**/_experimental/out/**','**/dist/**','**/build/**','**/vendor/**'];

export function litellmReview(files:string[],checks:string[]):string {
  return `LiteLLM change review. Follow the user's scope and verification constraints. First compare the requested behavior with the patch and checks already recorded, using the source you have read. If that evidence covers the requirement and its relevant counterpart, finish now with the actual results. This is a final audit, not a request to start another implementation or testing cycle.
Only investigate further when you can name a specific uncovered requirement or concrete defect. Select the one existing caller or exact test node that resolves that uncertainty; fix demonstrated problems and rerun the affected check. An old assertion can encode the behavior the user asked to change. Do not rerun a passing selection for reassurance, expand to a whole provider/router test directory, or add speculative cases after the required behavior has been verified.
Never remove the working fix to demonstrate a baseline failure. If a baseline check is necessary, use a separate temporary copy and keep the current patch intact; cancellation must not strand the checkout without its fix. A baseline check is not required just to finish this review. Report unresolved unrelated failures with the evidence available instead of chasing them indefinitely.
Relevant boundary audit: URLs preserve parsed path/query components; image/document adapters preserve source type and MIME; request configuration avoids shared-state mutation and distinguishes absent from explicit false. Apply only what the requested change touches. Then finish.
Host-recorded changed paths: ${JSON.stringify(files.slice(0,30))}
Host-recorded check commands (execution is not proof of coverage): ${JSON.stringify(checks.slice(-5))}`;
}

export function isLitellmDefinitionRead(output:string,file:string):boolean {
  const first=output.slice(0,output.indexOf('\n'));
  return first.startsWith(file+':')&&/^\d+-\d+$/.test(first.slice(file.length+1))&&/^\d+\t/m.test(output);
}
const words=(value:string)=>[...new Set(value.toLowerCase().replace(/vertex[ -]ai/g,'vertex_ai').replace(/azure[ -]ai/g,'azure_ai').replace(/tool[ -]results?/g,'tool_result').match(/[a-z][a-z0-9_]{2,}/g)??[])].filter(word=>!['the','and','for','from','with','that','this','into','must','not','its','fix','preserve','existing','request','requests','response','litellm','test','tests','support','make','when','should','path','content'].includes(word));

async function sourceFile(workspace:string,relative:string):Promise<string>{
  const root=await fs.realpath(workspace);
  if(path.isAbsolute(relative)||relative.split(/[\\/]/).some(p=>p==='..'||p.startsWith('.'))||relative.includes('\\'))throw new Error('Use a visible workspace-relative source path.');
  const target=path.resolve(root,relative);
  if(!target.startsWith(root+path.sep)||relative.includes('/_experimental/out/'))throw new Error('Generated or external paths are not part of LiteLLM navigation.');
  const stat=await fs.lstat(target);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>1024*1024||await fs.realpath(target)!==target)throw new Error('Choose a regular source file within this checkout (up to 1 MiB).');
  const handle=await fs.open(target,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const opened=await handle.stat();
    if(opened.dev!==stat.dev||opened.ino!==stat.ino)throw new Error('The file changed while opening it; retry.');
    const buffer=Buffer.alloc(1024*1024+1);
    let bytes=0;
    while(bytes<buffer.length){const read=await handle.read(buffer,bytes,buffer.length-bytes,bytes);if(!read.bytesRead)break;bytes+=read.bytesRead;}
    const after=await handle.stat();
    if(bytes>1024*1024||after.size!==opened.size||after.mtimeMs!==opened.mtimeMs)throw new Error('The file changed while reading it; retry.');
    const content=buffer.subarray(0,bytes).toString('utf8');
    const final=await fs.lstat(target);
    if(final.ino!==opened.ino||final.dev!==opened.dev||final.isSymbolicLink()||await fs.realpath(target)!==target)throw new Error('The file path changed while reading it; retry.');
    if(content.includes('\0'))throw new Error('Binary files are not supported.');
    return content;
  }finally{await handle.close();}
}

function partners(files:string[],source:string):string[]{
  const mirror=source.startsWith('litellm/')?'tests/test_'+source:'tests/'+source;
  const directory=path.posix.dirname(mirror),base=path.posix.basename(source,'.py');
  return files.filter(p=>p.startsWith(directory+'/')&&p.endsWith('.py')).sort((a,b)=>Number(b.includes(base))-Number(a.includes(base))||a.localeCompare(b)).slice(0,8);
}

function outline(text:string){
  return text.split('\n').flatMap((line,index)=>{const match=/^(\s*)(?:(?:async\s+)?def|class)\s+([A-Za-z_][\w]*)/.exec(line);return match?[{name:match[2],line:index+1,indent:match[1].length,signature:line.trim().slice(0,200)}]:[];});
}

// Syntactic navigation, deliberately not a Python call graph. Dynamic dispatch,
// aliases and strings can require an ordinary source read to disambiguate.
function callSites(text:string,name:string){
  const lines=text.split('\n'),symbols=outline(text);
  const definitions=symbols.map(symbol=>({...symbol,end:symbols.find(next=>next.line>symbol.line&&next.indent<=symbol.indent)?.line??lines.length+1}));
  const pattern=new RegExp('\\b'+name+'\\s*\\(');
  const matches=lines.flatMap((line,index)=>{
    const trimmed=line.trim();
    if(trimmed.startsWith('#')||/^(?:(?:async\s+)?def|class)\s/.test(trimmed)||!pattern.test(line))return [];
    const owner=definitions.findLast(symbol=>symbol.line<index+1&&symbol.end>index+1);
    return [{line:index+1,caller:owner?.name??'<module>',definitionLine:owner?.line,preview:trimmed.slice(0,240)}];
  });
  return {calls:matches.slice(0,60),moreCalls:matches.length>60,note:'Syntactic call matches in this file, not a complete call graph. Inspect dynamic dispatch and counterpart entrypoints before concluding coverage.'};
}

function routingReturnSites(text:string){
  const lines=text.split('\n'),symbols=outline(text);
  const names=new Set(['get_available_deployment','async_get_available_deployment','get_available_deployment_for_pass_through','async_get_available_deployment_for_pass_through']);
  return symbols.filter(symbol=>names.has(symbol.name)).map(symbol=>{
    const end=symbols.find(next=>next.line>symbol.line&&next.indent<=symbol.indent)?.line??lines.length+1;
    const returns=lines.slice(symbol.line,end-1).flatMap((line,index)=>/^\s*return\b/.test(line)?[{line:symbol.line+index+1,statement:line.trim().slice(0,180)}]:[]);
    return {name:symbol.name,line:symbol.line,returns:returns.slice(0,16),moreReturns:returns.length>16};
  });
}

async function matchingSymbols(workspace:string,files:string[],tokens:string[],signal:AbortSignal){
  const proxy=tokens.some(t=>/(?:^|_)(budget|auth|team|member|spend|redis|guardrail|proxy)/.test(t));
  const router=tokens.some(t=>/(?:^|_)(router|deployment|retry|fallback|routing|tags?)/.test(t));
  const providers=[...new Set(files.flatMap(p=>p.startsWith('litellm/llms/')?[p.split('/')[2]]:[]))].filter(provider=>tokens.some(t=>t===provider||provider.startsWith(t+'_')));
  // Queries can cross provider, gateway and router boundaries. Search every
  // matching area rather than silently hiding symbols in the other categories.
  const caching=tokens.some(t=>/(?:^|_)(cache|cached|caching|redis)/.test(t));
  const integrations=tokens.some(t=>/(?:^|_)(logging|callback|integration|langfuse|s3)/.test(t));
  const mcp=tokens.some(t=>/(?:^|_)(mcp|discovery)/.test(t));
  const responses=tokens.some(t=>/(?:^|_)(responses|bridge)/.test(t));
  const shared=tokens.some(t=>/(?:^|_)(choices|convert|schema|params|stream|cost)/.test(t));
  const roots=[...providers.map(p=>'litellm/llms/'+p+'/'),...(proxy?['litellm/proxy/','enterprise/']:[]),...(router?['litellm/router.py','litellm/router_utils/','litellm/router_strategy/']:[]),...(caching?['litellm/caching/']:[]),...(integrations?['litellm/integrations/']:[]),...(responses?['litellm/responses/','litellm/main.py']:[]),...(mcp?['litellm/experimental_mcp_client/','litellm/proxy/_experimental/mcp_server/']:[]),...(shared?['litellm/litellm_core_utils/','litellm/utils.py']:[])];
  if(!roots.length)roots.push('litellm/litellm_core_utils/','litellm/utils.py');
  const buckets=roots.map(root=>files.filter(p=>p.endsWith('.py')&&(root.endsWith('/')?p.startsWith(root):p===root)));
  const candidates:string[]=[],seen=new Set<string>();
  // A large proxy/enterprise tree must not consume the scan budget before the
  // router or provider area gets a turn. Keep the overall limit, interleave roots.
  for(let row=0;row<Math.max(...buckets.map(bucket=>bucket.length));row++)for(const bucket of buckets)if(bucket[row]&&!seen.has(bucket[row])){seen.add(bucket[row]);candidates.push(bucket[row]);}
  const matches:{path:string;name:string;line:number;score:number}[]=[];
  const references:{path:string;line:number;preview:string;score:number}[]=[];
  let bytes=0,scanned=0;
  for(let offset=0;offset<Math.min(candidates.length,800)&&bytes<64*1024*1024;offset+=8){
    signal.throwIfAborted();
    await Promise.all(candidates.slice(offset,Math.min(offset+8,800)).map(async file=>{
      try{const text=await sourceFile(workspace,file);bytes+=Buffer.byteLength(text);scanned++;
        for(const symbol of outline(text)){const score=tokens.reduce((n,t)=>n+Number(symbol.name.toLowerCase().includes(t)),0);if(score)matches.push({path:file,name:symbol.name,line:symbol.line,score});}
        for(const [index,line] of text.split('\n').entries()){
          const trimmed=line.trim(),lower=line.toLowerCase();
          if(!trimmed||trimmed.startsWith('#')||/^(?:(?:async\s+)?def|class)\s/.test(trimmed))continue;
          const score=tokens.reduce((n,t)=>n+Number(lower.includes(t)),0);
          if(score>=Math.min(2,tokens.length)){
            references.push({path:file,line:index+1,preview:trimmed.slice(0,240),score:score+(/^(?:if|elif|assert)\b/.test(trimmed)?0.5:0)});
            references.sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path)||a.line-b.line);references.length=Math.min(references.length,12);
          }
        }
      }catch{signal.throwIfAborted();}
    }));
  }
  signal.throwIfAborted();
  return {matches:matches.sort((a,b)=>b.score-a.score||a.name.length-b.name.length||a.path.localeCompare(b.path)||a.line-b.line).slice(0,12),references:references.sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path)||a.line-b.line).slice(0,12),roots,scanned,partial:scanned<candidates.length};
}
export async function litellmContext(workspace:string,args:Record<string,unknown>,signal:AbortSignal):Promise<string>{
  signal.throwIfAborted();
  if(Object.keys(args).some(k=>!['query','path','symbol','callers'].includes(k)))throw new Error('Use query, path, symbol or callers.');
  for(const [k,v] of Object.entries(args))if(typeof v!=='string'||v.length>(k==='query'?1000:k==='path'?500:200))throw new Error('Navigation arguments must be bounded strings.');
  if(args.callers&&(!args.path||args.symbol||typeof args.callers!=='string'||!/^[_a-zA-Z]\w*$/.test(args.callers)))throw new Error('Callers requires path and a Python identifier, without symbol.');
  const files=(await fg(['litellm/**/*.py','tests/**/*.py','enterprise/**/*.py','ui/litellm-dashboard/src/**/*.{ts,tsx}','model_prices_and_context_window.json','schema.prisma','litellm/proxy/schema.prisma','pyproject.toml','Makefile'],{cwd:workspace,onlyFiles:true,followSymbolicLinks:false,dot:false,ignore:ignored})).sort();
  signal.throwIfAborted();
  if(!files.includes('litellm/__init__.py'))return 'Open the LiteLLM repository root to use this navigator. Expected litellm/__init__.py and tests/test_litellm. Ordinary workspace tools remain available.';
  const file=typeof args.path==='string'?args.path:undefined;
  if(file){
    if(!files.includes(file))throw new Error('Path is not an indexed source file. Use query to find a workspace source path.');
    const text=await sourceFile(workspace,file),lines=text.split('\n');
    const symbols=outline(text);
    const tests=partners(files,file);
    if(args.callers)return JSON.stringify({path:file,...callSites(text,String(args.callers)),tests},null,2);
    if(args.symbol){
      const matches=symbols.filter(s=>s.name===args.symbol);
      if(matches.length!==1)return JSON.stringify({path:file,error:matches.length?'Several definitions match; use read_file at the desired line.':'Symbol not found.',symbols:symbols.filter(s=>s.name.includes(String(args.symbol))).slice(0,30),tests});
      const start=matches[0],next=symbols.find(s=>s.line>start.line&&s.indent<=start.indent)?.line??lines.length+1;
      const end=Math.min(next-1,start.line+239);
      const exits=lines.slice(start.line,next-1).flatMap((line,i)=>/^\s*(?:return|raise|yield)\b/.test(line)?[{line:start.line+i+1,statement:line.trim().slice(0,160)}]:[]);
      return `${file}:${start.line}-${end}\n${lines.slice(start.line-1,end).map((line,i)=>`${start.line+i}\t${line}`).join('\n')}\n${end<next-1?`Definition continues; read_file offset ${end+1}.\n`:''}Control-flow locations (syntactic; nested definitions may be included): ${JSON.stringify(exits.slice(0,30))}${exits.length>30?' [more locations omitted]':''}\nExisting test candidates: ${tests.join(', ')||'No exact mirror found; search tests.'}`;
    }
    const terms=words(String(args.query??''));
    const selected=terms.length?symbols.map(symbol=>({symbol,score:terms.reduce((n,term)=>n+Number(symbol.name.toLowerCase().includes(term)),0)})).filter(item=>item.score).sort((a,b)=>b.score-a.score||a.symbol.line-b.symbol.line).map(item=>item.symbol):symbols;
    const references=terms.length?lines.flatMap((line,index)=>{
      const trimmed=line.trim(),score=terms.reduce((n,term)=>n+Number(line.toLowerCase().includes(term)),0);
      if(!score||!trimmed||trimmed.startsWith('#')||/^(?:(?:async\s+)?def|class)\s/.test(trimmed))return [];
      return [{line:index+1,preview:trimmed.slice(0,240),score}];
    }).sort((a,b)=>b.score-a.score||a.line-b.line).slice(0,20):undefined;
    return JSON.stringify({path:file,lines:lines.length,symbols:selected.slice(0,100),moreSymbols:selected.length>100,references,tests},null,2);
  }
  const aliases:Record<string,string>={conversion:'convert',translation:'transform',streaming:'stream',configuration:'config',authentication:'auth',authorization:'auth',parameters:'params',retries:'retry'};
  const tokens=[...new Set(words(String(args.query??'')).flatMap(word=>[word,...(aliases[word]?[aliases[word]]:[])]))].slice(0,24);
  const ui=/\b(ui|dashboard|frontend|react|component)\b/i.test(String(args.query??''));
  const ranked=files.filter(p=>!p.startsWith('tests/')&&(ui||!p.startsWith('ui/'))).map(p=>({path:p,score:tokens.reduce((score,word)=>score+(p.toLowerCase().includes(word)?(p.split('/').includes(word)?5:2):0),0)})).filter(p=>p.score>0).sort((a,b)=>b.score-a.score||a.path.length-b.path.length||a.path.localeCompare(b.path)).slice(0,8);
  const symbols=tokens.length&&!ui?await matchingSymbols(workspace,files,tokens,signal):undefined;
  let routingCallers:unknown,routingEntrypoints:unknown;
  if(symbols?.roots.includes('litellm/router.py')&&files.includes('litellm/router.py')&&/(?:strateg|override|callback|account)/i.test(String(args.query??''))){
    try{routingEntrypoints={path:'litellm/router.py',definitions:routingReturnSites(await sourceFile(workspace,'litellm/router.py')),note:'Syntactic return sites, including early returns. Check whether a proposed downstream wrapper is reached by every relevant entrypoint; routing methods can also be called directly. Nested definitions may be included.'};}catch{signal.throwIfAborted();}
  }
  if(symbols?.roots.includes('litellm/router.py')&&files.includes('litellm/router.py')&&/(?:retr|fallback|tags?)/i.test(String(args.query??''))){
    try{const routerText=await sourceFile(workspace,'litellm/router.py');routingCallers={path:'litellm/router.py',wrappers:['function_with_fallbacks','async_function_with_fallbacks'].map(name=>({name,...callSites(routerText,name)}))};}catch{signal.throwIfAborted();}
  }
  return JSON.stringify({query:args.query??'',routingCallers,routingEntrypoints,playbooks:learnedContext(String(args.query??''),files),references:symbols?.references,symbols:symbols?.matches.map(s=>({...s,tests:partners(files,s.path).slice(0,2)})),symbolScan:symbols&&{roots:symbols.roots,files:symbols.scanned,partial:symbols.partial},matches:ranked.map(p=>({path:p.path,tests:partners(files,p.path).slice(0,3)})),hint:'Use path + symbol for a definition, path + query to filter a large outline, or grep within the relevant directory for an exact term. Ranked paths and symbols are navigation hints, not proof of the cause.'},null,2);
}
