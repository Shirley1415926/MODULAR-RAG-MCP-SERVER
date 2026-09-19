import pytest

from src.pandion_demo.insight_chat import answer_question
from src.pandion_demo.cancellation_chat import cancellation_response
from src.pandion_demo.clinic_dataset import build_clinic_dataset
from tests.unit.test_pandion_insight_chat import service,payload
from tests.unit.test_pandion_cancellation_chat import F


@pytest.mark.parametrize('q,fragment',[
    ('How much profit did cancellations cost us in the last 7 days?','payments'),
    ('Why did cancellations increase for female patients in the last 7 days?','will not substitute'),
    ('Which appointment type contributed most among women in the last 7 days?','will not substitute'),
    ('Which clinician contributed most to the increase?','clinician groups'),
    ('Compare cancellations among students in the last 7 days','extra condition'),
    ('Why did no-shows increase last week?','different outcome'),
])
def test_boundaries_before_shortcuts_and_model(q,fragment):
    s=service();state={'age':'all','group':'all','topic':'cancellation','cancellation_scope':F}
    out=answer_question(s,payload(q,state=state))
    assert out['mode']=='unsupported' and fragment in out['answer']
    assert out['state']==state and out['evidence']==[] and 'comparison' not in out
    s.llm.chat.assert_not_called()


def test_pending_confirmation_does_not_drop_conditions():
    state={'age':'all','group':'all','pending_task':'cancellation_types','pending_period':F}
    out=answer_question(service(),payload('Last 30 days, only female patients',state=state))
    assert out['mode']=='unsupported' and out['state']==state


def test_rejection_does_not_poison_original_scope():
    s=service();first=answer_question(s,payload('Compare cancellations in the last 30 days'))
    rejected=answer_question(s,payload('What was the profit loss?',state=first['state']))
    resumed=answer_question(s,payload('Why?',state=rejected['state']))
    assert resumed['comparison']['current_period']==['2026-08-17','2026-09-15']


@pytest.mark.parametrize('answer',[
    'Preserve existing SOP conditions and methods.',
    'Apply hard constraints and return JSON with sources.',
])
def test_instruction_echo_falls_back_even_with_valid_citations(answer):
    ledger=build_clinic_dataset()
    first=cancellation_response(service(),ledger,F,'cancellation_analysis','why')
    record=first['evidence'][0]['source']
    s=service([{'answer':answer,'sources':[record,'SOP-TEST']}])
    s.hybrid_search.search.return_value[0].metadata['section']='cancellation'
    out=cancellation_response(s,ledger,F,'cancellation_action','What should we do first?')
    assert out['mode']=='rules_only'
    assert 'SOP' not in out['answer'] and 'missing cancellation reasons' in out['answer']
