"""Audit MAI's HTTP contract separately; never rewrite frozen acceptance results."""
import json
import os
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

root = Path(os.environ['LITELLM_CAMPAIGN_DIR'])
scripts = Path(__file__).resolve().parent
probe = scripts / 'probes/mai_http_errors.py'
targets = [('base', root / 'cases/mai-image-params/base'),
           ('reference', root / 'cases/mai-image-params/validation')]
targets += [(Path(run).name, Path(run) / 'acceptance-workspace') for run in sys.argv[1:]]
results = []
for name, workspace in targets:
    output = root / 'mai-audit' / name
    output.mkdir(parents=True, exist_ok=True)
    xml = output / 'result.xml'
    result = subprocess.run([
        os.environ['LITELLM_EVAL_PYTHON'], str(scripts / 'offline-pytest.py'),
        str(workspace), '--junitxml=' + str(xml), str(probe),
    ], capture_output=True, text=True, timeout=120, env={'PATH': os.environ['PATH']})
    (output / 'result.log').write_text(result.stdout + result.stderr)
    suites = list(ET.parse(xml).getroot().iter('testsuite')) if xml.exists() else []
    counts = {key: sum(int(suite.get(key, 0)) for suite in suites)
              for key in ['tests', 'failures', 'errors', 'skipped']}
    record = {'run': name, 'exit': result.returncode, **counts}
    results.append(record)
    print(json.dumps(record), flush=True)
(root / 'mai-audit.json').write_text(json.dumps(results, indent=2) + '\n')
