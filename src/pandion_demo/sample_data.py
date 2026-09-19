"""Deterministic, fictional operational records for the Pandion RAG demo."""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path
from typing import Any

DEMO_REFERENCE_DATE = date(2026, 9, 15)

FEEDBACK_TEMPLATES = {
    "rescheduling": {
        "negative": "I wanted to keep the appointment but changing the time took too many steps. A direct reschedule link with suitable alternatives would help.",
        "mixed": "The care team helped me find another time, although the online rescheduling link was difficult to locate.",
        "positive": "The rescheduling link showed suitable alternatives and I changed my appointment without calling support.",
    },
    "reminders": {
        "negative": "The reminder arrived too late for me to resolve a work conflict. Earlier email and text reminders would help.",
        "mixed": "The reminder was useful, but the appointment time was not clear across the email and text message.",
        "positive": "The email and text reminders were clear and gave me enough time to plan for the appointment.",
    },
    "availability": {
        "negative": "I could not find an evening appointment that fitted around work and caring responsibilities.",
        "mixed": "I found a suitable clinician, but the first available time was later than I expected.",
        "positive": "The evening telehealth options made it easy to fit the appointment around my schedule.",
    },
    "booking": {
        "negative": "The booking page made it hard to compare appointment types and available times on mobile.",
        "mixed": "Booking worked, although I had to go back to confirm which appointment type I needed.",
        "positive": "Booking was straightforward and the next steps were explained clearly.",
    },
    "continuity": {
        "negative": "I had to repeat my care goals after being assigned to a different clinician for follow-up.",
        "mixed": "The follow-up plan was clear, but keeping the same clinician required an extra call.",
        "positive": "Seeing the same clinician made the follow-up feel connected and the plan was easy to understand.",
    },
}


def _generated_feedback() -> list[dict[str, Any]]:
    """Create 192 stable synthetic feedback rows with realistic theme frequencies."""
    theme_counts = {
        "rescheduling": 62,
        "reminders": 43,
        "availability": 34,
        "booking": 28,
        "continuity": 25,
    }
    clinicians = ("Dr. Maya Chen", "Elena Ruiz", "Jordan Patel")
    patient_segments = ("new_patient", "continuing_patient", "high_risk")
    appointment_types = ("assessment", "follow_up", "telehealth")
    sentiments = ("negative", "negative", "mixed", "positive")
    records: list[dict[str, Any]] = []
    index = 0
    for theme_index, (theme, count) in enumerate(theme_counts.items()):
        for occurrence in range(count):
            sentiment = sentiments[(occurrence + theme_index) % len(sentiments)]
            record_date = DEMO_REFERENCE_DATE - timedelta(days=(index * 17 + theme_index * 3) % 90)
            records.append(_record(
                f"FB-{1001 + index}",
                "patient_feedback",
                record_date.isoformat(),
                "Anonymous patient feedback",
                FEEDBACK_TEMPLATES[theme][sentiment],
                sentiment=sentiment,
                theme=theme,
                clinician=clinicians[index % len(clinicians)],
                patient_segment=patient_segments[(index + theme_index) % len(patient_segments)],
                appointment_type=appointment_types[(index + occurrence) % len(appointment_types)],
                source_channel=("survey", "cancellation_follow_up", "support_note")[index % 3],
                synthetic=True,
            ))
            index += 1
    return records


def _record(record_id: str, record_type: str, date: str, title: str, text: str, **meta: Any) -> dict[str, Any]:
    return {
        "record_id": record_id,
        "record_type": record_type,
        "date": date,
        "title": title,
        "text": text,
        **meta,
    }


