import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from src.pandion_demo.operational_review import review_priorities
from src.pandion_demo.operational_review import reason_context
from src.pandion_demo.operational_review import valid_action_plan
from src.pandion_demo.clinic_dataset import build_clinic_dataset


def fixture():
    row = build_clinic_dataset()["referrals"][0]
    payload = {"scope": "allocation", "filters": {"start":"2026-09-16","end":"2026-10-13"}, "candidates": [{
        "id": "allocation-ready", "title": "One priority referral", "impact": "Candidate slot available",
        "action": "Confirm availability", "source_ids": [row["referral_id"]]}]}
    policy = SimpleNamespace(metadata={"record_type": "sop", "section": "allocation"})
    item = {"id": "allocation-ready", "interpretation": "A match needs confirmation.",
            "recommendation": "Confirm availability with staff.", "sources": ["SOP-003"]}
    service = SimpleNamespace(hybrid_search=SimpleNamespace(search=Mock(return_value=[policy])),
                              llm=SimpleNamespace(chat=Mock(return_value=SimpleNamespace(content=json.dumps({"items": [item]}),model="test"))),
                              _evidence_item=lambda r: {"source":"SOP-003", "quote":"Confirm suitability before allocation"})
    return payload, service, item


def test_grounded_review_reloads_original_records_and_cites_policy():
    payload, service, _ = fixture()
    result = review_priorities(service, payload)
    assert result["generation_mode"] == "live_rag"
    assert result["items"][0]["sources"] == ["SOP-003"]
    prompt = json.loads(service.llm.chat.call_args.args[0][1].content)
    assert prompt["priorities"][0]["examples"][0]["record"]["patient_id"]


@pytest.mark.parametrize('action,expected', [
    ('Check delivery and confirmation of the existing offer.',True),
    ('Re-offer afternoon options and confirm receipt.',False),
    ('Send new appointment slots to the patient.',False),
    ('Resend the existing offer.',False),
])
def test_existing_offer_cannot_be_repeated(action,expected):
    context={'workflow_counts':{'no_reply_recorded':1},'workflow_cases':[{'finding':'no_reply_recorded','evidence_ids':['NEW-EVENT']}]}
    step={'group':'no_reply_recorded','why':'An invitation is already recorded.', 'action':action,
          'measure':'Confirmed appointments.','event_ids':['NEW-EVENT'],'sources':['SOP']}
    assert valid_action_plan([step],context,{'SOP'}) is expected
    step['event_ids']=['OLD-REFUSAL']
    assert not valid_action_plan([step],context,{'SOP'})


def test_workflow_context_reloads_events_not_client_claims():
    payload, service, _ = fixture()
    event = build_clinic_dataset()['followup_events'][0]
    payload['candidates'][0]['source_ids'] = [event['appointment_id']]
    payload['candidates'][0]['workflow_cases'] = [{'finding':'invented'}]
    review_priorities(service,payload)
    prompt = json.loads(service.llm.chat.call_args.args[0][1].content)
    analysis = prompt['priorities'][0]['verified_allocation_analysis']
    assert analysis['workflow_counts'] == {'time_mismatch':1}
    assert analysis['workflow_cases'][0]['evidence_ids'][0] == event['event_id']
    assert analysis['workflow_cases'][0]['events'][0] == event


