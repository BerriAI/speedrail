"""Require a failing historical base and passing landed patch before model evaluation."""
import concurrent.futures
import json
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import xml.etree.ElementTree as ET

ROOT=Path(os.environ['LITELLM_CAMPAIGN_DIR'])
PYTHON=os.environ['LITELLM_EVAL_PYTHON']
RUNNER=Path(__file__).with_name('offline-pytest.py').resolve()

def run_case(case):
    directory=ROOT/'cases'/case['id'];dest=directory/'validation'
    if dest.exists():shutil.rmtree(dest)
    subprocess.run(['cp','-cR',str(directory/'base'),str(dest)],check=True)
    shutil.copytree(directory/'reference',dest,dirs_exist_ok=True)
    results={}
    for label in ['base','reference']:
        if label=='reference':
            subprocess.run(['git','apply',str(directory/'reference.patch')],cwd=dest,check=True)
        output=directory/(label+'.xml')
        command=[PYTHON,str(RUNNER),str(dest),'--junitxml='+str(output),*case['test_nodes']]
        try:
            result=subprocess.run(command,capture_output=True,text=True,timeout=150,env={'PATH':os.environ['PATH']})
            (directory/(label+'.log')).write_text(result.stdout+result.stderr)
            suites=list(ET.parse(output).getroot().iter('testsuite')) if output.exists() else []
            counts={k:sum(int(s.get(k,0)) for s in suites) for k in ['tests','failures','errors','skipped']}
            results[label]={'exit':result.returncode,**counts}
        except subprocess.TimeoutExpired:
            results[label]={'timeout':True}
    b,g=results['base'],results['reference']
    valid=b.get('exit')==1 and b.get('failures',0)>0 and b.get('errors')==0 and g.get('exit')==0 and g.get('tests',0)>g.get('skipped',0) and g.get('errors')==0
    record={'id':case['id'],'valid':valid,'snapshotRevision':case.get('snapshot_revision',1),'testNodesHash':hashlib.sha256(json.dumps(case['test_nodes'],separators=(',',':'),ensure_ascii=False).encode()).hexdigest(),'results':results}
    (directory/'validation.json').write_text(json.dumps(record,indent=2))
    print(json.dumps(record),flush=True)
    return record

cases=json.loads((ROOT/'cases.json').read_text())
if os.environ.get('LITELLM_CASES'):cases=[c for c in cases if c['id'] in os.environ['LITELLM_CASES'].split(',')]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    result=list(pool.map(run_case,cases))
(ROOT/'validation.json').write_text(json.dumps(result,indent=2))
