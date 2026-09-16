"""Preserve a failed solver's partial artifacts after its process has exited.

Never turns a terminated solver into a completed trial. Duration is a lower bound
from persisted messages when launch metadata is unavailable. No model calls.
"""
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys

ROOT = Path(os.environ['LITELLM_CAMPAIGN_DIR']).resolve()
processes = subprocess.check_output(['ps', '-axo', 'command'], text=True)
for raw in sys.argv[1:]:
    directory = Path(raw).resolve()
    if directory.parent != ROOT / 'runs':
        raise ValueError('Recover a run in the selected private campaign.')
    if (directory / 'result.json').exists():
        print(json.dumps({'run': directory.name, 'skipped': 'result already exists'}))
        continue
    if any('/solve.ts ' + str(directory) + ' ' in line for line in processes.splitlines()):
        raise RuntimeError('Solver is still running; do not recover its live state.')
    task = json.loads((directory / 'task.json').read_text())
    source = json.loads((directory / 'harness-source.json').read_text())
    protocol = re.search(r'evaluationProtocol:(\d+)', source['files'].get('scripts/litellm-harness/solve.ts', {}).get('source', ''))
    launch = json.loads((directory / 'launch.json').read_text()) if (directory / 'launch.json').exists() else {}
    db_path = directory / 'state' / 'litespeed.db'
    if not db_path.exists():
        raise RuntimeError('No Litespeed state to recover; retain the run as a launch failure.')
    db = sqlite3.connect(db_path.as_uri() + '?mode=ro', uri=True)
    sessions = [json.loads(row[0]) for row in db.execute('SELECT data FROM sessions')]
    session = next(s for s in sessions if s['workspace'] == str(directory / 'workspace') and not s.get('parentId'))
    all_messages = [json.loads(row[0]) for row in db.execute('SELECT data FROM messages')]
    messages = sorted((m for m in all_messages if m['sessionId'] == session['id']), key=lambda m: m['createdAt'])
    archives = [{'sessionId': s['id'], 'messages': sorted((m for m in all_messages if m['sessionId'] == s['id']), key=lambda m: m['createdAt'])} for s in sessions if s.get('parentId') == session['id']]
    units = [json.loads(row[0]) for row in db.execute('SELECT data FROM request_usage WHERE root_session_id=?', (session['id'],))]
    db.close()
    first = min((m['createdAt'] for m in all_messages), default=session['createdAt'])
    last = max((m['createdAt'] for m in all_messages), default=first)
    kind = session.get('architecture', {}).get('kind', 'single')
    label = directory.name[:-(len(task['id']) + 10)]
    result = {'id': task['id'], 'kind': kind, 'label': label, 'model': session['model'],
              'promptRevision': task.get('prompt_revision'), 'snapshotRevision': task.get('snapshot_revision'),
              'evaluationProtocol': int(protocol[1]) if protocol else None, 'isolation': 'macOS-seatbelt' if (directory / 'isolation.sb').exists() else None,
              'effort': next(iter(session.get('modelReasoning', {}).values()), None),
              'seconds': (last - first) / 1000, 'durationIncomplete': True,
              'status': 'error', 'interrupted': True, 'timedOut': launch.get('outerTimedOut', False),
              'errors': ['Solver exited without a completion artifact. Partial persisted state recovered; not a completed trial.'],
              'final': '', 'recovered': True,
              'usage': {'requests': len(units), 'reportedRequests': sum(bool(u.get('usage')) for u in units), 'breakdown': units}}
    workspace = directory / 'workspace'
    subprocess.run(['git', 'add', '--intent-to-add', '--', '.'], cwd=workspace, check=True)
    patch = subprocess.check_output(['git', 'diff', 'HEAD'], cwd=workspace)
    (directory / 'candidate.patch').write_bytes(patch)
    (directory / 'messages.json').write_text(json.dumps(messages, indent=2))
    (directory / 'archives.json').write_text(json.dumps(archives, indent=2))
    (directory / 'result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps({'run': directory.name, 'recovered': True, 'messages': len(messages), 'patchBytes': len(patch)}), flush=True)
