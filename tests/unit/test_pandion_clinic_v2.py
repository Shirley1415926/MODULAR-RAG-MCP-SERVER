"""Ledger invariants, not screenshots of plausible-looking totals."""
import sqlite3
from collections import Counter

from src.pandion_demo.clinic_dataset import build_clinic_dataset, write_database
from src.pandion_demo.clinic_knowledge import feedback_records
from src.pandion_demo.feedback_analytics import FeedbackAnalytics
from src.pandion_demo.operational_data import aggregate_feedback_dashboard


def test_scale_and_foreign_keys(tmp_path):
    d = build_clinic_dataset()
    assert len(d["patients"]) == 1800
    assert len(d["clinicians"]) == 33
    assert Counter(c["role"] for c in d["clinicians"]) == {"Psychiatrist":12,"Paediatrician":6,"Psychologist":10,"Coaching":3,"Allied Service":2}
    path = tmp_path / "clinic.sqlite3"
    write_database(path)
    with sqlite3.connect(path) as db:
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
        assert db.execute("SELECT COUNT(*) FROM appointments").fetchone()[0] == len(d["appointments"])


def test_money_and_status_partition():
    d=build_clinic_dataset()
    for a in d["appointments"]:
        assert a["status_group"] in {"confirmed","cancelled","rescheduled"}
        assert a["service_revenue_cents"] == (100*a["fee_aud"] if a["status"]=="completed" else 0)
        assert a["cancellation_fee_cents"] >= 0
        if a["status"] != "cancelled":
            assert a["cancellation_fee_cents"] == 0
        if a["status"]=="cancelled" and a["appointment_date"]<="2026-09-15":
            fraction=1 if a["cancellation_notice_hours"]<24 else .5 if a["cancellation_notice_hours"]<48 else 0
            assert a["cancellation_fee_cents"] == int(a["fee_aud"]*fraction)*100
    assert sum(Counter(a["status_group"] for a in d["appointments"]).values())==len(d["appointments"])


def test_slot_patient_and_survey_consistency():
    d=build_clinic_dataset()
    slots={s["slot_id"]:s for s in d["slots"]}
    appts={a["appointment_id"]:a for a in d["appointments"]}
    assert len({a["slot_id"] for a in appts.values()})==len(appts)
    assert len({(a["patient_id"],a["appointment_date"]) for a in appts.values()})==len(appts)
    assert len({(s["clinician_id"],s["date"],s["start_minute"]) for s in slots.values()})==len(slots)
    for a in appts.values():
        s=slots[a["slot_id"]]
        assert a["clinician_id"]==s["clinician_id"] and a["duration_minutes"]==s["duration_minutes"]
        assert a["modality"]=="telehealth"
    for f in d["feedback"]:
        a=appts[f["appointment_id"]]
        assert f["patient_id"]==a["patient_id"] and f["date"]==a["appointment_date"]
        assert f["date"]<="2026-09-15"
        assert f["quality"] is None if a["status"]!="completed" else 1<=f["quality"]<=5


def test_reasons_never_change_the_denominator_and_empty_means_missing():
    rows=build_clinic_dataset()["appointments"]
    all_rows=aggregate_feedback_dashboard(rows)
    selected=aggregate_feedback_dashboard(rows,cancellation_reason="Financial Issues")
    assert selected["total_appointments"]==all_rows["total_appointments"]
    assert selected["cancellation_total"]<=all_rows["cancellation_total"]
    assert selected["no_show_total"]==all_rows["no_show_total"]
    empty=aggregate_feedback_dashboard(rows,clinician="not a clinician")
    assert empty["cancellation_rate"] is None
    assert empty["cancellation_reasons"]==[0]*5


def test_live_feedback_equals_dashboard_ledger():
    d=build_clinic_dataset()
    records=feedback_records()
    result=FeedbackAnalytics(records).analyse({"start_date":"2026-09-09","end_date":"2026-09-15"})
    assert result["total_feedback"]==sum("2026-09-09"<=r["date"]<="2026-09-15" for r in d["feedback"])
    assert sum(t["count"] for t in result["themes"])==result["total_feedback"]
    result=FeedbackAnalytics(records).analyse({"clinician":"CLN-001","patient_segment":"high_risk"})
    assert result["total_feedback"]==sum(r["date"]>="2026-09-09" and r["clinician_id"]=="CLN-001" and r["high_risk"] for r in d["feedback"])


def test_queue_has_no_existing_future_booking():
    d=build_clinic_dataset()
    future={a["patient_id"] for a in d["appointments"] if a["status"]=="confirmed" and a["appointment_date"]>"2026-09-15"}
    assert not future.intersection(r["patient_id"] for r in d["referrals"])