def build_records() -> list[dict[str, Any]]:
    """Return a stable corpus. All people and events are fictional."""
    records = [
        _record("SOP-001", "sop", "2026-01-10", "No-show response playbook",
                "When weekly no-show rate exceeds 8%, operations should review reminder delivery failures, contact high-risk patients 48 hours before visits, offer SMS plus phone confirmation, and open same-week wait-list slots. Record the intervention and recheck after 14 days.", section="attendance"),
        _record("SOP-002", "sop", "2026-01-10", "Cancellation recovery standard",
                "For cancellations caused by work or childcare conflicts, offer evening telehealth or a flexible reschedule within seven days. For transport barriers, provide remote-care eligibility screening. Do not repeatedly call patients who opted out of phone contact.", section="cancellation"),
        _record("SOP-003", "sop", "2026-02-02", "Allocation safety rules",
                "Before clinician allocation, enforce hard constraints for licensure, age range, clinical acuity and requested modality. Then rank soft preferences such as language, clinician gender, appointment window and continuity. A hard-constraint failure must never be overridden by availability.", section="allocation"),
        _record("SOP-004", "sop", "2026-02-02", "High-priority referral escalation",
                "Urgent referrals waiting over 24 hours require an operations review. Check whether the bottleneck is specialty, licensure, modality or schedule. If no exact match exists, escalate to the clinical lead instead of silently assigning a partial match.", section="allocation"),
        _record("SOP-005", "sop", "2026-02-18", "Capacity and utilisation playbook",
                "If clinician utilisation is below 75% while the wait-list is growing, compare open slots with patient time windows and appointment type. Release protected slots only after confirming follow-up demand and clinician workload limits.", section="capacity"),
        _record("SOP-006", "sop", "2026-03-04", "Patient feedback review",
                "Feedback themes should be reported only after grouping multiple records. Every theme must link to source records, distinguish direct comments from analyst inference, and suppress personally identifying details.", section="feedback"),
        _record("POL-001", "policy", "2026-02-12", "Revenue recognition note",
                "Dashboard revenue may fall when completed sessions are not yet billed, claims are held for missing documentation, or refunds are posted. Investigate operational events before attributing a revenue change to patient demand.", section="finance"),
        _record("POL-002", "policy", "2026-02-12", "New-patient definition",
                "A new patient is counted after the first completed appointment, not at referral intake. Cancellations before the first visit can therefore reduce the weekly new-patient KPI even when referral volume is stable.", section="metrics"),
        _record("EVT-101", "operational_event", "2026-08-04", "Reminder vendor delay",
                "The SMS reminder vendor reported delayed delivery between 3 and 5 August. Delivery success fell from 96% to 81%; phone reminders were unaffected. Thirty-two appointments were inside the affected reminder window.", section="attendance"),
        _record("EVT-102", "operational_event", "2026-08-08", "Evening slot reduction",
                "Two clinicians temporarily removed evening availability during the week of 8 August, reducing after-17:00 capacity by 14 appointments. The wait-list contained 19 people who requested evening-only visits.", section="capacity"),
        _record("EVT-103", "operational_event", "2026-08-11", "Billing documentation hold",
                "Nine completed appointments were placed on billing hold because required notes were unsigned. Estimated dashboard revenue impact was 1,170 dollars; the sessions remained completed and were not demand losses.", section="finance"),
        _record("EVT-104", "operational_event", "2026-08-13", "Referral mix change",
                "The share of adolescent referrals increased from 18% to 29% this week. Only three clinicians in the current roster accept patients under 16, increasing time-to-match for this segment.", section="allocation"),
        _record("FB-201", "patient_feedback", "2026-08-03", "Anonymous post-visit feedback",
                "The therapist was helpful, but I nearly missed the appointment because the text reminder arrived after the scheduled time.", sentiment="mixed", theme="reminders", appointment_type="telehealth"),
        _record("FB-202", "patient_feedback", "2026-08-05", "Anonymous cancellation feedback",
                "I could not make a daytime appointment around work. An evening video appointment would make it much easier to continue.", sentiment="negative", theme="availability", appointment_type="telehealth"),
        _record("FB-203", "patient_feedback", "2026-08-06", "Anonymous booking feedback",
                "Booking was easy and the care coordinator explained the next steps clearly. I liked being able to choose video care.", sentiment="positive", theme="booking", appointment_type="telehealth"),
        _record("FB-204", "patient_feedback", "2026-08-07", "Anonymous post-visit feedback",
                "I had to repeat my preferences twice before being matched, although the eventual clinician was a good fit.", sentiment="mixed", theme="matching", appointment_type="initial"),
        _record("FB-205", "patient_feedback", "2026-08-09", "Anonymous no-show follow-up",
                "I did not see a reminder and assumed the appointment had moved. Please send both email and text when the time changes.", sentiment="negative", theme="reminders", appointment_type="follow_up"),
        _record("FB-206", "patient_feedback", "2026-08-10", "Anonymous cancellation feedback",
                "Childcare fell through at the last minute. A shorter rescheduling flow would help; I could not find the right link in the email.", sentiment="negative", theme="rescheduling", appointment_type="follow_up"),
        _record("FB-207", "patient_feedback", "2026-08-12", "Anonymous booking feedback",
                "The mobile booking page was clear, but the available times shown did not include any evenings.", sentiment="mixed", theme="availability", appointment_type="initial"),
        _record("FB-208", "patient_feedback", "2026-08-13", "Anonymous post-visit feedback",
                "The clinician remembered the goals from my prior visit and the follow-up plan was very clear.", sentiment="positive", theme="continuity", appointment_type="follow_up"),
        _record("CAN-301", "cancellation_note", "2026-08-04", "Cancellation note",
                "Patient cancelled 26 hours before the initial visit because the only offered time overlapped with work. Requested weekday slots after 18:00 and prefers telehealth.", reason="work_conflict", appointment_type="initial"),
        _record("CAN-302", "cancellation_note", "2026-08-06", "Cancellation note",
                "Follow-up cancelled due to childcare. Patient wants to remain with the same clinician and can attend by video after 17:30.", reason="childcare", appointment_type="follow_up"),
        _record("CAN-303", "cancellation_note", "2026-08-09", "Cancellation note",
                "Patient cancelled after receiving an insurance cost estimate that was higher than expected. Asked for benefit clarification before rebooking.", reason="cost", appointment_type="initial"),
        _record("NS-401", "no_show_note", "2026-08-05", "No-show outreach note",
                "Patient said no reminder was received. SMS delivery log shows a delayed status; appointment was rebooked for the following week.", reason="reminder_failure", appointment_type="follow_up"),
        _record("NS-402", "no_show_note", "2026-08-08", "No-show outreach note",
                "Patient confused the time zone shown in the confirmation email. Care coordinator clarified local time and enabled SMS confirmation.", reason="time_confusion", appointment_type="telehealth"),
        _record("NS-403", "no_show_note", "2026-08-11", "No-show outreach note",
                "Unable to reach patient after one call and one secure message. Contact preference indicates secure message only; no further phone attempt should be made.", reason="unknown", appointment_type="initial"),
        _record("REF-501", "referral_constraint", "2026-08-12", "Urgent adolescent referral",
                "High-priority referral requires an adolescent specialist licensed in California, telehealth, and availability after 16:00. Patient prefers a Spanish-speaking clinician. No exact open slot appears in the next three days.", priority="high", appointment_type="initial"),
        _record("REF-502", "referral_constraint", "2026-08-13", "Continuity follow-up request",
                "Existing patient requires medication-management follow-up with the current clinician within 14 days. Patient is available Tuesday or Thursday mornings only.", priority="medium", appointment_type="follow_up"),
        _record("REF-503", "referral_constraint", "2026-08-13", "Adult therapy referral",
                "Routine adult referral requests evening telehealth for anxiety care. Language preference is English; no clinician gender preference.", priority="routine", appointment_type="initial"),
        _record("CLN-601", "clinician_profile", "2026-08-01", "Dr. Maya Chen profile",
                "Licensed in California; accepts adults and adolescents age 14 and above; specialties include anxiety and adolescent care; offers telehealth in English and Mandarin. Current evening capacity: one slot.", clinician="Dr. Maya Chen", role="psychiatrist"),
        _record("CLN-602", "clinician_profile", "2026-08-01", "Elena Ruiz LCSW profile",
                "Licensed in California; accepts adults and adolescents age 13 and above; specialties include anxiety and family stress; offers telehealth in English and Spanish. No open slots in the next three days.", clinician="Elena Ruiz", role="therapist"),
        _record("CLN-603", "clinician_profile", "2026-08-01", "Jordan Patel NP profile",
                "Licensed in California and Nevada; medication management for adults only; offers telehealth in English. Two Tuesday morning follow-up slots remain, with no evening availability.", clinician="Jordan Patel", role="nurse_practitioner"),
    ]
    records.extend(_generated_feedback())
    return records


def write_dataset(path: str | Path) -> Path:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", encoding="utf-8") as handle:
        for record in build_records():
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    return destination
