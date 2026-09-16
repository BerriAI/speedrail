"""Flag possible answer exposure in completed traces for manual review.

This is a heuristic audit, not a sandbox or proof of isolation. Raw commands and
outputs stay in the private campaign directory. Run after all planned trials.
"""
from collections import Counter
import json
import os
from pathlib import Path
import re

root = Path(os.environ['LITELLM_CAMPAIGN_DIR'])
source = str(Path(os.environ['LITELLM_SOURCE_REPO']).resolve())
python_bin = str(Path(os.environ['LITELLM_EVAL_PYTHON']).parent)
rows = []
for result_path in sorted((root / 'runs').glob('*/result.json')):
    result = json.loads(result_path.read_text())
    if result.get('evaluationProtocol') not in (3, 4) or result.get('snapshotRevision') != 2:
        continue
    directory = result_path.parent
    calls = []
    if (directory / 'messages.json').exists():
        archives = json.loads((directory / 'archives.json').read_text())
        messages = [m for a in archives for m in a['messages']] + json.loads((directory / 'messages.json').read_text())
        calls = list({c['id']: c for m in messages for c in m.get('toolCalls', [])}.values())
        commands = [{'command': c.get('args', {}).get('command', ''), 'output': c.get('output', '')} for c in calls if c['name'] == 'bash']
        tools = Counter(c['name'] for c in calls)
    else:
        events = [json.loads(line) for line in (directory / 'codex.jsonl').read_text().splitlines()]
        items = [e['item'] for e in events if e.get('type') == 'item.completed']
        commands = [{'command': i.get('command', ''), 'output': i.get('aggregated_output', '')} for i in items if i['type'] == 'command_execution']
        tools = Counter(i['type'] for i in items)
    flags = []
    for command in commands:
        text = command['command']
        categories = []
        if re.search(r'\bgit\s+(?:log|fetch|pull|remote|clone|show)\b', text):
            categories.append('history-or-remote')
        if re.search(r'\b(?:curl|wget|gh)\b|requests\.(?:get|post)\(|https?://(?:github|raw\.githubusercontent|huggingface)', text):
            categories.append('network-or-public-reference')
        # Installed interpreters/linters are allowed; reading the live source is not.
        scrubbed = text.replace(python_bin, 'BENCHMARK_BIN')
        if source in scrubbed or re.search(r'acceptance-workspace|reference\.patch|gateway-key|connection\.json|/cases/', scrubbed):
            categories.append('live-source-or-answer-artifact')
        # Other absolute reads also deserve human inspection. String matching
        # cannot distinguish a quoted fixture string from an executed argument.
        if re.search(r'\b(?:cat|sed|grep|rg|find|ls|cd)\s+(?:[^\n;|]*\s)?/(?:Users|home)/', scrubbed.replace(str(directory / 'workspace'), 'WORKSPACE')):
            categories.append('possible-outside-checkout-path')
        if categories:
            flags.append({**command, 'categories': categories})
    external = [c for c in calls if c['name'] in ['web_fetch', 'web_search', 'task', 'delegate', 'sidekick', 'capability'] or c['name'].startswith('mcp')]
    path_calls = [c for c in calls if c['name'] in ['read_file', 'grep', 'glob', 'litellm_context'] and source in json.dumps(c.get('args', {}))]
    rows.append({'run': directory.name, 'kind': result['kind'], 'label': result['label'], 'commands': len(commands), 'toolCounts': dict(tools), 'externalCalls': external, 'outsidePathCalls': path_calls, 'flags': flags})
(root / 'access-audit.json').write_text(json.dumps(rows, indent=2) + '\n')
print(json.dumps({'runs': len(rows), 'commands': sum(r['commands'] for r in rows), 'flaggedCommands': sum(len(r['flags']) for r in rows), 'externalCalls': sum(len(r['externalCalls']) for r in rows), 'outsidePathCalls': sum(len(r['outsidePathCalls']) for r in rows)}))
