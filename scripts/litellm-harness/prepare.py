"""Build answer-free LiteLLM snapshots and private reference tests from local Git."""
import ast
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile

REPO = Path(os.environ['LITELLM_SOURCE_REPO'])
ROOT = Path(os.environ['LITELLM_CAMPAIGN_DIR'])
CASES = [
    ('converse-config', 'train', 'a73e77079818a74d8bb54db591766a71de727301', 'Fix Bedrock Converse request mapping: request-level configuration such as guardrailConfig and performanceConfig must not also appear inside inferenceConfig. Preserve guarded-text behavior and ordinary inference parameters.'),
    ('vertex-version-path', 'train', '1249f84b10e39f1ad7ddfffb0fe11069abe0d2f1', 'Vertex requests fail when api_base ends with /v1 or /v1beta1: the generated URL omits project, location and model. Make these version-only bases work for streaming and non-streaming requests. Preserve bare hosts, full custom paths and Gemini behavior.'),
    ('anthropic-image-guardrail', 'train', '0c127caedb3438ebe7f82d04fc51024d534cce6d', 'Anthropic message guardrails drop image blocks whose source type is url. Carry URL image sources into the guardrail image input alongside existing base64 support, including images in tool results. Preserve the original message content.'),
    ('anthropic-tool-document', 'train', '141185268450a248cb5bb251da3ac503273a1648', 'The Anthropic /v1/messages compatibility bridge loses document blocks inside tool_result content. Translate supported document blocks using the same document handling as ordinary user content, preserving mixed text and document content.'),
    ('databricks-reasoning', 'dev', '8b2983bd90', 'Databricks chat responses put model thinking in reasoning_content. Preserve it in both normal and streaming LiteLLM responses, including reasoning-only chunks and chunks that also contain final text.'),
    ('empty-choices', 'dev', 'b7dad8b44e', 'Response conversion and streaming can crash or invent an empty assistant choice when the upstream response has an empty choices list. Support empty choices and usage-only responses without an IndexError or a fabricated choice, including the Anthropic compatibility adapter.'),
    ('dashscope-rerank', 'dev', 'e907e5ee9b', 'DashScope rerank calls should use the native text-rerank service path rather than the OpenAI-compatible path. Fix DashScope and its Qwen brand aliases while respecting explicitly configured API bases and existing chat behavior.'),
    ('openai-schema-patterns', 'test', '13837d319d', 'OpenAI rejects tool JSON schemas containing regex patterns its validator cannot compile. Sanitize incompatible regex patterns recursively, preserving valid patterns and unrelated schema properties, across OpenAI and Azure Chat and Responses request mapping. Do not mutate caller-owned tool schemas.'),
    ('databricks-unity', 'test', '6b721de3e5', 'Databricks Unity model service names need routing through the AI Gateway endpoint. Preserve ordinary serving endpoint routing and custom API base handling. Cover authentication headers and endpoint construction.'),
    ('mai-image-params', 'test', '1d18b61e3e', 'Azure AI MAI image generation and editing send unsupported parameters. Map the supported MAI parameters correctly, handle unsupported optional parameters consistently with drop_params, and keep image-edit and image-generation model routing accurate.'),
    ('bedrock-thinking', 'test', '2611f6420a', 'Bedrock DeepSeek thinking text leaks into visible content. Parse thinking into reasoning_content in normal and streaming Converse responses, handling delimiters split across chunks, and preserve visible answer text and non-DeepSeek behavior.'),
    ('router-candidates', 'train', '2000642592', "Router candidate deployment IDs must resolve unprefixed model names against provider-qualified wildcard deployments. Use the router's existing resolution semantics, preserving direct group names and team-scoped resolution."),
    ('drop-params-booleans', 'train', '13005cb831', 'Boolean configuration strings such as drop_params="false" are treated as true in some request paths. Normalize supported string and boolean values consistently in per-request parameters, router defaults, and Responses handling. Preserve explicit false values and avoid changing unrelated string options.'),
    ('router-strategy-isolation', 'dev', 'b0071f363f', 'A per-request routing_strategy override registers its selector in global callbacks and affects unrelated requests. Isolate override selectors while retaining their per-call rate-limit accounting across sync, async and pass-through routing.'),
    ('cache-cost-estimation', 'dev', 'ff2f122846', 'Cost estimation ignores prompt cache read/write tokens. Account for supported cache token categories and prices in cost estimation, expose the setting consistently, and preserve estimates when cache details are absent.'),
    ('team-member-budget', 'dev', 'd963e9fa6e', 'Team member budget enforcement allows a request at the exact cap and can lose enforcement after Redis counters expire. Enforce the boundary and retain correct accumulated spend when rebuilding expired counters. Preserve ordinary team/user budget behavior.'),
    ('router-retry-deployment', 'test', '8ce4c05019', 'When a deployment refuses a request and the retry policy permits another attempt, the router can keep retrying that same deployment. Move retries to another eligible deployment across sync, async, streaming and pass-through entrypoints while preserving fallback semantics.'),
    ('router-request-tags', 'test', '35451ecc7b', 'Deployment tags leak into request tag routing during retries and fallbacks. Preserve the original request tags separately so retry/fallback selection uses the caller tags, while keeping deployment metadata available for logging.'),
    ('team-router-names', 'test', 'eb45a088d3', 'A team-scoped auto-router cannot consistently be selected by its public name. Resolve the public router name within the team without leaking access to another team, including compression/pre-call checks and candidate deployment lookup.'),

]

