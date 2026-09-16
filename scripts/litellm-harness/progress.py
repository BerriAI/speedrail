"""Export an interim, allowlisted report for explicitly supplied development datasets.

Usage: progress.py OUTPUT_DIRECTORY [DATASET_DIRECTORY ...]
The global ledger is LITELLM_CAMPAIGN_DIR. This does not open reserved outcomes.
Run analyze.py per included dataset first. Raw traces and commands stay private.
"""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys

root = Path(os.environ['LITELLM_CAMPAIGN_DIR']).resolve()
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
datasets = [Path(p).resolve() for p in sys.argv[2:]] or [root]
fields = ['run', 'id', 'kind', 'label', 'promptRevision', 'snapshotRevision', 'harnessVersion',
          'harnessSha256', 'harnessCommit', 'completed', 'completionReason', 'status', 'exit', 'evaluationProtocol',
          'isolation', 'effort', 'timeoutSeconds', 'seconds', 'timedOut', 'interrupted',
          'recovered', 'durationIncomplete', 'repairParent', 'requests', 'reportedRequests',
          'inputTokens', 'cachedTokens', 'outputTokens', 'computedUsd', 'acceptance',
          'toolCounts', 'exactRepeatedCalls', 'toolOutputCharacters', 'toolActiveSeconds',
          'modelSeconds', 'timeToFirstEditSeconds', 'reviewStartedSeconds', 'reviewModelRequests', 'activations']
runs = []
for dataset in datasets:
    for record in json.loads((dataset / 'analysis.json').read_text()):
        runs.append({'dataset': 'original' if dataset == root else dataset.name,
                     **{key: record.get(key) for key in fields}})
ledger = json.loads((root / 'spend.json').read_text())
def known(record):
    usage = record.get('usage')
    return record.get('costKnown') is True or ('costKnown' not in record and isinstance(usage, dict)
        and all(isinstance(usage.get(k), (int, float)) for k in ['prompt_tokens', 'completion_tokens']))
settled = [r for r in ledger['records'] if r['status'] == 'settled']
money = {'limitUsd': ledger['limitUsd'], 'knownUsd': sum(r['chargedUsd'] for r in settled if known(r)),
         'unknownReservedUsd': sum(r.get('chargedUsd', r['reservedUsd']) for r in settled if not known(r)),
         'unknownRequests': sum(not known(r) for r in settled),
         'pendingReservedUsd': sum(r['reservedUsd'] for r in ledger['records'] if r['status'] == 'pending'),
         'committedUsd': ledger['committedUsd'], 'admittedRequests': len(ledger['records']), 'astraUsd': None}
assert abs(money['knownUsd'] + money['unknownReservedUsd'] + money['pendingReservedUsd'] - money['committedUsd']) < 0.000001
version = re.search(r"LITELLM_HARNESS_VERSION='([^']+)'", Path('server/litellm-harness.ts').read_text())[1]
now = datetime.now(timezone.utc).isoformat()
integrity = json.loads(Path(__file__).with_name('integrity-review.json').read_text())
affected = {r['run'] for r in integrity['affectedRuns']}
for r in runs:r['knownIntegrityIssue'] = r['run'] in affected
(out / 'litellm-harness-results.json').write_text(json.dumps({'schemaVersion': 3, 'status': 'campaign-in-progress',
    'generatedAt': now, 'currentHarnessVersion': version, 'gatewayAccounting': money, 'runs': runs,
    'limitations': ['Reserved outcomes are not part of this interim export.', 'Trials are not independent samples of future PRs.',
    'Raw acceptance can include implementation-coupled tests.', 'Recovered trials remain interrupted; no missing charges are treated as zero.',
    'Codex/Astra dollar cost is unavailable, not zero.']}, indent=2) + '\n')
lines = ['# LiteLLM harness campaign results', '', f'Interim snapshot: {now}. Current harness: **{version}**.', '',
    '**The campaign is still running. It has not established a quality win over Astra/Codex or production replacement readiness.**', '',
    'The selectable architecture and replay workbench are implemented. The current work measures which mechanisms improve correct, completed patches and which add latency. Model-written critiques are hypotheses; executable checks decide whether a candidate works.', '',
    '## Spending', '', f'Confirmed token/header-priced charges: **${money["knownUsd"]:.4f}**. Missing receipts retain **${money["unknownReservedUsd"]:.4f}** across {money["unknownRequests"]} requests; active requests reserve another **${money["pendingReservedUsd"]:.4f}**. The committed upper bound is **${money["committedUsd"]:.4f}** against the authorized **${money["limitUsd"]:.2f}** ceiling. Reservations are not actual charges. Astra account billing is unavailable.', '',
    '## Controlled development observations', '',
    'The following are training/development trials under protocol 5, after enforcing one global concurrency limit. They are single attempts, not a held-out quality estimate. A raw passing patch is counted as completed only if the solver finished normally.', '',
    '| Task | Harness | Reasoning | Checks | Finished | Seconds |', '|---|---|---|---:|---|---:|']
