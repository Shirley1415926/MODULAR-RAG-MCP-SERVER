import json
from types import SimpleNamespace
from unittest.mock import Mock,patch

import pytest
from starlette.testclient import TestClient
from src.pandion_demo.api import app
from src.pandion_demo.insight_chat import answer_question,cohort
from src.pandion_demo.clinic_dataset import build_clinic_dataset


def payload(q='Only follow-ups over 30 days overdue',**extra):
    return {'insight':'allocation-overdue','filters':{'start':'2026-09-16','end':'2026-10-13','role':'All Roles','type':'all'},
            'state':{'age':'all','group':'all'},'question':q,**extra}


def service(responses=()):
    s=SimpleNamespace(llm=SimpleNamespace(chat=Mock(side_effect=[SimpleNamespace(content=json.dumps(r)) for r in responses])),
        hybrid_search=SimpleNamespace(search=Mock(return_value=[SimpleNamespace(metadata={'record_type':'sop','section':'allocation'})])),
        _evidence_item=lambda r:{'source':'SOP-TEST','quote':'Check current need and contact history before offering a suitable appointment.'})
    return s


def test_counts_and_multiturn_scope():
    s=service([{'intent':'counts','age':'keep','group':'active_need'}])
    first=answer_question(s,payload())
    assert first['facts']['base_total']==130 and first['facts']['selected_total']==60
    second=answer_question(s,payload('其中多少人已确认仍需复诊？',state=first['state'],history=['Only follow-ups over 30 days overdue']))
    assert second['state']=={'age':'over30','group':'active_need'}
    ledger=build_clinic_dataset()
    _,expected=cohort(ledger,payload()['filters'],second['state'])
    assert second['facts']['selected_total']==len(expected)>0
    third=answer_question(s,payload('Show supporting records',state=second['state']))
    assert third['state']==second['state'] and third['facts']==second['facts']
    reset=answer_question(s,payload('Show all overdue follow-ups',state=second['state']))
    assert reset['facts']['selected_total']==130
    # Counts/evidence never use model-generated prose.
    assert s.llm.chat.call_count==1


def test_backend_does_not_trust_client_counts_or_record_ids():
    p=payload('Show all overdue follow-ups',source_ids=['invented'],facts={'selected_total':999})
    p['filters']['role']='Coaching'
    out=answer_question(service(),p)
    assert out['facts']['selected_total']==13
    p['filters']['type']='assessment'
    assert answer_question(service(),p)['facts']['selected_total']==0


@pytest.mark.parametrize('mutate',[lambda p:p.update(insight='feedback'),lambda p:p.update(question=''),
    lambda p:p.update(state={'age':'over90','group':'all'}),lambda p:p['filters'].update(role='invented'),
    lambda p:p.update(history=['x']*7),lambda p:p['filters'].update(start='2026-10-13',end='2026-09-16')])
def test_invalid_input(mutate):
    p=payload();mutate(p)
    with pytest.raises(ValueError): answer_question(service(),p)


def test_unsupported_and_router_failure_preserve_scope():
    p=payload('Book these patients now',state={'age':'over30','group':'active_need'})
    out=answer_question(service([{'intent':'unsupported','age':'all','group':'all'}]),p)
    assert out['mode']=='unsupported' and out['state']==p['state']
    out=answer_question(service(),p)
    assert out['mode']=='clarification' and out['state']==p['state']


@pytest.mark.parametrize('bad',[None,'citation','number','sop_only'])
def test_grounded_generation_and_fallback(bad):
    p=payload('Why prioritise time conflicts?')
    computed=answer_question(service(),payload('Show supporting records',state={'age':'all','group':'time_mismatch'}))
    event=next(e['source'] for e in computed['evidence'] if e['kind']=='event')
    reply={'answer':'The recorded time conflict provides a specific issue for staff to check before another offer.','sources':[event,'SOP-TEST']}
    if bad=='citation':reply['sources']=['FAKE','SOP-TEST']
    if bad=='number':reply['answer']='There are 999 patients.'
    if bad=='sop_only':reply['sources']=['SOP-TEST']
    out=answer_question(service([reply]),p)
    assert out['mode']==('rules_only' if bad else 'live_rag')
    assert out['facts']['selected_total']==26


def test_no_guidance_skips_answer_generation():
    s=service();s.hybrid_search.search.return_value=[]
    out=answer_question(s,payload('What should we do next?'))
    assert out['mode']=='rules_only'
    s.llm.chat.assert_not_called()
    assert s.hybrid_search.search.call_args.kwargs['filters']=={'record_type':'sop'}


def test_api_and_asset():
    with patch('src.pandion_demo.api.get_service',return_value=service()):
        client=TestClient(app)
        assert client.get('/insight_chat.js').status_code==200
        assert client.post('/api/insight-chat',json=payload()).json()['facts']['selected_total']==60
        assert client.post('/api/insight-chat',json={}).status_code==400
        assert client.post('/api/insight-chat',content='x'*12001).status_code==413
