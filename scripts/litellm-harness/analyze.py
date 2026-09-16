"""Summarize every tool/message and usage receipt without publishing raw source traces."""
from collections import Counter
import json
import os
import re
from pathlib import Path
from trace_metrics import activations
from completion import completion_reason

ROOT=Path(os.environ['LITELLM_CAMPAIGN_DIR'])
records=[]
for p in sorted((ROOT/'runs').glob('*/result.json')):
    result=json.loads(p.read_text());directory=p.parent
    record={k:result.get(k) for k in ['id','kind','label','seconds','status','exit','acceptance','timedOut','contextWindow','evaluationProtocol','effort','timeoutSeconds','isolation','interrupted','recovered','durationIncomplete','repairParent']}
    record['run']=directory.name
    task=json.loads((directory/'task.json').read_text()) if (directory/'task.json').exists() else {}
    record['promptRevision']=result.get('promptRevision',task.get('prompt_revision',1))
    record['snapshotRevision']=result.get('snapshotRevision',task.get('snapshot_revision',1))
    record['completionReason']=completion_reason(result)
    record['completed']=record['completionReason']=='completed'
    record['taskPrompt']=task.get('prompt') or (directory/'prompt.txt').read_text().split('\n\nImplement the fix in this checkout')[0]
    if (directory/'harness-source.json').exists():
        snapshot=json.loads((directory/'harness-source.json').read_text())
        record['harnessCommit']=snapshot['base']
        source=snapshot['files']['server/litellm-harness.ts']
        record['harnessSha256']=source['sha256']
        version=re.search(r"LITELLM_HARNESS_VERSION='([^']+)'",source['source'])
        record['harnessVersion']=version[1] if version else None
    if (directory/'messages.json').exists():
        archives=json.loads((directory/'archives.json').read_text()) if (directory/'archives.json').exists() else []
        record['compactions']=len(archives)
        raw=[m for archive in archives for m in archive['messages']]+json.loads((directory/'messages.json').read_text())
        unique={}
        for message in raw:
            key=(message['role'],message['createdAt'],message.get('toolCallId'),tuple(c['id'] for c in message.get('toolCalls',[])))
            unique[key]=message
        messages=sorted(unique.values(),key=lambda m:m['createdAt'])
        calls=list({c['id']:c for m in messages for c in m.get('toolCalls',[])}.values())
        record['activations']=activations(messages,calls)
        usage=result.get('usage',{})
        record['reportedRequests']=usage.get('reportedRequests')
        units=[r['usage'] for r in usage.get('breakdown',[]) if r.get('usage')]
        record.update({'requests':usage.get('requests'),'inputTokens':(sum(x.get('inputTokens',0) for x in units) if units else None),'cachedTokens':(sum(x.get('cachedTokens',0) for x in units) if units else None),'outputTokens':(sum(x.get('outputTokens',0) for x in units) if units else None),'computedUsd':(sum((x.get('inputTokens',0)-x.get('cachedTokens',0))*0.22/1e6+x.get('cachedTokens',0)*0.007/1e6+x.get('outputTokens',0)*0.66/1e6 for x in units) if units else None),'toolCounts':dict(Counter(c['name'] for c in calls)),'toolErrors':[{k:c.get(k) for k in ['name','args','status','output']} for c in calls if c.get('status') in ['error','denied']],'checks':[{'command':c['execution']['command'],'exit':c['execution'].get('exitCode')} for c in calls if c.get('execution',{}).get('checkKey')],'readCharacters':sum(len(c.get('output') or '') for c in calls if c['name'] in ['read_file','grep','glob','litellm_context']),'toolOutputCharacters':sum(len(c.get('output') or '') for c in calls),'bashOutputCharacters':sum(len(c.get('output') or '') for c in calls if c['name'] in ['bash','bash_output']),'finalCharacters':len(result.get('final',''))})
        # Tool calls can overlap. Report both per-tool summed latency and the
        # union of occupied wall-clock intervals; neither is provider latency.
        intervals=sorted((c['startedAt'],c['endedAt']) for c in calls if isinstance(c.get('startedAt'),(int,float)) and isinstance(c.get('endedAt'),(int,float)) and c['endedAt']>=c['startedAt'])
        merged=[]
        for start,end in intervals:
            if merged and start<=merged[-1][1]:merged[-1][1]=max(merged[-1][1],end)
            else:merged.append([start,end])
        by_tool=Counter()
        for call in calls:
            if isinstance(call.get('startedAt'),(int,float)) and isinstance(call.get('endedAt'),(int,float)):
                by_tool[call['name']]+=max(0,call['endedAt']-call['startedAt'])/1000
        record['toolActiveSeconds']=sum(end-start for start,end in merged)/1000
        record['toolSecondsByName']={name:round(seconds,3) for name,seconds in by_tool.items()}
        record['modelSeconds']=sum(unit.get('durationMs',0) for unit in units)/1000
        requests_with_time=[u for u in usage.get('breakdown',[]) if isinstance(u.get('startedAt'),(int,float))]
        first_request=min((u['startedAt'] for u in requests_with_time),default=None)
        reviews=[m['createdAt'] for m in messages if m['role']=='system' and m.get('content','').startswith('LiteLLM change review.')]
        if reviews and first_request is not None:
            record['reviewStartedSeconds']=max(0,reviews[0]-first_request)/1000
            record['reviewModelRequests']=sum(u['startedAt']>=reviews[0] for u in requests_with_time)
        edited=[c['startedAt'] for c in calls if c.get('startedAt') and (c['name'] in ['write_file','edit_file'] or c.get('changes'))]
        if edited and first_request is not None:record['timeToFirstEditSeconds']=max(0,min(edited)-first_request)/1000
        signatures=Counter((c['name'],json.dumps(c.get('args',{}),sort_keys=True)) for c in calls)
        record['exactRepeatedCalls']=sum(n-1 for n in signatures.values() if n>1)
        for step,m in enumerate([m for m in messages if m['role']=='assistant'],1):
            if any(c['name'] in ['write_file','edit_file'] or c.get('changes') for c in m.get('toolCalls',[])):
                record['firstEditRound']=step;break
        (directory/'trace-analysis.json').write_text(json.dumps(record,indent=2))
    elif (directory/'codex.jsonl').exists():
        events=[json.loads(line) for line in (directory/'codex.jsonl').read_text().splitlines()]
        usage=next((e.get('usage',{}) for e in reversed(events) if e.get('type')=='turn.completed'),{})
        record.update({'inputTokens':usage.get('input_tokens'),'cachedTokens':usage.get('cached_input_tokens'),'outputTokens':usage.get('output_tokens'),'computedUsd':None,'toolCounts':dict(Counter(e['item']['type'] for e in events if e.get('type')=='item.completed' and 'item' in e))})
    records.append(record)
(ROOT/'analysis.json').write_text(json.dumps(records,indent=2))
for r in records:
    print(json.dumps({k:r.get(k) for k in ['run','seconds','requests','firstEditRound','computedUsd','acceptance']}))
