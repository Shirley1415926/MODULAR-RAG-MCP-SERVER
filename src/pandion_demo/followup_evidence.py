"""Synthetic workflow events and conservative, event-linked findings.

Events are authored demo fixtures, not real clinical or company records.
Findings are derived from events; no root-cause label is stored in the ledger.
"""
from datetime import timedelta


def build_followup_events(appointments, anchor):
    latest = {}
    for a in sorted(appointments, key=lambda a: (a['appointment_date'], a['appointment_id'])):
        if a['status'] == 'completed' and a['appointment_date'] <= anchor.isoformat():
            latest[a['patient_id']] = a
    future = {a['patient_id'] for a in appointments if a['status'] == 'confirmed' and a['appointment_date'] > anchor.isoformat()}
    rows = sorted((a for a in latest.values() if a.get('followup_due') and a['followup_due'] < anchor.isoformat()
                   and a['patient_id'] not in future), key=lambda a: a['appointment_id'])
    events = []
    for i, a in enumerate(rows):
        def add(kind, offset, actor, note, **fields):
            e = dict(event_id=f"FUE-{len(events)+1:05}", appointment_id=a['appointment_id'], patient_id=a['patient_id'],
                     date=(anchor-timedelta(days=offset)).isoformat(), kind=kind, actor=actor, note=note,
                     reply_to='', offered_period='', available_period='', synthetic=1)
            e.update(fields)
            events.append(e)
            return e['event_id']
        scenario = i % 5
        if scenario in (0, 1):
            offer = add('offer_sent', 3, 'Scheduling coordinator', 'Morning follow-up options sent; no booking reserved.', offered_period='morning')
            if scenario == 0:
                add('offer_declined', 2, 'Patient', 'I cannot attend the morning options. Please offer an afternoon time.',
                    reply_to=offer, available_period='afternoon')
        elif scenario == 2:
            add('external_booking_reported', 2, 'Patient', 'I have arranged follow-up with another provider. Please check before sending more offers.')
        elif scenario == 3:
            add('care_need_confirmed', 1, 'Responsible clinician', 'Follow-up remains required; contact the patient to agree a suitable appointment.')
        # Fifth scenario intentionally has no imported workflow records.
    return events


def followup_cases(ledger, records, anchor):
    output = []
    for r in records:
        if not r.get('followup_due'):
            continue
        events = sorted((e for e in ledger.get('followup_events', []) if e['appointment_id'] == r['appointment_id']
                         and e['patient_id'] == r['patient_id'] and r['appointment_date'] <= e['date'] <= str(anchor)),
                        key=lambda e: (e['date'], e['event_id']))
        finding, evidence = 'missing_history', []
        if events:
            last = events[-1]
            offers = {e['event_id']:e for e in events[:-1] if e['kind'] == 'offer_sent'}
            offer = offers.get(last.get('reply_to'))
            if last['kind'] == 'offer_declined' and offer and offer.get('offered_period') in {'morning','afternoon'} and last.get('available_period') in {'morning','afternoon'} and offer['offered_period'] != last['available_period']:
                finding, evidence = 'time_mismatch', [offer['event_id'], last['event_id']]
            elif last['kind'] in {'offer_sent','external_booking_reported','care_need_confirmed'}:
                finding = {'offer_sent':'no_reply_recorded','external_booking_reported':'external_report','care_need_confirmed':'active_need'}[last['kind']]
                evidence = [last['event_id']]
            else:
                finding, evidence = 'needs_review', [last['event_id']]
        output.append(dict(source=r['appointment_id'], patient_id=r['patient_id'], finding=finding,
                           evidence_ids=evidence, events=events))
    return output
