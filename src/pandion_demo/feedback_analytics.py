"""Deterministic analytics over the complete filtered patient-feedback dataset."""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable
from datetime import date, timedelta
from typing import Any

from src.pandion_demo.sample_data import DEMO_REFERENCE_DATE, build_records

THEME_LABELS = {
    "rescheduling": "Rescheduling difficulty",
    "reminders": "Reminder clarity and timing",
    "availability": "Appointment availability",
    "booking": "Booking experience",
    "continuity": "Continuity of care",
    "matching": "Clinician matching",
}

ALL_VALUES = {"", "all", "all_clinicians", "all_patients", "all_types"}


class FeedbackAnalytics:
    """Apply hard filters, aggregate every matching row, and select source quotes."""

    def __init__(self, records: Iterable[dict[str, Any]] | None = None, minimum_sample: int = 5) -> None:
        source = list(records) if records is not None else build_records()
        self.feedback = [row for row in source if row.get("record_type") == "patient_feedback"]
        self.minimum_sample = minimum_sample

    def analyse(self, filters: dict[str, Any] | None = None) -> dict[str, Any]:
        normalised = self._normalise_filters(filters or {})
        matching = [row for row in self.feedback if self._matches(row, normalised)]
        total = len(matching)
        theme_counts = Counter(str(row.get("theme", "other")) for row in matching)
        themes = []
        for theme, count in sorted(theme_counts.items(), key=lambda item: (-item[1], item[0])):
            theme_rows = [row for row in matching if row.get("theme") == theme]
            sentiments = Counter(str(row.get("sentiment", "unknown")) for row in theme_rows)
            representatives = self._representatives(theme_rows)
            themes.append({
                "theme": theme,
                "label": THEME_LABELS.get(theme, theme.replace("_", " ").title()),
                "count": count,
                "share": round(count / total * 100, 1) if total else 0.0,
                "sentiments": dict(sentiments),
                "representative_sources": [row["record_id"] for row in representatives],
                "representative_records": representatives,
            })
        return {
            "total_feedback": total,
            "available_feedback": len(self.feedback),
            "minimum_sample": self.minimum_sample,
            "insufficient_evidence": total < self.minimum_sample,
            "start_date": normalised["start_date"].isoformat(),
            "end_date": normalised["end_date"].isoformat(),
            "applied_filters": {
                key: value.isoformat() if isinstance(value, date) else value
                for key, value in normalised.items()
            },
            "themes": themes,
        }

    @staticmethod
    def _normalise_filters(filters: dict[str, Any]) -> dict[str, Any]:
        end_date = date.fromisoformat(str(filters.get("end_date", DEMO_REFERENCE_DATE.isoformat())))
        start_value = filters.get("start_date")
        start_date = date.fromisoformat(str(start_value)) if start_value else end_date - timedelta(days=6)
        if start_date > end_date:
            raise ValueError("start_date must be on or before end_date")
        return {
            "start_date": start_date,
            "end_date": end_date,
            "clinician": str(filters.get("clinician", "all")).strip().lower(),
            "patient_segment": str(filters.get("patient_segment", "all")).strip().lower(),
            "appointment_type": str(filters.get("appointment_type", "all")).strip().lower(),
        }

    @staticmethod
    def _matches(row: dict[str, Any], filters: dict[str, Any]) -> bool:
        row_date = date.fromisoformat(str(row["date"]))
        if not filters["start_date"] <= row_date <= filters["end_date"]:
            return False
        for key in ("clinician", "patient_segment", "appointment_type"):
            wanted = filters[key]
            if key == "clinician" and wanted == str(row.get("clinician_id", "")).lower():
                continue
            if key == "patient_segment" and wanted == "high_risk" and "high_risk" in row:
                if not row["high_risk"]:
                    return False
                continue
            if wanted not in ALL_VALUES and str(row.get(key, "")).lower() != wanted:
                return False
        return True

    @staticmethod
    def _representatives(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        selected: list[dict[str, Any]] = []
        for sentiment in ("negative", "positive", "mixed"):
            match = next((row for row in rows if row.get("sentiment") == sentiment), None)
            if match is not None:
                selected.append(match)
            if len(selected) == 2:
                break
        return selected