for r in sorted((r for r in runs if (r['label'] or '').startswith(('replication-stable-v','replication-stable-training2-'))), key=lambda r:(r['id'],r['harnessVersion'] or '',r['effort'] or '')):
    a = r.get('acceptance') or {}; n=a.get('tests',0); passed=n-a.get('failures',0)-a.get('errors',0)-a.get('skipped',0)
    lines.append(f'| {r["id"]} | {r["harnessVersion"]} | {r["effort"]} | {passed}/{n} | {"Yes" if r["completed"] else "No"} | {r["seconds"]:.1f} |')
lines += ['', '## What the traces changed', '',
    '- A passing budget fix was temporarily removed for a baseline experiment, then cancellation prevented restoration. Restoring the model-authored block on a separate diagnostic copy passed all five checks. The original 4/5 timeout stays in the record. The review now keeps the working patch intact.',
    '- Router fixes repeatedly added accounting in downstream wrappers while direct selection entrypoints bypassed it. A return-site map made these paths visible, but did not eliminate the misses in the first controlled trials.',
    '- Three broad Medium-reasoning code audits exhausted 24,000 output tokens each without returning a review. A focused router audit with relevant function excerpts returned actionable findings in 4,026 completion tokens. Its focus came from prior training failures; this does not validate a general-purpose blind reviewer. A second-attempt repair is measured separately.',
    '- Disabling reasoning did not earn a default on the first two hard development cases: it missed more router checks and one budget check. Other effort results remain separate.',
    '- Per-batch concurrency limits collectively overloaded the host. All datasets now share three solver slots and one grader. Interrupted runs and unknown charges are preserved.', '',
    '- An MCP-auth patch passed its reference checks, but repeated 600 ms job polling triggered the host loop guard. Earlier reporting treated every idle session as completed. The analyzer now separates explicit host guard stops from normal completion, even when the patch passes.', '',
    '## Evaluation status', '',
    'A feature-removal study compares the current harness with no learned guides, no automatic initial map, no forced final review, and a 480-line default read window. The plan uses 16 qualified training/development tasks, five variants, and two repetitions, with randomized order. Frozen worktrees preserve each candidate. Outcomes select the next candidate; they are not final test results.', '',
    'A separate corpus selects 20 recent September 15 Python changes by explicit file-count and diff-size criteria. Fourteen pass base/reference qualification; six have environment, new-private-API, or reference failures and are excluded before solver outcomes. Its outcomes remain reserved. Earlier September 9 reserved tasks predate some training snapshots, so they cannot establish chronological generalization.', '',
    'Protocol 6 isolates Git configuration, permits ordinary Git inspection through the installed executable, withholds reference revisions/test selections from solvers, and protects frozen host metadata. Earlier protocol-5 trials contained blocked global-Git-config errors. Do not pool protocols for the final comparison.', '',
    '## Earlier results and limits', '',
    'The [phase-1 report](litellm-harness-phase1-results.md) retains the original Astra/v9 comparison and v11/v13 follow-ups. Four v9 trials read outside their snapshots; those raw results cannot support superiority. Some reference assertions also require implementation-specific names or wording. The later filesystem boundary addresses the observed access failures, but remains a trusted-model evaluation rather than a complete adversarial sandbox.', '',
    'The [measurement export](litellm-harness-results.json) preserves completed and interrupted development trials separately, with tool counts, token totals and timing components. Provider time and tool time can overlap; they should not be added to infer elapsed time. All runs occur on one shared desktop, so latency remains observational.', '',
    'See the [user guide](litellm-harness.md) and [replay protocol](../scripts/litellm-harness/README.md).', '']
(out / 'litellm-harness-results.md').write_text('\n'.join(lines))
print(json.dumps({'runs': len(runs), 'generatedAt': now, 'gatewayAccounting': money}))