@pytest.mark.parametrize('bad', [None,'group','event','policy','numbers','missing','duplicate','wrong_group_event'])
def test_overdue_plan_requires_grounded_group_and_citations(bad):
    payload, service, item = fixture()
    events = build_clinic_dataset()['followup_events']
    payload['candidates'][0].update(id='allocation-overdue',source_ids=[events[0]['appointment_id']])
    item['id']='allocation-overdue'
    step={'group':'time_mismatch','why':'A linked reply identifies a fixable time conflict.',
          'action':'Check afternoon slots and confirm a suitable offer with the patient.',
          'measure':'Confirmed bookings and vacant hours filled.',
          'event_ids':[events[0]['event_id'],events[1]['event_id']],'sources':['SOP-003']}
    item['action_plan']=[step]
    if bad=='group': step['group']='active_need'
    if bad=='event': step['event_ids']=['invented']
    if bad=='policy': step['sources']=['invented']
    if bad=='numbers': step['why']='Recover $1000 in profit.'
    if bad=='missing': del item['action_plan']
    if bad=='duplicate': item['action_plan'].append(dict(step))
    if bad=='wrong_group_event': step['event_ids']=[events[2]['event_id']]
    service.llm.chat.return_value.content=json.dumps({'items':[item]})
    result=review_priorities(service,payload)
    assert result['generation_mode']==('rules_only' if bad else 'live_rag')


@pytest.mark.parametrize("mutation", ["unknown_citation", "wrong_id", "missing_recommendation"])
def test_invalid_model_output_falls_back(mutation):
    payload, service, item = fixture()
    if mutation == "unknown_citation": item["sources"] = ["INVENTED"]
    if mutation == "wrong_id": item["id"] = "invented"
    if mutation == "missing_recommendation": del item["recommendation"]
    service.llm.chat.return_value.content = json.dumps({"items": [item]})
    assert review_priorities(service, payload)["generation_mode"] == "rules_only"


def test_missing_policy_or_failed_model_does_not_claim_ai_review():
    payload, service, _ = fixture()
    service.hybrid_search.search.return_value = []
    assert review_priorities(service, payload)["items"] == []
    service.llm.chat.assert_not_called()
    payload, service, _ = fixture()
    service.llm.chat.side_effect = RuntimeError("Unavailable")
    assert review_priorities(service, payload)["generation_mode"] == "rules_only"


def test_unknown_source_is_rejected_before_model_call():
    payload, service, _ = fixture()
    payload["candidates"][0]["source_ids"] = ["fake"]
    with pytest.raises(ValueError, match="Unknown ledger source"):
        review_priorities(service, payload)
    service.llm.chat.assert_not_called()


def test_server_reason_comparison_uses_complete_filtered_ledger():
    ledger = build_clinic_dataset()
    filters = {'start':'2026-09-09','end':'2026-09-15','clinician':'all','segment':'all','type':'all'}
    result = reason_context(ledger, filters, 'cancelled')
    assert result['current_outcomes'] == 43
    assert result['previous_outcomes'] == 29
    assert result['reasons'][0]['reason'] == 'Unknown'
    assert result['reasons'][0]['current'] == 10
    expected = 100*(43/298-29/292)
    assert sum(r['rate_contribution_pp'] for r in result['reasons']) == pytest.approx(expected)
    empty = reason_context(ledger, dict(filters, clinician='missing'), 'cancelled')
    assert empty['reasons'] == []


@pytest.mark.parametrize('valid', [True, False])
def test_comparison_is_included_in_generation_context(valid):
    payload, service, item = fixture()
    row = next(r for r in build_clinic_dataset()['appointments'] if r['status']=='cancelled')
    payload['scope']='feedback'
    payload['filters']={'start':'2026-09-09','end':'2026-09-15'}
    payload['candidates'][0].update(id='feedback-cancellation',source_ids=[row['appointment_id']])
    service.hybrid_search.search.return_value[0].metadata['section']='cancellation'
    item['id']='feedback-cancellation'
    if valid:
        item.update(why_prioritise='Missing reasons contribute most to the observed increase.',measure='Rebooking conversion and cancellation rate in the next comparable period.')
    service.llm.chat.return_value.content=json.dumps({'items':[item]})
    result=review_priorities(service,payload)
    assert result['generation_mode']==('live_rag' if valid else 'rules_only')
    prompt=json.loads(service.llm.chat.call_args.args[0][1].content)
    assert prompt['priorities'][0]['verified_reason_comparison']['current_outcomes']==43
