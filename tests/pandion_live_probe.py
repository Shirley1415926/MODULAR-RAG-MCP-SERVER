"""Read-only live chat probe: one conversation per invocation; no mocks."""
import json
import sys
import time
from urllib.request import Request, urlopen

payload={'insight':'allocation-overdue',
         'filters':{'start':'2026-09-16','end':'2026-10-13','role':'All Roles','type':'all'},
         'feedback_filters':{'start':'2026-09-09','end':'2026-09-15','clinician':'all','segment':'all','type':'all'},
         'state':{'age':'all','group':'all'},'history':[]}
for question in sys.argv[1:]:
    start=time.monotonic()
    request=Request('http://127.0.0.1:8765/api/insight-chat',data=json.dumps({**payload,'question':question}).encode(),headers={'Content-Type':'application/json'})
    with urlopen(request,timeout=65) as response:
        result=json.load(response)
    c=result.get('comparison',{})
    print(json.dumps({'question':question,'seconds':round(time.monotonic()-start,2),
                      'mode':result.get('mode'),'intent':result.get('intent'),'answer':result.get('answer'),
                      'state':result.get('state'),'period':c.get('current_period'),'filters':c.get('filters'),
                      'counts':[c.get('current_outcomes'),c.get('current_appointments')],
                      'selected':result.get('plan',{}).get('selected'),'evidence_count':len(result.get('evidence',[]))},ensure_ascii=False),flush=True)
    payload['state']=result['state'];payload['history']=(payload['history']+[question])[-6:]
