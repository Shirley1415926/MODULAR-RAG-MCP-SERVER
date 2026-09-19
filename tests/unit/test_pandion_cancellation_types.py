from copy import deepcopy

import pytest

from src.pandion_demo.clinic_dataset import build_clinic_dataset
from src.pandion_demo.cancellation_types import type_response,type_comparison
from src.pandion_demo.insight_chat import answer_question
from tests.unit.test_pandion_insight_chat import service,payload
from tests.unit.test_pandion_cancellation_chat import F

QUESTION='Which appointment type contributed most to the increase?'


def test_time_clarification_preserves_task_and_followup_chain():
    s=service()
    ask=answer_question(s,payload(QUESTION,feedback_filters=F))
    assert ask['state']['pending_task']=='cancellation_types'
    out=answer_question(s,payload('Last 7 days',feedback_filters=F,state=ask['state']))
    assert out['intent']=='cancellation_types'
    assert sum(g['contribution_pp'] for g in out['type_breakdown'])==pytest.approx(out['comparison']['delta_pp'])
    evidence=answer_question(s,payload('Show supporting evidence',state=out['state'],feedback_filters=F))
    assert evidence['intent']=='cancellation_type_evidence'
    why=answer_question(s,payload('Why did cancellations increase in that group?',state=out['state'],feedback_filters=F))
    assert why['state']['type_focus'] in {'assessment','follow_up'}
    assert why['comparison']['current_period']==out['comparison']['current_period']
    ids={a['appointment_id']:a for a in build_clinic_dataset()['appointments']}
    for e in why['evidence']:
        assert ids[e['source']]['appointment_type']==why['state']['type_focus']
    for q in ['What should we do first?','Show supporting evidence']:
        next_out=answer_question(s,payload(q,state=why['state'],feedback_filters=F))
        assert next_out['comparison']['filters']['type']==why['state']['type_focus']


def test_existing_period_and_filtered_cohort_retained():
    f={**F,'segment':'new_patient'}
    original=answer_question(service(),payload('Compare cancellations in the last 30 days',feedback_filters=f))
    out=answer_question(service(),payload(QUESTION,state=original['state'],feedback_filters=F))
    assert out['comparison']['current_period']==original['comparison']['current_period']
    assert out['comparison']['filters']['segment']=='new_patient'
    assert sum(g['current_appointments'] for g in out['type_breakdown'])==out['comparison']['current_appointments']


def fixture(current,previous):
    ledger=deepcopy(build_clinic_dataset());template=ledger['appointments'][0];rows=[]
    for day,groups in [('2026-09-02',previous),('2026-09-09',current)]:
        for kind,(n,cancelled) in zip(['assessment','follow_up'],groups):
            for i in range(n):
                rows.append({**template,'appointment_id':f'{day}-{kind}-{i}','appointment_date':day,
                             'appointment_type':kind,'status':'cancelled' if i<cancelled else 'completed','cancellation_reason':'Financial Issues'})
    ledger['appointments']=rows
    return ledger


def test_contribution_is_not_highest_rate_or_raw_count():
    ledger=fixture([(10,5),(90,18)],[(10,5),(90,9)])
    out=type_response(service(),ledger,F,QUESTION)
    assert out['brief']['headline'].startswith('Follow-up contributed most')
    assert sum(g['contribution_pp'] for g in out['type_breakdown'])==pytest.approx(9)
    # Different overall volumes: verify exact all-appointment denominators.
    ledger=fixture([(100,10),(100,10)],[(10,5),(90,9)])
    total,groups=type_comparison(ledger,F)
    assert groups[0]['contribution_pp']==pytest.approx(0)
    assert sum(g['contribution_pp'] for g in groups)==pytest.approx(-4)


def test_tie_unchanged_decrease_and_missing_period():
    out=type_response(service(),fixture([(10,2),(10,2)],[(10,1),(10,1)]),F,QUESTION)
    assert 'equally' in out['answer'] and 'small-sample' in out['answer']
    out=type_response(service(),fixture([(10,1),(10,1)],[(10,1),(10,1)]),F,QUESTION)
    assert 'no overall' in out['answer']
    out=type_response(service(),fixture([(10,0),(10,1)],[(10,2),(10,1)]),F,QUESTION)
    assert 'decrease' in out['brief']['headline']
    out=type_response(service(),fixture([(10,1),(10,1)],[(0,0),(0,0)]),F,QUESTION)
    assert not out['comparison']['comparable']


def test_single_type_not_silently_broadened():
    out=type_response(service(),build_clinic_dataset(),{**F,'type':'assessment'},QUESTION)
    assert 'only Assessment' in out['answer'] and 'type_breakdown' not in out
    follow=answer_question(service(),payload('Why?',state=out['state'],feedback_filters=F))
    assert 'only Assessment' in follow['answer']


def test_model_paraphrase_routes_to_same_computation():
    s=service([{'intent':'cancellation_types','age':'keep','group':'keep'}])
    out=answer_question(s,payload('Which service contributed most?',state={'age':'all','group':'all','topic':'cancellation','cancellation_scope':F}))
    assert out['intent']=='cancellation_types'
