from copy import deepcopy
import pytest

from src.pandion_demo.clinic_dataset import build_clinic_dataset
from src.pandion_demo.cancellation_chat import cancellation_response
from src.pandion_demo.insight_chat import answer_question
from tests.unit.test_pandion_insight_chat import payload, service

F={'start':'2026-09-09','end':'2026-09-15','clinician':'all','type':'all','segment':'all'}


def test_explicit_period_question_overrides_dashboard_dates():
    q='Why did the cancellation rate change in the last 7 days compared with the previous 7 days?'
    out=answer_question(service(),payload(q,feedback_filters=F))
    assert out['comparison']['current_period']==['2026-09-09','2026-09-15']
    assert out['comparison']['previous_period']==['2026-09-02','2026-09-08']
    out=answer_question(service(),payload(q,feedback_filters={**F,'start':'2026-08-17'}))
    assert out['comparison']['current_period']==['2026-09-09','2026-09-15']


def test_default_parity_and_sum_of_contributions():
    out=cancellation_response(service(),build_clinic_dataset(),F,'cancellation_analysis','why')
    c=out['comparison']
    assert (c['current_outcomes'],c['current_appointments'],c['previous_outcomes'])==(43,298,29)
    assert sum(r['rate_contribution_pp'] for r in c['reasons'])==pytest.approx(c['delta_pp'])
    assert 'rose' in out['answer']
    assert all('current period' in e['text'] or 'previous period' in e['text'] for e in out['evidence'])


def test_followups_keep_cancellation_topic_and_filters():
    s=service()
    first=answer_question(s,payload('Why did the cancellation rate change in the last 7 days?',feedback_filters=F))
    for question,intent in [('Why?','cancellation_why'),('Give me the supporting evidence.','cancellation_evidence')]:
        out=answer_question(s,payload(question,feedback_filters=F,state=first['state']))
        assert out['intent']==intent and out['comparison']==first['comparison']
    s.llm.chat.assert_not_called()


def test_clarification_resume_and_followup_scope():
    s=service()
    ask=answer_question(s,payload('Why did cancellations change?',feedback_filters=F))
    assert ask['mode']=='clarification' and 'pending_period' in ask['state']
    confirmed=answer_question(s,payload('Yes',state=ask['state'],feedback_filters=F))
    assert confirmed['comparison']['current_period']==[F['start'],F['end']]
    changed=answer_question(s,payload('Last 30 days',state=ask['state'],feedback_filters=F))
    assert changed['comparison']['current_period']==['2026-08-17','2026-09-15']
    assert 'pending_period' not in changed['state']
    for q in ['Why?','Show supporting evidence','What should we do next?']:
        follow=answer_question(s,payload(q,state=changed['state'],feedback_filters=F))
        assert follow['comparison']==changed['comparison']


@pytest.mark.parametrize('q,current,previous',[
    ('Compare cancellations in the past 14 days',['2026-09-02','2026-09-15'],['2026-08-19','2026-09-01']),
    ('Why did cancellations change last week?',['2026-09-07','2026-09-13'],['2026-08-31','2026-09-06']),
    ('Compare cancellations last month',['2026-08-01','2026-08-31'],['2026-07-01','2026-07-31']),
    ('Compare cancellations 2026-09-01 to 2026-09-07 versus 2026-08-01 to 2026-08-07',['2026-09-01','2026-09-07'],['2026-08-01','2026-08-07']),
])
def test_period_variants(q,current,previous):
    out=answer_question(service(),payload(q,feedback_filters=F))
    assert out['comparison']['current_period']==current
    assert out['comparison']['previous_period']==previous


@pytest.mark.parametrize('q',[
    'Compare cancellations in the last 300 days',
    'Compare cancellations 2026-09-99 to 2026-09-15',
    'Compare cancellations 2026-09-10 to 2026-09-20',
    'Compare cancellations 2026-09-01 to 2026-09-07 versus 2026-09-05 to 2026-09-10',
    'Compare cancellations in the last 7 days versus the previous 30 days',
])
def test_bad_periods_clarify_without_running_analysis(q):
    out=answer_question(service(),payload(q,feedback_filters=F))
    assert out['mode']=='clarification' and 'comparison' not in out


