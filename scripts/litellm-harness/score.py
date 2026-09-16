"""Restore independently captured tests, then score code rather than the agent's prose."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT=Path(os.environ['LITELLM_CAMPAIGN_DIR'])
PYTHON=os.environ['LITELLM_EVAL_PYTHON']
RUNNER=Path(__file__).with_name('offline-pytest.py').resolve()
for raw in sys.argv[1:]:
    directory=Path(raw).resolve()
    result=json.loads((directory/'result.json').read_text())
    saved_task=directory/'task.json'
    case=json.loads((saved_task if saved_task.exists() else ROOT/'cases'/result['id']/'manifest.json').read_text())
    workspace=directory/'acceptance-workspace'
    if workspace.exists():shutil.rmtree(workspace)
    subprocess.run(['cp','-cR',str(directory/'workspace'),str(workspace)],check=True)
    shutil.copytree(ROOT/'cases'/result['id']/'reference',workspace,dirs_exist_ok=True)
    xml=directory/'acceptance.xml'
    xml.unlink(missing_ok=True)
    command=[PYTHON,str(RUNNER),str(workspace),'--junitxml='+str(xml),*case['test_nodes']]
    try:
        ran=subprocess.run(command,capture_output=True,text=True,timeout=180,env={'PATH':os.environ['PATH']})
        (directory/'acceptance.log').write_text(ran.stdout+ran.stderr)
        suites=list(ET.parse(xml).getroot().iter('testsuite')) if xml.exists() else []
        counts={k:sum(int(s.get(k,0)) for s in suites) for k in ['tests','failures','errors','skipped']}
        acceptance={'exit':ran.returncode,**counts,'passed':ran.returncode==0 and counts['tests']>counts['skipped'] and counts['errors']==0}
    except subprocess.TimeoutExpired:
        acceptance={'passed':False,'timeout':True}
    result['acceptance']=acceptance
    (directory/'result.json').write_text(json.dumps(result,indent=2))
    print(json.dumps({k:result.get(k) for k in ['id','kind','label','seconds','acceptance']}))
