from unittest.mock import patch
from src.pandion_demo.daily_plan import build_plan
from src.pandion_demo.insight_chat import answer_question, cohort
from src.pandion_demo.clinic_dataset import build_clinic_dataset
from tests.unit.test_pandion_insight_chat import payload, service
import pytest


def test_panel_counts_dedup_and_capacity():
    ledger=build_clinic_dataset(); f=payload()['filters']
    overdue,_=cohort(ledger,f,{'age':'all','group':'all'})
    p=build_plan(ledger,f,overdue,20)
    assert list(p['alerts'].values())==[27,67,130]
    assert p['total']==207 and p['overlap']==17
    assert p['selected']==20 and p['high_remaining']==7
    assert len({r['patient'] for r in p['records']})==20
    assert all(r['tier']==0 for r in p['records'])
    larger=build_plan(ledger,f,overdue,40)
    assert larger['records'][:20]==p['records']
    assert larger['high_remaining']==0 and sum(s['count'] for s in larger['steps'])==40


def test_scope_and_empty():
    ledger=build_clinic_dataset(); f={**payload()['filters'],'role':'Coaching'}
    overdue,_=cohort(ledger,f,{'age':'all','group':'all'})
    p=build_plan(ledger,f,overdue,200)
    valid={r['patient_id'] for r in ledger['referrals'] if r['role']=='Coaching'}|{r['patient_id'] for r in overdue}
    assert {r['patient'] for r in p['records']}<=valid
    assert p['selected']==p['total'] and p['remaining']==0
    assert build_plan({'referrals':[],'followup_events':[]},f,[],20)['selected']==0


def test_plan_routes_and_continues_with_limit():
    s=service();s.hybrid_search.search.return_value=[]
    first=answer_question(s,payload('What should my team focus on today?'))
    assert first['plan']['selected']==20 and first['mode']=='rules_only'
    with patch('src.pandion_demo.insight_chat.route_question',return_value=dict(intent='daily_plan',age='keep',group='keep',limit=40)):
        second=answer_question(s,payload('Make that 40 patients',state=first['state']))
    third=answer_question(s,payload('Show supporting records',state=second['state']))
    assert third['plan']['selected']==40 and third['state']['limit']==40
    assert len(third['evidence'])==2  # One representative per selected tier.
    assert third['intent']=='daily_evidence' and third['mode']=='computed'


def test_generated_guidance_requires_real_record_and_sop():
    baseline=answer_question(service(),payload('What should my team focus on today?'))
    record=baseline['evidence'][0]['source']
    good={'answer':'Review existing priority flags with the responsible team and escalate unresolved allocation barriers. Track completed reviews and unresolved escalations.',
          'sources':[record,'SOP-TEST']}
    assert answer_question(service([good]),payload('What should my team focus on today?'))['mode']=='live_rag'
    good['sources']=['INVENTED','SOP-TEST']
    assert answer_question(service([good]),payload('What should my team focus on today?'))['mode']=='rules_only'


@pytest.mark.parametrize('question',['Why?','WHY','Why is that?','Why these patients?','Why them first?','Can you explain why?'])
def test_why_preserves_current_plan_without_router_call(question):
    s=service();s.hybrid_search.search.return_value=[]
    for limit in (20,40):
        out=answer_question(s,payload(question,state={'age':'all','group':'all','topic':'daily_plan','limit':limit}))
        assert out['intent']=='daily_why' and out['plan']['selected']==limit
        assert out['state']['limit']==limit
        assert 'longest waits' in out['answer'] and len(out['answer'].split())<=75
    s.llm.chat.assert_not_called()


def test_why_without_context_asks_for_clarification():
    out=answer_question(service(),payload('Why?'))
    assert out['mode']=='clarification' and 'plan' not in out


def test_live_why_is_cited_and_long_explanations_fall_back():
    p=payload('Why?',state={'age':'all','group':'all','topic':'daily_plan','limit':20})
    base=answer_question(service(),p)
    reply={'answer':'Existing priority flags put this group ahead of routine work. Within the group, the longest waits are reviewed first.',
           'sources':[base['evidence'][0]['source'],'SOP-TEST']}
    out=answer_question(service([reply]),p)
    assert out['intent']=='daily_why' and out['mode']=='live_rag'
    reply['answer']='word '*76
    out=answer_question(service([reply]),p)
    assert out['mode']=='rules_only' and len(out['answer'].split())<=75
