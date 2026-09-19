from copy import deepcopy
from src.pandion_demo.allocation_analysis import allocation_context


def test_each_constraint_and_age_bucket():
    slot={'slot_id':'S1','date':'2026-09-18','role':'Psychologist','clinician_id':'C1','appointment_type':'follow_up','start_minute':540}
    row={'appointment_id':'A1','patient_id':'P1','clinician_role':'Psychologist','clinician_id':'C1','followup_due':'2026-09-10'}
    ledger={'slots':[slot],'appointments':[],'patients':[{'patient_id':'P1','preferred_time':'morning'}]}
    f={'start':'2026-09-16','end':'2026-10-13'}
    def result(d,r=row):return allocation_context(d,[r],f)['records'][0]
    assert result(ledger)['blocker']=='ready'
    assert result(ledger)['age_bucket']=='1–7 days'
    for field,value,expected in [('role','Coaching','capacity'),('clinician_id','C2','continuity'),('appointment_type','assessment','type'),('start_minute',780,'time')]:
        d=deepcopy(ledger);d['slots'][0][field]=value
        assert result(d)['blocker']==expected
    d=deepcopy(ledger);d['appointments']=[{'slot_id':'S1','status':'confirmed'}]
    assert result(d)['blocker']=='capacity'
    for due,bucket in [('2026-09-15','upcoming'),('2026-09-08','1–7 days'),('2026-09-07','8–30 days'),('2026-08-16','8–30 days'),('2026-08-15','Over 30 days')]:
        assert result(ledger,dict(row,followup_due=due))['age_bucket']==bucket


def test_outside_window_not_counted_and_shared_slots_not_assigned():
    ledger={'slots':[{'slot_id':'S1','date':'2026-09-18','role':'Coaching','clinician_id':'C1','appointment_type':'assessment','start_minute':540}], 'appointments':[], 'patients':[]}
    rows=[{'referral_id':f'R{i}','patient_id':f'P{i}','role':'Coaching','appointment_type':'assessment','preferred_time':'any'} for i in range(2)]
    result=allocation_context(ledger,rows,{'start':'2026-09-16','end':'2026-09-20'})
    assert result['blockers']=={'ready':2}
    assert result['investigation'][0]['support']==[]
    assert result['investigation'][0]['counter']==['R0','R1']
    assert result['workflow_cases']==[]
    assert {r['earliest_slot'] for r in result['records']}=={'S1'}
    assert allocation_context(ledger,rows,{'start':'2026-09-19','end':'2026-09-20'})['blockers']=={'capacity':2}
