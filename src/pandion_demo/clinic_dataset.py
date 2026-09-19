"""One reproducible, entirely fictional clinic ledger. No model/API generates totals."""
from __future__ import annotations

import json
import random
import sqlite3
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path
from src.pandion_demo.followup_evidence import build_followup_events

ANCHOR = date(2026, 9, 15)
SEED = 20260917
ROLES = {"Psychiatrist": 12, "Paediatrician": 6, "Psychologist": 10, "Coaching": 3, "Allied Service": 2}
REASONS = ["Emergency / Unforeseen Obligations", "Change of Mind", "Financial Issues", "Patient Anxiety / Resistance", "Unknown"]
THEMES = {
    "care_quality": ("Care quality", "positive", "The clinician listened carefully and explained my care plan clearly."),
    "convenience": ("Telehealth convenience", "positive", "Joining from home made attending easier; the video link worked well."),
    "booking": ("Easy booking", "positive", "I found a suitable appointment and the booking steps were straightforward."),
    "rescheduling": ("Rescheduling difficulty", "negative", "Changing my appointment took too many steps; the rescheduling link was hard to find."),
    "reminders": ("Reminder clarity", "negative", "The reminder was unclear and I was not sure which appointment time was current."),
    "waiting": ("Waiting for a suitable slot", "negative", "It took longer than I expected to find a time that fitted my schedule."),
    "cost": ("Affordability", "negative", "The out-of-pocket cost made it difficult to continue with appointments."),
}
COMMENT_VARIANTS = {
    "care_quality": ["My questions were taken seriously and the next steps were explained in plain language.", "I did not feel rushed. The clinician checked that I understood the plan.", "The written summary helped me remember what we had discussed."],
    "convenience": ["Not having to travel meant I could fit the session around work.", "The video appointment saved a long trip and I could join from a quiet room.", "I appreciated being able to attend from home without arranging transport."],
    "booking": ["The confirmation email arrived promptly and showed the appointment time clearly.", "Booking a review online was straightforward this time.", "Reception helped me find a slot that worked with my other commitments."],
    "rescheduling": ["I had to contact reception because I could not work out how to move the booking online.", "When my work roster changed, finding the link to change my appointment was difficult.", "I wanted another time but the email did not make the rescheduling steps clear."],
    "reminders": ["I was unsure whether the reminder showed the original time or the changed time.", "I checked my inbox too late and would have appreciated a clearer reminder.", "The reminder did not stand out from the other emails about the booking."],
    "waiting": ["The available times were hard to fit around my working hours.", "I needed an afternoon appointment and could not find a suitable opening soon.", "I would appreciate seeing more suitable appointment options before committing."],
    "cost": ["The fee was difficult to manage alongside my other expenses.", "I needed more time to budget for the next session.", "I would like the total out-of-pocket cost to be clearer before booking."],
}


