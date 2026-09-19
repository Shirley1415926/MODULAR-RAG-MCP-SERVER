"""Feedback evidence from the same appointment ledger used by the dashboard."""
from src.pandion_demo.clinic_dataset import build_clinic_dataset


def feedback_records():
    return [dict(row,record_type="patient_feedback",title="Synthetic appointment-linked feedback",section="feedback")
            for row in build_clinic_dataset()["feedback"]]