# A separate catalog and campaign directory preserve earlier frozen datasets.
# Curators can select public behavior tests and exclude new private-helper tests
# before qualification; every exclusion is retained in the manifest.
catalog_path = os.environ.get('LITELLM_CASE_CATALOG')
catalog = json.loads(Path(catalog_path).read_text()) if catalog_path else []
if catalog_path:
    CASES = [(c['id'], c['split'], c['revision'], c['prompt']) for c in catalog]
    if len({c[0] for c in CASES}) != len(CASES) or any(not re.fullmatch(r'[a-z0-9-]+', c[0]) for c in CASES):
        raise ValueError('Catalog case IDs must be unique, lowercase path-safe names.')
catalog_by_id = {c['id']: c for c in catalog}

def git(*args):
    return subprocess.check_output(['git', '-C', str(REPO), *args])

def snapshot(revision, destination):
    destination.mkdir(parents=True, exist_ok=True)
    process = subprocess.Popen(['git', '-C', str(REPO), 'archive', revision], stdout=subprocess.PIPE)
    with tarfile.open(fileobj=process.stdout, mode='r|') as archive:
        for member in archive:
            p = Path(member.name)
            if not member.isfile() or p.is_absolute() or '..' in p.parts:
                continue
            if '_experimental' in p.parts and 'out' in p.parts:
                continue
            if member.size > 15 * 1024 * 1024:
                continue
            target = destination / p
            if target.exists():
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.extractfile(member).read())
            target.chmod(member.mode & 0o777)
    if process.wait():
        raise RuntimeError('Snapshot extraction failed')

def changed_tests(revision, test_path):
    source = git('show', f'{revision}:{test_path}').decode()
    diff = git('diff', '--unified=0', revision+'^1', revision, '--', test_path).decode()
    lines = set()
    for start, count in re.findall(r'^@@ .*? \+(\d+)(?:,(\d+))? @@', diff, re.M):
        lines.update(range(int(start), int(start)+int(count or 1)))
    selected = []
    def visit(node, parents):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith('test_') and any(n in lines for n in range(node.lineno, node.end_lineno+1)):
            selected.append('::'.join([test_path, *parents, node.name]))
        for child in ast.iter_child_nodes(node):
            visit(child, parents+[node.name] if isinstance(node, ast.ClassDef) else parents)
    visit(ast.parse(source), [])
    return source, selected