@lru_cache(maxsize=1)
def build_clinic_dataset():
    rng = random.Random(SEED)
    first = ["Avery", "Blake", "Cameron", "Devon", "Emerson", "Harper", "Indigo", "Jordan", "Kai", "Logan", "Morgan"]
    last = ["Adams", "Bennett", "Chen", "Evans", "Foster", "Hayes", "Ibrahim", "Kaur", "Lewis", "Nguyen", "Reed"]
    clinicians = []
    for role, count in ROLES.items():
        for _ in range(count):
            i = len(clinicians)
            title = "Dr. " if role in ("Psychiatrist", "Paediatrician") else ""
            # Public psychology/therapy category includes both psychologists and therapists.
            subtype = ("Psychologist" if i - 18 < 4 else "Therapist") if role == "Psychologist" else role
            clinicians.append(dict(id=f"CLN-{i+1:03}", name=title + first[i % 11] + " " + last[(i*3+i//11)%11], role=role,
                                   qualification=subtype, workdays=sorted(rng.sample(range(5), 3)), synthetic=1))
    patients = []
    for i in range(1800):
        c = clinicians[i % len(clinicians)]
        patients.append(dict(patient_id=f"PAT-{i+1:04}", display_name=f"Synthetic patient {i+1:04}",
                             clinician_id=c["id"], role=c["role"], age=rng.randint(6,16) if c["role"] == "Paediatrician" else rng.randint(18,65),
                             registered_date=(ANCHOR-timedelta(days=rng.randint(0,210))).isoformat(),
                             prior_care=int(rng.random()<.45),
                             high_risk=int(rng.random()<.16), preferred_time=rng.choice(["any", "any", "morning", "afternoon"]), synthetic=1))
    for p in patients:
        if p["prior_care"]:
            p["registered_date"] = (ANCHOR-timedelta(days=240)).isoformat()
    pools = {c["id"]: [p for p in patients if p["clinician_id"] == c["id"]] for c in clinicians}
    slots, appointments, feedback = [], [], []
    seen, last_seen = {p["patient_id"] for p in patients if p["prior_care"]}, {}
    pending_second = set()
    start = ANCHOR - timedelta(days=179)
    for offset in range(236):
        day = start + timedelta(days=offset)
        ahead = (day - ANCHOR).days
        incident = date(2026,9,9) <= day <= date(2026,9,12)
        # Public holidays/leave are fictional, not claimed company schedules.
        for ci, c in enumerate(clinicians):
            if day.weekday() not in c["workdays"] or rng.random()<.045:
                continue
            for hour in (9,10,13,14):
                initial_demand = any(p["patient_id"] not in seen and p["registered_date"]<=day.isoformat()
                                     and (day-last_seen.get(p["patient_id"], date(2000,1,1))).days>=14
                                     and (p["preferred_time"]=="any" or (p["preferred_time"]=="morning")== (hour<12)) for p in pools[c["id"]])
                kind = "assessment" if hour in (9,13) and initial_demand else "follow_up"
                duration = (60 if kind == "assessment" else 30) if c["role"] in ("Psychiatrist", "Paediatrician") else 50
                slot = dict(slot_id=f"SLOT-{len(slots)+1:05}", date=day.isoformat(), clinician_id=c["id"], role=c["role"],
                            appointment_type=kind, start_minute=hour*60, duration_minutes=duration, synthetic=1)
                slots.append(slot)
                occupancy = [.89,.83,.76,.69,.72][list(ROLES).index(c["role"])]
                occupancy *= .83 + .04*(ci % 6)
                if ahead>0:
                    occupancy *= max(.23, 1-ahead/74)
                if rng.random()>occupancy:
                    continue
                eligible = [p for p in pools[c["id"]] if (p["prior_care"] or p["registered_date"]<=day.isoformat()) and (day-last_seen.get(p["patient_id"], date(2000,1,1))).days >= 14
                            and (p["preferred_time"]=="any" or (p["preferred_time"]=="morning") == (hour<12))
                            and ((p["patient_id"] not in seen) == (kind=="assessment"))]
                if not eligible:
                    continue
                p = rng.choice(eligible)
                pid = p["patient_id"]
                cancel_prob = .085 + (.025 if p["high_risk"] else 0) + (.13 if incident else 0)
                no_prob = .03 + (.05 if p["high_risk"] else 0) + (.10 if incident else 0)
                draw = rng.random()
                status = "cancelled" if draw<cancel_prob else "rescheduled" if draw<cancel_prob+.065 else "no_show" if ahead<=0 and draw<cancel_prob+.065+no_prob else "completed" if ahead<=0 else "confirmed"
                group = status if status in ("cancelled", "rescheduled") else "confirmed"
                fee = ({"assessment":910,"follow_up":380} if c["role"]=="Psychiatrist" else
                       {"assessment":720,"follow_up":330} if c["role"]=="Paediatrician" else
                       {"assessment":200,"follow_up":200} if c["qualification"]=="Psychologist" else
                       {"assessment":130,"follow_up":130} if c["qualification"]=="Therapist" else
                       {"assessment":220,"follow_up":220} if c["role"]=="Coaching" else {"assessment":190,"follow_up":190})[kind]
                service_code = "initial_assessment" if kind=="assessment" else "ongoing_review"
                if kind=="follow_up" and pid in pending_second:
                    fee = 680 if c["role"]=="Psychiatrist" else 430
                    service_code = "second_assessment"
                notice = rng.choice([12,36,72,96]) if status=="cancelled" else None
                cancellation_fee = int(fee * (1 if notice<24 else .5 if notice<48 else 0)) if notice is not None and ahead<=0 else 0
                a = dict(appointment_id=f"APT-{len(appointments)+1:05}", slot_id=slot["slot_id"], appointment_date=day.isoformat(),
                         start_minute=hour*60, duration_minutes=duration, patient_id=pid, clinician_id=c["id"], clinician_name=c["name"],
                         clinician_role=c["role"], patient_segment="new_patient" if pid not in seen else "continuing_patient", high_risk=p["high_risk"],
                         appointment_type=kind, service_code=service_code, modality="telehealth", status=status, status_group=group,
                         cancellation_reason=rng.choices(REASONS,[43,16,15,11,15])[0] if status=="cancelled" else "",
                         no_show_reason=rng.choices(["Reminder Missed","Schedule Conflict","Unknown"],[70 if incident else 42,30,18])[0] if status=="no_show" else "",
                         fee_aud=fee, service_revenue_cents=fee*100 if status=="completed" else 0, cancellation_fee_cents=cancellation_fee*100,
                         cancellation_notice_hours=notice, followup_due=(day+timedelta(days=35)).isoformat() if status=="completed" and rng.random()<.35 else None,
                         synthetic=1)
                appointments.append(a)
                last_seen[pid] = day
                if status in ("completed", "confirmed"):
                    seen.add(pid)
                    if kind=="assessment" and c["role"] in ("Psychiatrist","Paediatrician"):
                        pending_second.add(pid)
                    elif service_code=="second_assessment":
                        pending_second.discard(pid)
                if ahead<=0 and rng.random() < (.39 if status=="completed" else .30):
                    keys = list(THEMES)
                    weights = [35,23,14,10,6,7,5] if status=="completed" else [0,0,8,35,25,19,13]
                    if incident:
                        weights[3] += 30
                        weights[4] += 40
                    key = rng.choices(keys, weights)[0]
                    label, sentiment, comment = THEMES[key]
                    comment = ([comment] + COMMENT_VARIANTS[key])[len(feedback) % 4]
                    low = sentiment=="negative"
                    feedback.append(dict(record_id=f"FB-{len(feedback)+1:05}", appointment_id=a["appointment_id"], date=day.isoformat(),
                                         patient_id=pid, clinician=c["name"], clinician_id=c["id"], patient_segment=a["patient_segment"], high_risk=p["high_risk"],
                                         appointment_type=kind, theme=key, theme_label=label, sentiment=sentiment, text=comment,
                                         overall=rng.choice([2,3,3,4] if low else [4,4,5,5]), booking=rng.choice([1,2,3] if key in ("booking","rescheduling","reminders") and low else [3,4,5]),
                                         waiting=rng.choice([1,2,3] if key=="waiting" else [3,4,5]),
                                         experience=rng.choice([3,4,5]) if status=="completed" else None,
                                         quality=rng.choice([4,5,5]) if status=="completed" else None, synthetic=1))
                    # Separate simulated questionnaire item; do not alter the existing ledger RNG.
                    feedback[-1]["complaint_impact_score"] = random.Random(SEED+100000+len(feedback)).choices(
                        [1,2,3,4,5],weights=[3,8,25,42,22] if key in ("rescheduling","waiting") else [5,20,40,25,10]
                    )[0] if low else None
    future = {a["patient_id"] for a in appointments if a["appointment_date"]>ANCHOR.isoformat() and a["status"]=="confirmed"}
    refs = []
    for p in rng.sample([p for p in patients if p["patient_id"] not in future], 120):
        completed = any(a["patient_id"]==p["patient_id"] and a["status"]=="completed" for a in appointments)
        refs.append(dict(referral_id=f"REF-{len(refs)+1:04}",patient_id=p["patient_id"], role=p["role"], clinician_id=p["clinician_id"] if completed else "",
                         appointment_type="follow_up" if completed else "assessment", preferred_time=p["preferred_time"],
                         created_date=(ANCHOR-timedelta(days=rng.randint(1,24))).isoformat(), priority="high" if p["high_risk"] else "routine", synthetic=1))
    # Restore the prototype's lifecycle chart using explicit, auditable events.
    # These are demo engagement rules, not clinical discharge decisions.
    lifecycle = []
    for p in patients:
        visits = [a for a in appointments if a["patient_id"]==p["patient_id"] and a["status"]=="completed"]
        previous = start-timedelta(days=1) if p["prior_care"] else None
        source = "baseline_prior_care" if previous else ""
        for visit in visits + [None]:
            current = date.fromisoformat(visit["appointment_date"]) if visit else ANCHOR+timedelta(days=1)
            events = []
            if previous:
                for days, kind in [(45,"inactivity"),(90,"inactivated")]:
                    event_date = previous+timedelta(days=days)
                    if event_date < current and event_date<=ANCHOR:
                        events.append((kind,event_date,source))
            if visit:
                if previous is None:
                    events.append(("new",current,visit["appointment_id"]))
                elif (current-previous).days>45:
                    events.append(("reactivated",current,visit["appointment_id"]))
            for kind, event_date, evidence_id in events:
                lifecycle.append(dict(event_id=f"LIFE-{len(lifecycle)+1:05}",patient_id=p["patient_id"],clinician_id=p["clinician_id"],
                                      role=p["role"],date=event_date.isoformat(),kind=kind,source_id=evidence_id,synthetic=1))
            if visit:
                previous,source=current,visit["appointment_id"]
    return dict(patients=patients,clinicians=clinicians,slots=slots,appointments=appointments,feedback=feedback,referrals=refs,lifecycle_events=lifecycle,
                followup_events=build_followup_events(appointments, ANCHOR))


def payload():
    d = build_clinic_dataset()
    return dict(metadata=dict(synthetic=True, schema_version=2, reference_date=ANCHOR.isoformat(), history_days=180, future_days=56,
                              patient_count=len(d["patients"]), clinician_count=len(d["clinicians"]), appointment_count=len(d["appointments"]),
                              currency="AUD", timezone="Australia/Sydney", seed=SEED,
                              scale_note="33 fictional clinicians mirror public team categories; 1,800 patients and all workloads are modelling assumptions, not company metrics.",
                              sources=["https://www.pandionhealth.com.au/team/", "https://www.pandionhealth.com.au/pricing/", "https://www.pandionhealth.com.au/financial-consent-and-cancellation-policy/"]), **d)


def write_assets(root):
    root = Path(root)
    root.mkdir(parents=True,exist_ok=True)
    encoded = json.dumps(payload(),ensure_ascii=False,separators=(",",":"))
    (root/"synthetic_operations.json").write_text(encoded,encoding="utf-8")
    (root/"synthetic_operations.js").write_text("window.PANDION_SYNTHETIC_OPERATIONS="+encoded+";\n",encoding="utf-8")


def write_database(path):
    """Versioned generated database; callers select an explicit output path."""
    path = Path(path)
    path.parent.mkdir(parents=True,exist_ok=True)
    dataset = build_clinic_dataset()
    ids = dict(patients="patient_id",clinicians="id",slots="slot_id",appointments="appointment_id",feedback="record_id",referrals="referral_id",lifecycle_events="event_id",followup_events="event_id")
    refs = {"slots":[("clinician_id","clinicians","id")], "appointments":[("slot_id","slots","slot_id"),("patient_id","patients","patient_id"),("clinician_id","clinicians","id")],
            "feedback":[("appointment_id","appointments","appointment_id")],"referrals":[("patient_id","patients","patient_id")],
            "followup_events":[("appointment_id","appointments","appointment_id"),("patient_id","patients","patient_id")],
            "lifecycle_events":[("patient_id","patients","patient_id"),("clinician_id","clinicians","id")]}
    with sqlite3.connect(path) as db:
        db.execute("PRAGMA foreign_keys=ON")
        for table in reversed(list(dataset)):
            db.execute(f'DROP TABLE IF EXISTS "{table}"')
        for table, rows in dataset.items():
            columns = list(rows[0])
            schema = [f'"{k}" '+("INTEGER" if any(isinstance(r[k],int) for r in rows) else "TEXT")+(" PRIMARY KEY" if k==ids[table] else "") for k in columns]
            schema += [f'FOREIGN KEY ("{col}") REFERENCES "{target}"("{pk}")' for col,target,pk in refs.get(table,[])]
            db.execute(f'CREATE TABLE "{table}" ('+",".join(schema)+")")
            values = [tuple(json.dumps(r[k]) if isinstance(r[k],list) else r[k] for k in columns) for r in rows]
            db.executemany(f'INSERT INTO "{table}" VALUES ('+",".join("?" for _ in columns)+")",values)
        db.execute("CREATE INDEX idx_appointment_scope ON appointments(appointment_date,clinician_id,status_group,appointment_type)")
        db.execute("CREATE INDEX idx_feedback_date ON feedback(date,clinician_id)")
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
    return {"database_path":str(path.resolve()),**{k:len(v) for k,v in dataset.items()}}