def test_pending_cancel_topic_switch_and_no_data():
    ask=answer_question(service(),payload('Why did cancellations change?',feedback_filters=F))
    out=answer_question(service(),payload('Cancel',state=ask['state']))
    assert 'pending_period' not in out['state']
    out=answer_question(service(),payload('What should my team focus on today?',state=ask['state']))
    assert out['state']['topic']=='daily_plan' and 'pending_period' not in out['state']
    out=answer_question(service(),payload('Compare cancellations 2025-01-01 to 2025-01-07'))
    assert not out['comparison']['comparable']


def test_decrease_and_empty_periods_do_not_invent_increase():
    l=deepcopy(build_clinic_dataset())
    for r in l['appointments']:
        if F['start']<=r['appointment_date']<=F['end'] and r['status']=='cancelled':r['status']='completed'
    out=cancellation_response(service(),l,F,'cancellation_analysis','Why did cancellations increase?')
    assert 'fell' in out['answer'] and out['comparison']['delta_pp']<0
    l['appointments']=[r for r in l['appointments'] if r['appointment_date']<F['start']]
    assert not cancellation_response(service(),l,F,'cancellation_analysis','why')['comparison']['comparable']


@pytest.mark.parametrize('change',[{'end':'2026-09-16'},{'clinician':'FAKE'},{'segment':'FAKE'},{'start':'2026-09-18'}])
def test_bad_scope(change):
    with pytest.raises(ValueError):cancellation_response(service(),build_clinic_dataset(),{**F,**change},'cancellation_analysis','why')


def test_filtered_scope_and_cited_action():
    ledger=build_clinic_dataset();f={**F,'segment':'new_patient','type':'assessment'}
    out=cancellation_response(service(),ledger,f,'cancellation_analysis','why')
    matching=[r for r in ledger['appointments'] if f['start']<=r['appointment_date']<=f['end'] and r['patient_segment']=='new_patient' and r['appointment_type']=='assessment']
    assert out['comparison']['current_appointments']==len(matching)
    record=cancellation_response(service(),ledger,F,'cancellation_analysis','why')['evidence'][0]['source']
    s=service([{'answer':'Review the recorded cancellation reasons before choosing a rebooking intervention.','sources':[record,'SOP-TEST']}])
    s.hybrid_search.search.return_value[0].metadata['section']='cancellation'
    assert cancellation_response(s,ledger,F,'cancellation_action','next')['mode']=='live_rag'
    s=service([{'answer':'Invented evidence.','sources':['FAKE','SOP-TEST']}])
    s.hybrid_search.search.return_value[0].metadata['section']='cancellation'
    assert cancellation_response(s,ledger,F,'cancellation_action','next')['mode']=='rules_only'


def test_ties_unknown_and_unchanged_rate():
    ledger=deepcopy(build_clinic_dataset());template=ledger['appointments'][0]
    rows=[]
    for period,day in [('previous','2026-09-02'),('current','2026-09-09')]:
        for i in range(4):
            rows.append({**template,'appointment_id':f'{period}-{i}','appointment_date':day,
                         'status':'cancelled' if period=='current' and i<2 else 'completed',
                         'cancellation_reason':None if i==0 else 'Financial Issues'})
    ledger['appointments']=rows
    out=cancellation_response(service(),ledger,F,'cancellation_analysis','why')
    assert len(out['comparison']['leaders'])==2 and 'one of the largest' in out['answer']
    assert 'financial issues' in out['answer']
    out=cancellation_response(service(),ledger,F,'cancellation_action','next')
    assert out['answer'].startswith('Complete the missing')
    for r in rows:r['status']='completed'
    assert 'unchanged' in cancellation_response(service(),ledger,F,'cancellation_analysis','why')['answer']


def test_plain_brief_covers_known_reasons_and_evidence():
    out=cancellation_response(service(),build_clinic_dataset(),F,'cancellation_analysis','why')
    brief=out['brief']
    assert brief['headline'].startswith('Cancellation rate rose from')
    assert 'percentage points' not in out['answer'] and '→' not in out['answer']
    assert brief['next_step'].startswith('Ask the scheduling team')
    assert any('Among recorded reasons' in line for line in brief['findings'])
    assert any('no reason recorded' in line for line in brief['findings'])
    assert any('Unknown' not in e['text'] for e in out['evidence'])
    why=cancellation_response(service(),build_clinic_dataset(),F,'cancellation_why','why')
    assert why['brief']['headline']=='Why start there?'
    assert 'rather than guessing' in why['answer']
    assert 'total appointments' not in why['answer']
