"""Export the historical phase-1 study; later evaluations are reported separately. Raw traces stay in the private directory."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import statistics
import sys

root = Path(os.environ['LITELLM_CAMPAIGN_DIR'])
destination = Path(sys.argv[1])
destination.mkdir(parents=True, exist_ok=True)
analysis = json.loads((root / 'analysis.json').read_text())
fields = ['run', 'id', 'kind', 'label', 'promptRevision', 'snapshotRevision', 'taskPrompt',
          'harnessVersion', 'harnessSha256', 'harnessCommit', 'completed', 'completionReason', 'status', 'exit',
          'contextWindow', 'evaluationProtocol', 'isolation', 'effort', 'timeoutSeconds', 'compactions',
          'seconds', 'timedOut', 'requests', 'reportedRequests', 'inputTokens', 'cachedTokens',
          'outputTokens', 'computedUsd', 'acceptance', 'firstEditRound', 'exactRepeatedCalls',
          'readCharacters', 'toolOutputCharacters', 'bashOutputCharacters', 'toolCounts']
runs = [{key: run.get(key) for key in fields} for run in analysis]
integrity = json.loads((Path(__file__).parent / 'integrity-review.json').read_text())
affected = {r['run']: r for r in integrity['affectedRuns']}
for run in runs:
    run['integrityIssue'] = affected.get(run['run'])
audit = json.loads((root / 'access-audit.json').read_text())
audited_names = {r['run'] for r in audit}
cases = json.loads((root / 'cases.json').read_text())
tasks = []
for case in cases:
    task = {key: case.get(key) for key in ['id', 'split', 'base', 'reference', 'prompt_revision',
            'prompt', 'input_provenance', 'test_nodes', 'excluded_reference_nodes', 'oracle_note']}
    validation = root / 'cases' / case['id'] / 'validation.json'
    task['qualification'] = json.loads(validation.read_text()) if validation.exists() else None
    tasks.append(task)

ledger = json.loads((root / 'spend.json').read_text())
token_priced = [record for record in ledger['records'] if isinstance(record.get('usage'), dict)
                and all(isinstance(record['usage'].get(key), (int, float)) for key in ['prompt_tokens', 'completion_tokens'])]
priced = [record for record in ledger['records'] if record.get('costKnown') is True
          or ('costKnown' not in record and record in token_priced)]
money = {'ceilingUsd': ledger['limitUsd'], 'committedUsd': ledger['committedUsd'],
         'pricedUsd': sum(record['chargedUsd'] for record in priced),
         'pricedRequests': len(priced), 'admittedRequests': len(ledger['records']),
         'unpricedRequests': len(ledger['records']) - len(priced), 'astraUsd': None}
known_input = sum(record['usage'].get('prompt_tokens', 0) for record in token_priced)
known_cached = sum(max(0, min(record['usage'].get('prompt_tokens', 0), (record['usage'].get('prompt_tokens_details') or {}).get('cached_tokens', 0))) for record in token_priced)
known_output = sum(record['usage'].get('completion_tokens', 0) for record in token_priced)
money['requestsWithTokenUsage'] = len(token_priced)
money['knownTokenCosts'] = {'uncachedInputUsd': (known_input - known_cached) * 0.22 / 1e6, 'cachedInputUsd': known_cached * 0.007 / 1e6, 'outputUsd': known_output * 0.66 / 1e6}
money['knownInputTokens'] = known_input
money['knownCachedInputTokens'] = known_cached
money['knownOutputTokens'] = known_output
primary = [r for r in runs if r['label'].startswith('comparison-') and r['evaluationProtocol'] == 3 and r['snapshotRevision'] == 2]
followup = [r for r in runs if r['label'] == 'replication-v11-r1']
final_runs = [r for r in runs if r['label'] == 'replication-v13-r1']
groups = [('Codex / Astra', [r for r in primary if r['kind'] == 'codex']),
          ('LiteLLM v9 / DeepSeek', [r for r in primary if r['kind'] == 'litellm-specific']),
          ('LiteLLM v11 / DeepSeek', followup),
          ('LiteLLM v13 / DeepSeek (post-hoc)', final_runs)]
for (_, group), expected in zip(groups, [21, 21, 7, 7]):
    if len(group) != expected or any(r['acceptance'] is None or r['run'] not in audited_names for r in group):
        raise RuntimeError('Finish and score the frozen 42-run study, seven-run follow-up and seven-run final-version diagnostic before publishing.')
mai_file = root / 'mai-audit.json'
mai = json.loads(mai_file.read_text()) if mai_file.exists() else []
data = {'schemaVersion': 2, 'generatedAt': datetime.now(timezone.utc).isoformat(),
        'phase1FinalHarnessVersion': '2026-09-15.13', 'benchmarkedHarnessVersions': ['2026-09-15.9', '2026-09-15.11'], 'postHocEvaluatedHarnessVersion': '2026-09-15.13',
        'runtime': (json.loads((root / 'runtime-versions.json').read_text()) if (root / 'runtime-versions.json').exists() else None),
        'runs': [r for r in runs if r in primary or r in followup or r in final_runs], 'tasks': tasks, 'gatewayAccounting': money, 'postHocMaiHttpAudit': mai, 'integrityReview': integrity, 'traceAudit': {'runs': len(audit), 'shellCommands': sum(r['commands'] for r in audit), 'flaggedCommands': sum(len(r['flags']) for r in audit), 'externalCalls': sum(len(r['externalCalls']) for r in audit)}}
(destination / 'litellm-harness-phase1-results.json').write_text(json.dumps(data, indent=2) + '\n')

def success(run):
    return bool((run['acceptance'] or {}).get('passed')) and run['completed']

def verdict(run):
    result = run['acceptance']
    if result is None:
        return 'Unscored'
    if result.get('timeout'):
        return 'Scoring timeout'
    passed = result.get('tests', 0) - result.get('failures', 0) - result.get('errors', 0) - result.get('skipped', 0)
    return f"{passed}/{result.get('tests', 0)}"

lines = [
    '# LiteLLM harness phase-1 results', '',
    '**This campaign does not establish that DeepSeek with this harness is better than Astra with Codex. Four original DeepSeek trials accessed the live checkout outside their historical snapshots, compromising the comparison.** The tables retain raw completed patches that pass every selected reference check, including affected trials; these counts are not an uncontaminated quality score. Some reference checks also impose private implementation details.', '',
    'The last version in this historical phase is **v13**. Later versions are evaluated separately in the [current campaign report](litellm-harness-results.md). Version 9 received the original 42-run comparison; v11 received a separately frozen seven-run follow-up. A later code review found that mixed team/router queries searched only proxy symbols. V13 fixes that search-area selection, recognizes area names inside Python symbols, and interleaves areas so a large proxy tree cannot consume the scan limit before router code is reached; it has focused regression tests, training replays and a separate seven-run evaluation on these already-known tasks. That final evaluation is post-hoc, not fresh held-out evidence. Do not pool the three harness versions. All three harness versions use the actual Litespeed runner and `fireworks_ai/deepseek-v4p1-flash`. The baseline is the installed Codex CLI with `gpt-6-astra`. Both routes request High reasoning and receive 900 seconds. DeepSeek uses its verified 1,048,576-token context window.', '',
    'See the [protocol](../scripts/litellm-harness/README.md), [original plan](../scripts/litellm-harness/comparison-plan.json), [follow-up plan](../scripts/litellm-harness/replication-plan.json), [final known-task evaluation](../scripts/litellm-harness/final-evaluation-plan.json), and [all measurements and task revisions](litellm-harness-phase1-results.json).', '',
    '## Aggregate results', '',
    '| Route | Raw completed + all checks pass | Out-of-snapshot access | Median seconds | Timeouts | Known DeepSeek token subtotal |',
    '|---|---:|---:|---:|---:|---:|',
]
for name, group in groups:
    cost = sum(r['computedUsd'] or 0 for r in group) if any(r['computedUsd'] is not None for r in group) else None
    lines.append(f"| {name} | {sum(success(r) for r in group)}/{len(group)} | {sum(r['integrityIssue'] is not None for r in group)} | {statistics.median(r['seconds'] for r in group):.1f} | {sum(bool(r['timedOut']) for r in group)} | {'Unavailable' if cost is None else f'${cost:.4f}'} |")
lines += ['', 'Repeated trials of the same task are correlated. Seven curated tasks cannot establish broad superiority. The v11 and v13 evaluations each have one trial per task; do not pool versions or treat their smaller denominators as stronger evidence. V13 was evaluated after prior task outcomes were inspected. Latency is observational because independent tasks ran concurrently on one host.', '',
          '## Per-task raw completion and acceptance', '',
          '| Task | Astra | v9 | v11 | v13 post-hoc |', '|---|---:|---:|---:|---:|']
for case in [c for c in cases if c['split'] == 'test']:
    values = []
    for _, group in groups:
        selected = [r for r in group if r['id'] == case['id']]
        values.append(f"{sum(success(r) for r in selected)}/{len(selected)}")
    lines.append('| ' + case['id'] + ' | ' + ' | '.join(values) + ' |')
lines += ['', '## Evaluation integrity', '',
          'The final trace audit found actual live-checkout reads in four v9 trials and one plain-model development run. In particular, one Bedrock run read newer implementation and tests. Passing results from these trials cannot support a fair comparison. All planned trials remain in the tables, visibly marked; no replacement runs were selected to improve the score.', '',
          'The [review](../scripts/litellm-harness/integrity-review.json) records each affected run. The [audit script](../scripts/litellm-harness/audit.py) flags commands for human inspection; it is a heuristic, not a security boundary. No flags does not prove isolation. Future controlled studies must expose only the task snapshot and installed dependencies to the solver, with the live repository and reference artifacts inaccessible. Offline prose alone did not achieve that here.', '',
          '## What the reference checks miss or overconstrain', '',
          '- **MAI image parameters:** several reference checks prescribe an exception subclass and exact prose, whereas the task asks for HTTP 400. The separate post-hoc probe below checks the stated status-code contract. It does not replace the frozen scores.',
          '- **Router request tags:** one of two checks imports `ROUTING_REQUEST_TAGS_METADATA_KEY`, a constant introduced by the human patch. An implementation can preserve caller tags using a different private representation. The other check exercises actual retry selection and logging metadata.',
          '- **Team router names:** several checks call private helpers using newly introduced argument names. Other failures exercise real compression ordering or tagged deployment selection. A raw failing row does not identify which kind occurred.',
          '- **Router retry deployment:** missed async adapter and batch entrypoints are real behavior gaps, not merely naming or diagnostic differences.', '',
          'Base/reference qualification catches broken environments but does not make a reference test implementation-neutral. These additional issues were identified after candidate freeze and after opening the comparison results. They were not fed back into the frozen candidate.', '',
          '### Separate MAI HTTP-status probe', '',
          'The [probe](../scripts/litellm-harness/probes/mai_http_errors.py) checks 15 invalid size/count inputs for HTTP 400, without requiring an exception subclass or phrase. It fails on the base and passes on the human reference. This is a post-hoc diagnostic, not a replacement benchmark.', '',
          '| Snapshot/run | HTTP checks passed |', '|---|---:|']
for row in mai:
    passed = row['tests'] - row['failures'] - row['errors'] - row['skipped']
    lines.append(f"| {row['run']} | {passed}/{row['tests']} |")
lines += ['', '## Every comparison run', '',
          'A completed run must finish normally before the limit. A timeout can leave a passing partial patch; it still does not count as a completed success. All planned trials are retained.', '',
          '| Task | Route | Trial | Reference checks | Seconds | Completed | Integrity issue |',
          '|---|---|---|---:|---:|---|---|']
for name, group in groups:
    for run in group:
        lines.append(f"| {run['id']} | {name} | {run['label']} | {verdict(run)} | {run['seconds']:.1f} | {run['completed']} | {'Out-of-snapshot access' if run['integrityIssue'] else '—'} |")
lines += ['', '## Development record', '',
          'These exploratory runs informed changes and task corrections. Earlier runs used incomplete snapshots, a smaller context window or different task wording. They are retained for audit and must not be pooled as an architecture comparison.', '',
          '| Run | Prompt / snapshot revision | Reference checks | Seconds | Completed | Integrity issue |',
          '|---|---|---:|---:|---|---|']
for run in runs:
    if run['evaluationProtocol'] in (None, 1, 2, 3) and run not in primary and run not in followup and run not in final_runs:
        lines.append(f"| {run['run']} | {run['promptRevision']} / {run['snapshotRevision']} | {verdict(run)} | {run['seconds']:.1f} | {run['completed']} | {'Out-of-snapshot access' if run['integrityIssue'] else '—'} |")
lines += ['', '## Where the work went', '',
          'Tool and latency counters include all recorded trials, including flagged ones; they describe execution, not uncontaminated quality. DeepSeek repeatedly spent many rounds locating and reconsidering code before its first edit. The navigator is available but is not forced: shell searches remained common. Router tasks still missed alternate async/batch entrypoints and sometimes exhausted the time allowance. The improvements reduce particular navigation and verification failures; they do not establish that prompts repair the underlying reasoning gap.', '',
          '| Harness | Median requests | Median first-edit round | Shell calls | Navigator calls | Exact repeated calls |',
          '|---|---:|---:|---:|---:|---:|']
for name, group in groups[1:]:
    first_edits = [r['firstEditRound'] for r in group if r['firstEditRound'] is not None]
    lines.append(f"| {name} | {statistics.median(r['requests'] for r in group):.0f} | {statistics.median(first_edits) if first_edits else 'Unavailable'} | {sum((r['toolCounts'] or {}).get('bash', 0) for r in group)} | {sum((r['toolCounts'] or {}).get('litellm_context', 0) for r in group)} | {sum(r['exactRepeatedCalls'] or 0 for r in group)} |")
lines += ['', '## Trace counters', '',
          'The JSON retains every recorded tool count and output-character total. `readCharacters` counts read_file, grep, glob and litellm_context output only; `bashOutputCharacters` covers command output, and `toolOutputCharacters` covers all tools. Exact repeated-call counts detect identical tool names and arguments, not semantically equivalent commands. Missing token usage remains unavailable, not zero.', '',
          '## Campaign spending at export time', '',
          'This ledger snapshot includes later work in the ongoing campaign. It is not a phase-1 subtotal; route-specific token subtotals appear above.', '',
          f"The local gateway admitted **{money['admittedRequests']} requests**. Usage/header-priced charges total **${money['pricedUsd']:.4f}**. The ledger commits **${money['committedUsd']:.4f}**, including full conservative reservations for **{money['unpricedRequests']} unpriced requests**, against a **${money['ceilingUsd']:.2f} ceiling**. Committed dollars are an upper accounting bound, not actual spend. Account-level billing was unavailable.", '',
          f"Known token charges split into **${money['knownTokenCosts']['uncachedInputUsd']:.4f} uncached input**, **${money['knownTokenCosts']['cachedInputUsd']:.4f} cached input**, and **${money['knownTokenCosts']['outputUsd']:.4f} output**. {100 * known_cached / known_input if known_input else 0:.1f}% of reported input tokens were cached. These components exclude unknown usage.", '',
          'DeepSeek run subtotals use known token usage and the verified gateway rates. Missing usage is not free. The campaign total also covers exploratory reviewer calls. Codex/Astra dollar charges are unavailable and separate from the DeepSeek ceiling; they are not zero.', '',
          '## Scope and limitations', '',
          'This is retrospective repository-specific replay, not a blind or chronological future-PR study. Requirements were curated from public changes; the curator inspected references to qualify tasks. Two tasks failed qualification and were excluded. Historical snapshots share a Python dependency environment rather than reproducing every historical CI setup. Solvers receive fresh source snapshots without the original Git history or reference patches. Separate scoring kept reference patches out of task workspaces, but offline instructions did not prevent live-checkout access. The shell was not isolated, and the integrity failures above invalidate an uncontaminated comparison claim.', '',
          'Protocol 4 first introduced a macOS Seatbelt filesystem boundary that blocks the live source and other campaign/reference files while permitting the current run and trusted runtime/dependencies. Networking remains available for model APIs; this is not complete adversarial isolation. Real training smoke runs verify the launcher separately. The current workbench protocol is documented in the replay instructions. The v9/v11/v13 comparison series used protocol 3 and does not inherit later corrections.', '',
          'Source hashes and task revisions are recorded. Production sessions do not automatically mutate the harness. The shipped guides were distilled from training/development cases, and the v11 follow-up was frozen before comparison outcomes were inspected. Neither a green model-written test nor a green focused reference selection proves the absence of other bugs.',
]
(destination / 'litellm-harness-phase1-results.md').write_text('\n'.join(lines) + '\n')
print(json.dumps({'runs': len(runs), 'comparisonRuns': len(primary), 'followupRuns': len(followup), 'finalKnownTaskRuns': len(final_runs), 'gatewayAccounting': money}))