ROOT.mkdir(parents=True, exist_ok=True)
manifest=[]
prompt_overrides=json.loads(Path(__file__).with_name('task-prompts.json').read_text())
for name, split, rev, prompt in CASES:
    revision=git('rev-parse',rev).decode().strip()
    base=git('rev-parse',revision+'^1').decode().strip()
    paths=git('diff','--name-only',base,revision).decode().splitlines()
    directory=ROOT/'cases'/name
    workspace=directory/'base'
    if not (directory/'manifest.json').exists():
        snapshot(base,workspace)
        gold=directory/'reference';gold.mkdir(parents=True,exist_ok=True)
        selected=[]
        for p in paths:
            if p.startswith('tests/') and p.endswith('.py'):
                source,nodes=changed_tests(revision,p)
                target=gold/p;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(source)
                selected.extend(nodes)
        reference_paths = catalog_by_id.get(name, {}).get('reference_paths', ['litellm', 'enterprise'])
        if not reference_paths or any(not isinstance(p, str) or p.startswith('/') or '..' in Path(p).parts or p.startswith('tests') for p in reference_paths):
            raise ValueError('Reference paths must be explicit repository paths outside the acceptance tests.')
        (directory/'reference.patch').write_bytes(git('diff',base,revision,'--',*reference_paths))
        record={'id':name,'split':split,'base':base,'reference':revision,'prompt':prompt,'input_provenance':'Requirements summarized from the public change; retrospective task, not an original pre-merge issue. No reference patch or acceptance tests in solver input.','reference_paths':reference_paths,'source_paths':[p for p in paths if p.startswith(('litellm/','enterprise/'))],'test_nodes':selected}
        (directory/'manifest.json').write_text(json.dumps(record,indent=2))
    record=json.loads((directory/'manifest.json').read_text())
    if record.get('snapshot_revision')!=2:
        snapshot(base,workspace)
    record['snapshot_revision']=2
    record['prompt_revision']=3
    record['prompt']=prompt_overrides.get(name,prompt)
    record['input_provenance']='Retrospective requirements curated from the public change and acceptance behavior, not an original pre-merge issue. The same requirements go to every solver; reference code and tests are withheld.'
    original=record.get('reference_test_nodes',record['test_nodes'])
    record['reference_test_nodes']=original
    def coupled(node):
        return (name=='openai-schema-patterns' and '/prompt_templates/' in node
                or name=='router-retry-deployment' and node.endswith('::test_router_retry_skip_stamp_feeds_deployment_ids_to_skip_on_retry')
                or name=='team-router-names' and node.split('::')[-1] in {
                    'test_strategy_resolution_agrees_with_the_deployment_path_for_every_principal',
                    'test_drop_strategy_markers_keeps_plain_deployments_and_rejects_marker_only_sets',
                    'test_team_deployments_across_teams_unions_one_team_and_rejects_two'})
    selection = catalog_by_id.get(name, {})
    def selected(node):
        include = selection.get('include_test_names')
        exclude = selection.get('exclude_test_names', [])
        return not coupled(node) and (include is None or node.split('::')[-1] in include) and node.split('::')[-1] not in exclude
    record['excluded_reference_nodes']=[n for n in original if not selected(n)]
    record['test_nodes']=[n for n in original if selected(n)]
    record['oracle_note']=selection.get('oracle_note', 'Tests directly calling newly introduced helper names are excluded; alternate implementations may satisfy the public behavior.')
    (directory/'manifest.json').write_text(json.dumps(record,indent=2))
    manifest.append(record)
    for resource in git('ls-tree','-r','--name-only',base,'--','litellm/litellm_core_utils/tokenizers','litellm/proxy/swagger').decode().splitlines():
        target=workspace/resource
        if not target.exists():
            target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes(git('show',base+':'+resource))
    print(json.dumps({'id':name,'split':split,'tests':len(manifest[-1]['test_nodes'])}),flush=True)
(ROOT/'cases.json').write_text(json.dumps(manifest,indent=2))
