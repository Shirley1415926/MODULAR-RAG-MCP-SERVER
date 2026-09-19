"""Deterministic availability diagnostics; not clinical suitability or causal attribution."""
from collections import Counter
from datetime import date

from src.pandion_demo.clinic_dataset import ANCHOR
from src.pandion_demo.followup_evidence import followup_cases


def allocation_context(ledger, records, filters):
    start, end = filters.get('start'), filters.get('end')
    if not start or not end or date.fromisoformat(end) < date.fromisoformat(start):
        raise ValueError('Allocation requires a valid date range')
    occupied = {r['slot_id'] for r in ledger['appointments'] if r['status'] in {'confirmed','completed','no_show'}}
    free = [s for s in ledger['slots'] if start <= s['date'] <= end and s['slot_id'] not in occupied
            and (filters.get('role','All Roles') == 'All Roles' or s['role'] == filters['role'])]
    patients = {r['patient_id']:r for r in ledger['patients']}
    cases = followup_cases(ledger, records, ANCHOR)
    case_map = {c['source']:c for c in cases}
    details = []
    for r in records:
        followup = bool(r.get('followup_due'))
        role, kind = r.get('role') or r.get('clinician_role'), 'follow_up' if followup else r.get('appointment_type')
        preferred = r.get('preferred_time') or patients.get(r['patient_id'],{}).get('preferred_time')
        case = case_map.get(r.get('appointment_id'))
        if case and case['finding'] == 'time_mismatch':
            preferred = case['events'][-1]['available_period']
        role_slots = [s for s in free if s['role']==role]
        continuity = [s for s in role_slots if not r.get('clinician_id') or s['clinician_id']==r['clinician_id']]
        typed = [s for s in continuity if s['appointment_type']==kind]
        matches = sorted([s for s in typed if preferred=='any' or preferred=='morning' and s['start_minute']<720
                          or preferred=='afternoon' and s['start_minute']>=720],key=lambda s:(s['date'],s['start_minute']))
        blocker = ('capacity' if not role_slots else 'continuity' if not continuity else 'type' if not typed
                   else 'unknown' if preferred not in {'any','morning','afternoon'} else 'time' if not matches else 'ready')
        overdue = (ANCHOR-date.fromisoformat(r['followup_due'])).days if followup else None
        bucket = ('referral' if overdue is None else 'upcoming' if overdue<=0 else '1–7 days' if overdue<=7
                  else '8–30 days' if overdue<=30 else 'Over 30 days')
        details.append({'source':r.get('referral_id') or r['appointment_id'],'blocker':blocker,'age_bucket':bucket,
                        'matching_slots':len(matches),'earliest_slot':matches[0]['slot_id'] if matches else None})
    ids = lambda keys: [r['source'] for r in details if r['blocker'] in keys]
    investigation = [
        {'id':'availability', 'status':'checked' if details else 'insufficient_data',
         'support':ids({'capacity','continuity','type','time'}), 'counter':ids({'ready'}), 'unknown':ids({'unknown'})},
    ]
    return {'workflow_cases':cases, 'workflow_counts':dict(Counter(c['finding'] for c in cases)),
            'investigation': investigation, 'blockers':dict(Counter(r['blocker'] for r in details)),
            'age_buckets':dict(Counter(r['age_bucket'] for r in details)), 'records':details,
            'check_order':['service capacity','original clinician availability','appointment type','time preference'],
            'limits':'All workflow events are synthetic demo fixtures. Latest event determines the current recorded state, not the entire historical cause. No recorded reply is not proof of no reply. External booking is patient-reported, not independently confirmed. Shared slots are not reservations. No clinical suitability assessment.'}
