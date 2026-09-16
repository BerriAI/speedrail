"""Run a labeled replay batch under a shared, cross-dataset concurrency limit.

Usage: batch.py WORKTREE LABEL KIND EFFORT CASE [CASE ...]
Set LITELLM_CAMPAIGN_LOCK_DIR to ONE shared directory for all datasets/batches.
Existing allocated trials are never silently retried; use a new label explicitly.
"""
import concurrent.futures
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from slots import shared_slot

ROOT = Path(os.environ['LITELLM_CAMPAIGN_DIR']).resolve()
LOCKS = Path(os.environ['LITELLM_CAMPAIGN_LOCK_DIR']).resolve()
CAPACITY = int(os.environ.get('LITELLM_CAMPAIGN_CONCURRENCY', '3'))
if not 1 <= CAPACITY <= 8:
    raise ValueError('Use 1-8 total simultaneous trials across all batches.')
WORKTREE, LABEL, KIND, EFFORT, *CASES = sys.argv[1:]
if not CASES or any(not re.fullmatch('[a-z0-9-]+', value) for value in [LABEL, *CASES]):
    raise ValueError('Supply a path-safe label and at least one case ID.')
LOCKS.mkdir(parents=True, exist_ok=True)
OUTPUT = ROOT / (LABEL + '-batch')
OUTPUT.mkdir(exist_ok=True)
with (LOCKS / 'capacity.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    config = LOCKS / 'capacity.json'
    if config.exists() and json.loads(config.read_text())['capacity'] != CAPACITY:
        raise ValueError('All batches sharing these locks must use the same capacity.')
    config.write_text(json.dumps({'capacity': CAPACITY}))


def run(case):
    with shared_slot(LOCKS, CAPACITY), (LOCKS / (LABEL + '-' + case + '.lock')).open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        prior = list((ROOT / 'runs').glob(LABEL + '-' + case + '-*'))
        if prior:
            print(json.dumps({'case': case, 'label': LABEL, 'skipped': 'trial already allocated; preserve it'}), flush=True)
            return
        with (OUTPUT / (case + '.log')).open('a') as log:
            code = subprocess.run(['node', '--import', 'tsx', 'scripts/litellm-harness/run.ts', case, KIND, LABEL, EFFORT], cwd=WORKTREE, stdout=log, stderr=log).returncode
            for directory in (ROOT / 'runs').glob(LABEL + '-' + case + '-*'):
                if (directory / 'result.json').exists() and (directory / 'candidate.patch').exists():
                    with (LOCKS / 'grader.lock').open('a') as grader:
                        fcntl.flock(grader, fcntl.LOCK_EX)
                        subprocess.run([os.environ['LITELLM_EVAL_PYTHON'], 'scripts/litellm-harness/score.py', str(directory)], cwd=WORKTREE, stdout=log, stderr=log)
        print(json.dumps({'case': case, 'label': LABEL, 'runnerExit': code}), flush=True)


with concurrent.futures.ThreadPoolExecutor(max_workers=CAPACITY) as pool:
    list(pool.map(run, CASES))
