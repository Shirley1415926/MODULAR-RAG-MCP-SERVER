"""Compatibility entry points for the unified clinic dataset."""
import json
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import Any
from src.pandion_demo.clinic_dataset import ANCHOR as DEMO_REFERENCE_DATE, build_clinic_dataset, payload, write_database

def build_operational_dataset():
    return build_clinic_dataset()

def _normalise_filter(value: str | None) -> str:
    return (value or "all").strip().lower()


def aggregate_feedback_dashboard(
    appointments: list[dict[str, Any]],
    *,
    date_range: str = "last_7_days",
    clinician: str = "all",
    patient_segment: str = "all",
    appointment_type: str = "all",
    no_show_reason: str = "all reasons",
    cancellation_reason: str = "all reasons",
) -> dict[str, Any]:
    """Apply hard filters, then derive daily rates and KPI totals."""
    days = {"last_7_days": 7, "last_30_days": 30, "last_quarter": 90}.get(date_range, 7)
    start = DEMO_REFERENCE_DATE - timedelta(days=days - 1)
    clinician = _normalise_filter(clinician)
    patient_segment = _normalise_filter(patient_segment)
    appointment_type = _normalise_filter(appointment_type)
    no_show_reason = _normalise_filter(no_show_reason)
    cancellation_reason = _normalise_filter(cancellation_reason)

    filtered = []
    for row in appointments:
        row_date = date.fromisoformat(row["appointment_date"])
        if not start <= row_date <= DEMO_REFERENCE_DATE:
            continue
        if clinician != "all" and clinician not in {_normalise_filter(row["clinician_name"]), _normalise_filter(row["clinician_id"])}:
            continue
        if patient_segment == "high_risk" and not row.get("high_risk"):
            continue
        if patient_segment not in {"all", "high_risk"} and _normalise_filter(row["patient_segment"]) != patient_segment:
            continue
        if appointment_type != "all" and _normalise_filter(row["appointment_type"]) != appointment_type:
            continue
        filtered.append(row)

    def is_cancel(row):
        return row["status"] == "cancelled" and (cancellation_reason == "all reasons" or _normalise_filter(row["cancellation_reason"]) == cancellation_reason)

    def is_noshow(row):
        return row["status"] == "no_show" and (no_show_reason == "all reasons" or _normalise_filter(row["no_show_reason"]) == no_show_reason)

    by_day: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in filtered:
        by_day[row["appointment_date"]].append(row)

    labels, cancellation_trend, no_show_trend, daily_volume = [], [], [], []
    for offset in range(days):
        day = start + timedelta(days=offset)
        label = day.strftime("%b %-d")
        rows = by_day[day.isoformat()]
        total = len(rows)
        labels.append(label)
        daily_volume.append(total)
        cancellation_trend.append(round(sum(is_cancel(row) for row in rows) / total * 100, 1) if total else None)
        no_show_trend.append(round(sum(is_noshow(row) for row in rows) / total * 100, 1) if total else None)

    status_counts = Counter(row["status"] for row in filtered)
    total = len(filtered)
    cancellation_total = sum(is_cancel(row) for row in filtered)
    no_show_total = sum(is_noshow(row) for row in filtered)
    reasons = Counter(row["cancellation_reason"] for row in filtered if is_cancel(row))
    reason_order = [
        "Emergency / Unforeseen Obligations", "Change of Mind", "Financial Issues",
        "Patient Anxiety / Resistance", "Unknown",
    ]
    reason_total = sum(reasons.values()) or 1
    reason_percentages = [round(reasons[name] / reason_total * 100) for name in reason_order]
    if reasons:
        reason_percentages[0] += 100 - sum(reason_percentages)

    return {
        "date_range": date_range,
        "start_date": start.isoformat(),
        "end_date": DEMO_REFERENCE_DATE.isoformat(),
        "labels": labels,
        "daily_volume": daily_volume,
        "total_appointments": total,
        "unique_patients": len({row["patient_id"] for row in filtered}),
        "active_clinicians": len({row["clinician_id"] for row in filtered}),
        "cancellation_total": cancellation_total,
        "no_show_total": no_show_total,
        "cancellation_rate": round(cancellation_total / total * 100, 1) if total else None,
        "no_show_rate": round(no_show_total / total * 100, 1) if total else None,
        "cancellation_trend": cancellation_trend,
        "no_show_trend": no_show_trend,
        "cancellation_reasons": reason_percentages,
    }



def public_dashboard_payload(dataset=None):
    return payload()

def write_public_dashboard_payload(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload(), ensure_ascii=False, separators=(",", ":")))
    return path

def write_browser_dashboard_payload(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("window.PANDION_SYNTHETIC_OPERATIONS=" + json.dumps(payload(), ensure_ascii=False, separators=(",", ":")) + ";\n")
    return path

def write_operational_database(path):
    return write_database(path)
