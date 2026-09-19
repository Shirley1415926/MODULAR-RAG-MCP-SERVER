import json
from pathlib import Path

import pytest

from src.pandion_demo.feedback_analytics import FeedbackAnalytics
from src.pandion_demo.operational_data import (
    aggregate_feedback_dashboard,
    build_operational_dataset,
    write_operational_database,
)
from src.pandion_demo.sample_data import build_records, write_dataset
from src.pandion_demo.service import SCENARIO_QUERIES, parse_generation


def test_sample_records_are_deterministic_and_fictional(tmp_path):
    first = build_records()
    second = build_records()
    assert first == second
    assert len(first) >= 220
    assert sum(record["record_type"] == "patient_feedback" for record in first) == 200
    assert {record["record_type"] for record in first} >= {
        "patient_feedback", "cancellation_note", "no_show_note", "sop",
        "referral_constraint", "clinician_profile", "operational_event",
    }
    output = write_dataset(tmp_path / "records.jsonl")
    loaded = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]
    assert loaded == first


def test_operational_dataset_has_requested_scale_and_references():
    dataset = build_operational_dataset()
    assert len(dataset["patients"]) == 1800
    assert len(dataset["clinicians"]) == 33
    assert len({row["name"] for row in dataset["clinicians"]}) == 33
    assert len(dataset["appointments"]) > 1_800
    patient_ids = {row["patient_id"] for row in dataset["patients"]}
    clinician_ids = {row["id"] for row in dataset["clinicians"]}
    assert {row["patient_id"] for row in dataset["appointments"]} <= patient_ids
    assert {row["clinician_id"] for row in dataset["appointments"]} <= clinician_ids
    assert all(row["synthetic"] == 1 for table in dataset.values() for row in table)


def test_operational_database_is_queryable(tmp_path):
    stats = write_operational_database(tmp_path / "pandion.sqlite3")
    assert stats["patients"] == 1800
    assert stats["clinicians"] == 33
    assert stats["appointments"] > 1_800


def test_recent_incident_creates_visible_seven_vs_thirty_day_signal():
    appointments = build_operational_dataset()["appointments"]
    week = aggregate_feedback_dashboard(appointments, date_range="last_7_days")
    month = aggregate_feedback_dashboard(appointments, date_range="last_30_days")
    assert len(week["labels"]) == 7
    assert len(month["labels"]) == 30
    assert week["cancellation_rate"] >= month["cancellation_rate"] + 3
    assert max(x for x in week["cancellation_trend"] if x is not None) >= month["cancellation_rate"] + 8
    assert week["total_appointments"] < month["total_appointments"]
    assert week["start_date"] == "2026-09-09"
    assert month["start_date"] == "2026-08-17"
    assert sum(week["start_date"] <= row["appointment_date"] <= week["end_date"] for row in appointments) == week["total_appointments"]
    assert len(week["cancellation_trend"]) == 7
    assert len(month["cancellation_trend"]) == 30
    assert week["cancellation_total"] / week["total_appointments"] * 100 == pytest.approx(week["cancellation_rate"], abs=0.05)


def test_all_dashboard_scenarios_have_queries():
    assert len(SCENARIO_QUERIES) == 11
    assert "feedback-overview" in SCENARIO_QUERIES
    assert "allocation-priority" in SCENARIO_QUERIES
    assert "kpi-revenue" in SCENARIO_QUERIES


def test_parse_generation_accepts_json_fences():
    result = parse_generation(
        '```json\n{"title":"T","summary":"S","signals":["a","b","c"],"recommendation":"R"}\n```'
    )
    assert result["signals"] == ["a", "b", "c"]


def test_parse_generation_rejects_incomplete_schema():
    with pytest.raises(ValueError):
        parse_generation('{"title":"T"}')


def test_feedback_analytics_hard_filters_date_range_and_counts_every_match():
    result = FeedbackAnalytics().analyse({
        "start_date": "2026-09-09",
        "end_date": "2026-09-15",
        "clinician": "all",
        "patient_segment": "all",
        "appointment_type": "all",
    })
    assert result["total_feedback"] > 5
    assert sum(theme["count"] for theme in result["themes"]) == result["total_feedback"]
    for theme in result["themes"]:
        for record in theme["representative_records"]:
            assert "2026-09-09" <= record["date"] <= "2026-09-15"


def test_feedback_analytics_uses_frequency_not_top_k_similarity():
    result = FeedbackAnalytics().analyse({
        "start_date": "2026-06-18",
        "end_date": "2026-09-15",
    })
    assert result["total_feedback"] == 200
    assert result["themes"][0]["theme"] == "rescheduling"
    assert result["themes"][0]["count"] == 63


def test_feedback_analytics_flags_small_filtered_samples():
    result = FeedbackAnalytics().analyse({
        "start_date": "2026-09-15",
        "end_date": "2026-09-15",
        "clinician": "dr. maya chen",
        "patient_segment": "high_risk",
        "appointment_type": "assessment",
    })
    assert result["total_feedback"] < result["minimum_sample"]
    assert result["insufficient_evidence"] is True


def test_pandion_golden_set_is_complete_and_points_to_known_records():
    root = Path(__file__).resolve().parents[2]
    golden = json.loads(
        (root / "docs" / "evaluation" / "pandion_golden_test_set.json").read_text(encoding="utf-8")
    )
    cases = golden["cases"]
    known_ids = {record["record_id"] for record in build_records()}
    assert len(cases) == 20
    assert len({case["id"] for case in cases}) == 20
    assert all(set(case["expected_ids"]) <= known_ids for case in cases)
    assert all(case["allowed_record_types"] for case in cases)
