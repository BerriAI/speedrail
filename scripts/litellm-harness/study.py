"""Summarize only the trials named in a predeclared feature study.

Usage: study.py CAMPAIGN_DIRECTORY PLAN_JSON OUTPUT_JSON
Run analyze.py for each included dataset first. This script never traverses
unlisted datasets or selects a harness automatically. Interim pairs are labeled.
"""
from collections import defaultdict
import json
from pathlib import Path
import random
from statistics import mean
import sys


def paired_summary(rows, repetitions, control='control'):
    groups = defaultdict(list)
    for row in rows:
        if row.get('evaluated'):
            groups[(row['dataset'], row['case'], row['name'])].append(row)
    variants = sorted({r['name'] for r in rows} - {control})
    cases = sorted({(r['dataset'], r['case']) for r in rows})
    comparisons = []
    for variant in variants:
        pairs = []
        for dataset, case in cases:
            baseline = groups[(dataset, case, control)]
            candidate = groups[(dataset, case, variant)]
            if len(baseline) != repetitions or len(candidate) != repetitions:
                continue
            pairs.append({'dataset': dataset, 'case': case,
                          'successDelta': mean(r['success'] for r in candidate) - mean(r['success'] for r in baseline),
                          'secondsDelta': mean(r['seconds'] for r in candidate) - mean(r['seconds'] for r in baseline)})
        entry = {'variant': variant, 'control': control, 'pairedTasks': len(pairs),
                 'expectedTasks': len(cases), 'complete': len(pairs) == len(cases), 'pairs': pairs}
        if pairs:
            deltas = [p['successDelta'] for p in pairs]
            rng = random.Random(17062026)
            # Resample tasks, keeping repeated attempts together. This remains
            # descriptive on a small development set, not a promotion test.
            samples = sorted(mean(rng.choices(deltas, k=len(deltas))) for _ in range(10000))
            entry.update(successDelta=mean(deltas), secondsDelta=mean(p['secondsDelta'] for p in pairs),
                         taskBootstrap95=[samples[249], samples[9749]])
        comparisons.append(entry)
    return comparisons


def main():
    root, plan_path, output = map(Path, sys.argv[1:])
    root = root.resolve()
    plan = json.loads(plan_path.read_text())
    cache = {}
    rows = []
    identities = set()
    for item in plan['runs']:
        dataset = (root / item['dataset']).resolve()
        if not dataset.is_relative_to(root):
            raise ValueError('Study dataset must be inside the campaign directory.')
        if dataset not in cache:
            source = dataset / 'analysis.json'
            cache[dataset] = json.loads(source.read_text()) if source.exists() else []
        identity = (item['dataset'], item['case'], item['label'])
        if identity in identities:
            raise ValueError('Study contains a duplicate trial identity.')
        identities.add(identity)
        matches = [r for r in cache[dataset] if r['id'] == item['case'] and r['label'] == item['label']]
        if len(matches) > 1:
            raise ValueError('More than one allocated result for a predeclared trial.')
        row = {k: item[k] for k in ['dataset', 'case', 'name', 'label', 'commit', 'effort']}
        row['evaluated'] = False
        if matches:
            result = matches[0]
            if result['harnessCommit'] != item['commit'] or result['evaluationProtocol'] != plan['protocol'] or result['effort'] != item['effort']:
                raise ValueError('Trial runtime/protocol differs from its predeclared configuration.')
            acceptance = result.get('acceptance')
            if acceptance is not None:
                row.update(evaluated=True, success=bool(result['completed'] and acceptance.get('passed')),
                           completed=result['completed'], completionReason=result.get('completionReason'),
                           seconds=result['seconds'], acceptance=acceptance,
                           computedUsd=result.get('computedUsd'), activations=result.get('activations'))
        rows.append(row)
    summaries = []
    for name in sorted({r['name'] for r in rows}):
        selected = [r for r in rows if r['name'] == name and r['evaluated']]
        summary = {'variant': name, 'evaluated': len(selected), 'expected': sum(r['name'] == name for r in rows)}
        if selected:
            summary.update(successes=sum(r['success'] for r in selected), meanSeconds=mean(r['seconds'] for r in selected),
                           tokenPricedUsd=sum(r.get('computedUsd') or 0 for r in selected),
                           trialsWithoutTokenPrice=sum(r.get('computedUsd') is None for r in selected))
        summaries.append(summary)
    result = {'status': 'complete' if all(r['evaluated'] for r in rows) else 'interim',
              'note': 'Development selection only. Interim observed-task means can change as slower trials finish. Bootstrap resamples tasks, not attempts; it does not correct adaptive candidate selection or establish future generalization. Token prices exclude requests without usage and do not replace the campaign ledger.',
              'variants': summaries, 'comparisons': paired_summary(rows, plan['repetitions']), 'trials': rows}
    output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'status': result['status'], 'variants': summaries,
                      'comparisons': [{k: v for k, v in p.items() if k != 'pairs'} for p in result['comparisons']]}))


if __name__ == '__main__':
    main()
