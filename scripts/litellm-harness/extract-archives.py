"""Recover compaction archives from completed runs recorded before archive export existed."""
import json
import os
from pathlib import Path
import sqlite3

root=Path(os.environ['LITELLM_CAMPAIGN_DIR'])
for result in (root/'runs').glob('*/result.json'):
    directory=result.parent
    if (directory/'archives.json').exists() or not (directory/'messages.json').exists():continue
    messages=json.loads((directory/'messages.json').read_text())
    if not messages:continue
    session=messages[0]['sessionId']
    db=sqlite3.connect((directory/'state/litespeed.db').as_uri()+'?mode=ro',uri=True)
    try:
        sessions=[json.loads(row[0]) for row in db.execute('SELECT data FROM sessions')]
        archives=[]
        for s in sorted(sessions,key=lambda s:s['createdAt']):
            if s.get('parentId')==session and s.get('archived'):
                archives.append({'sessionId':s['id'],'messages':[json.loads(row[0]) for row in db.execute('SELECT data FROM messages WHERE session_id=? ORDER BY rowid',(s['id'],))]})
        (directory/'archives.json').write_text(json.dumps(archives,indent=2))
        if archives:print(json.dumps({'run':directory.name,'archives':len(archives)}))
    finally:db.close()
