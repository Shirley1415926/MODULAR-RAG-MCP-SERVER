from collections import Counter
from copy import deepcopy

from src.pandion_demo.clinic_dataset import ANCHOR, build_clinic_dataset
from src.pandion_demo.followup_evidence import followup_cases


def test_generated_event_links_and_coverage():
    ledger = build_clinic_dataset()
    appointments = {a['appointment_id']:a for a in ledger['appointments']}
    events = {e['event_id']:e for e in ledger['followup_events']}
    assert len(events) == len(ledger['followup_events'])
    for e in events.values():
        a = appointments[e['appointment_id']]
        assert e['synthetic'] == 1 and e['patient_id'] == a['patient_id']
        assert a['appointment_date'] <= e['date'] <= str(ANCHOR)
        if e['reply_to']:
            previous = events[e['reply_to']]
            assert previous['appointment_id'] == e['appointment_id'] and previous['date'] < e['date']
    cases = followup_cases(ledger, list(appointments.values()), ANCHOR)
    counts = Counter(c['finding'] for c in cases)
    assert all(counts[k] > 0 for k in ['time_mismatch','no_reply_recorded','external_report','active_need','missing_history'])
    for c in cases:
        assert set(c['evidence_ids']) <= {e['event_id'] for e in c['events']}


def test_latest_event_supersedes_prior_obstacle_and_scope_is_strict():
    row = {'appointment_id':'A','patient_id':'P','appointment_date':'2026-08-01','followup_due':'2026-09-05'}
    offer = dict(event_id='E1',appointment_id='A',patient_id='P',date='2026-09-10',kind='offer_sent',offered_period='morning')
    reply = dict(event_id='E2',appointment_id='A',patient_id='P',date='2026-09-11',kind='offer_declined',reply_to='E1',available_period='afternoon')
    ledger = {'followup_events':[offer,reply]}
    def result(d): return followup_cases(d,[row],ANCHOR)[0]
    assert result(ledger)['finding'] == 'time_mismatch'
    changed = deepcopy(ledger)
    changed['followup_events'].append(dict(offer,event_id='E3',date='2026-09-12',offered_period='afternoon'))
    assert result(changed)['finding'] == 'no_reply_recorded'
    changed['followup_events'].append(dict(offer,event_id='E4',date='2026-09-13',kind='patient_reply'))
    assert result(changed)['finding'] == 'needs_review'
    for field,value in [('patient_id','other'),('appointment_id','other'),('date','2026-09-16'),('date','2026-07-01')]:
        assert result({'followup_events':[dict(offer,**{field:value})]})['finding']=='missing_history'
    assert result({'followup_events':[dict(reply,reply_to='missing')]})['finding']=='needs_review'
    assert result({'followup_events':[offer,dict(reply,available_period='morning')]})['finding']=='needs_review'
    assert followup_cases(ledger,[],ANCHOR)==[]
