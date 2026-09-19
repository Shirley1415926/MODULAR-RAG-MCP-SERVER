# Pandion Health dashboard — real RAG demo

## Current interaction (2026-09-18)

The reason-analysis detail now leads with its key finding, sorts by contribution
to the overall rate change, and offers clickable reason labels showing all
matching current/prior records. Only one recommendation is displayed. The server
independently recalculates cancellation/no-show distributions from the ledger and
selected dates, clinician, patient segment and appointment type before prompting
the model. Missing documentation takes precedence when it is the largest positive
contributor. AI completion updates only recommendation/status/citations, preserving
expanded records and avoiding a full drawer rebuild. Main card layout is unchanged.

Detail panels now show complete-cohort cancellation/no-show reason comparisons
against the adjacent equal-length period, keeping clinician, patient segment and
appointment-type filters constant. Count deltas and percentage-point contributions
are separate; contributions use all appointments as each period's denominator.
Missing reasons are a documentation gap, not a diagnosed cause. The largest current
category is distinguished from the largest increase. These deterministic findings
and data-led next steps are separate from the existing SOP-based AI suggestion.

Supporting records are collapsed by default and have readable field labels.
Follow-up evidence distinguishes the completed prior visit from the unbooked next
visit, reports overdue days relative to the fixed demo date, and summarises service
groups. Raw source identifiers are nested inside each record. All changes are
within the existing detail overlay; main dashboard geometry remains unchanged.

AI advice is concentrated in Allocation Risk Panel and Key Operational Insights.
Open either page or change its cohort filters to recompute up to three priorities.
Each priority keeps the original compact card with a title and short operational
hint. View detailed explanation opens the impact, full recommendation, analysis
status, supporting ledger records and retrieved demo SOP citations in the existing
overlay. Fixed card heights and the original three-column clinician layout are
preserved; AI results never expand inline. Overview KPI Why
buttons and manual Generate/Explain buttons have been removed.

The static page uses explicitly labelled rule-based priorities. When served by
`scripts/start_pandion_demo.py`, the two panels automatically call
`POST /api/operational-review` after a 700ms debounce. This retrieves relevant demo
SOPs and generates advice using current ledger examples. The deterministic
frontend controls counts, impact descriptions and priority ordering; the LLM adds
recommendations, with validated citation IDs. Unavailable retrieval/generation
leaves the rule-based advice visible. Successful results are cached for the
browser session; outdated responses cannot replace a newer filter selection.

This endpoint reloads original records by ID but trusts the frontend's aggregate
descriptions; it is a local prototype, not a production analytics trust boundary.
The original `/api/insights` endpoint and legacy benchmark remain available for
compatibility; the dashboard no longer calls that endpoint. The details below
about the original scenarios and benchmark describe that legacy implementation.

This prototype was developed from requirements discussed iteratively with Pandion
Health stakeholders during a school-company internship collaboration. No real
patient data was authorised or used. The patient records are synthetic, while the
filtering, analytics, retrieval and generation paths are functional.

1. `scripts/setup_pandion_demo.py` writes a readable JSONL corpus.
2. Ollama `nomic-embed-text` creates real embeddings.
3. Chroma stores dense vectors; the project BM25 index stores keyword statistics.
4. Patient Feedback Overview first applies structured filters to every feedback row
   and computes theme counts, shares and sentiment distributions deterministically.
5. RAG retrieves relevant SOP evidence and selects representative source comments.
6. DeepSeek explains the verified statistics and evidence; it does not calculate
   theme frequency.
7. The drawer shows the applied range, full-set theme counts and cited records.

## Run

From the repository root:

```bash
ollama serve
.venv/bin/python scripts/setup_pandion_demo.py
.venv/bin/python scripts/start_pandion_demo.py
```

Open <http://127.0.0.1:8765>. Check readiness at
<http://127.0.0.1:8765/api/health>.

The generated source corpus is `data/pandion_demo/source_documents.jsonl`, the
Chroma collection is `pandion_demo`, and its BM25 index is stored under
`data/db/bm25/pandion_demo/`.

## Synthetic operational database and chart scope

The setup script also creates `data/pandion_demo/pandion_operations.sqlite3`
with exactly 300 fictional patients, 50 distinct fictional clinicians, and
2,253 dated appointments over 90 days ending 2026-09-15. It publishes the
fictional appointment facts in `examples/pandion_demo/synthetic_operations.js`
for the standalone HTML page and `synthetic_operations.json` for HTTP access.
These assets contain only synthetic IDs and fictional names, never actual PHI.

The Patient Dashboard filters and cancellation/no-show charts now aggregate
individual appointment rows. The 7- and 30-day ranges are nested views of the
same underlying events. The generator includes weekday/weekend volume effects,
cohort differences, a fictional September 9–12 reminder incident, and a
subsequent recovery. Daily rates with fewer than five appointments are omitted;
cohorts below 20 appointments show an insufficient-evidence notice.

The 200-record feedback corpus used for RAG is **separate** from this
appointment database. The public GitHub Pages version can recalculate the
appointment charts but serves a captured RAG feedback answer only for its
default filters. Changed filters require the local RAG backend for newly
retrieved citations. The Admin and Clinician dashboards remain illustrative
layout sections, not database-backed operational reporting.

If DeepSeek is temporarily unavailable, retrieval still runs and the API returns
an explicitly labelled `extractive_fallback` response. No retrieved citation is
created by the model.

## API

`POST /api/insights`

```json
{
  "scenario": "feedback-noshow",
  "context": "All clinicians · All patient cohorts",
  "filters": {
    "start_date": "2026-09-09",
    "end_date": "2026-09-15",
    "clinician": "all",
    "patient_segment": "all",
    "appointment_type": "all"
  },
  "metrics": {"no_show_rate": 8.4}
}
```

Supported scenario IDs are defined in `src/pandion_demo/service.py`.

## Allocation detail diagnostics

For overdue follow-ups, localhost RAG now generates an ordered action plan in
the main action area (group, rationale, action, proposed measure, event/SOP
citations). Counts remain deterministic. Each step exposes its referenced
original events and retrieved guidance. Group/source membership, shape,
duplicate groups and numeric prose are validated before display. These checks
do not prove semantic correctness; staff review is still required. Invalid
output, absent guidance or API failure retains an explicitly labelled rules
plan. Static-file mode uses rules only. Other insight types remain unchanged.

Overdue follow-up detail now opens with business impact, the two eligible
obstacle/leakage signals and their shares of the entire selected overdue cohort,
and ordered staff actions with proposed outcome measures. Ties are explicit.
Workflow states such as confirmed care need are not ranked as causes.
Action priority is a transparent operational heuristic (fixable time conflict,
confirmed demand, reported external booking), not a profit forecast. Timelines,
slot matching, limitations and SOP references remain in collapsed sections;
main dashboard cards and layout are unchanged. For overdue follow-ups, valid
RAG completion replaces the rule action order, but never the calculated shares.

Follow-up detail includes linked, explicitly synthetic workflow events in
`followup_events`: sent offers, linked patient refusals, patient-reported
external bookings and clinician care-need reviews. A fifth scenario deliberately
has no imported history. These are deterministic demo fixtures, not observed
company outcomes; balanced scenario counts are not prevalence estimates.

Frontend and backend independently derive each record's latest state. A refusal
must link to an earlier offer for the same follow-up, with conflicting recorded
time periods, to support a time-mismatch finding. Matching uses the latest
stated time period when a current linked refusal specifies one, rather than
the old stored preference. These checks remain administrative, not clinical. Newer events supersede the
old finding; unmatched or unrecognised replies require review. A sent offer
without a later imported reply is not proof of patient non-response. External
bookings remain patient reports. Confirmed ongoing need is a fact, not a cause.
The drawer shows group-specific actions and complete source-ID/date/actor
timelines, with remaining limitations collapsed. AI receives the server-reloaded
events and derived findings. No tasks are assigned or bookings performed.
Current availability cannot rule out past capacity constraints.

The existing detail drawer now groups follow-ups by days overdue (1–7, 8–30,
over 30, and due today or later), relative to the synthetic dataset anchor.
It checks free slots in the selected window in order: service, original
clinician, appointment type, then recorded time preference. Each record is
counted under its first blocking check; other constraints may coexist.
Expand a group for source records and the earliest candidate slot.

These are administrative availability checks, not confirmed root causes,
clinical suitability assessments, or evidence of failed outreach. Candidate
slots can be shared across patients and are not reserved. Matching within the
selected window does not guarantee availability before a follow-up due date.
Long-overdue follow-ups require confirmation of current care needs first.
The backend independently recalculates these diagnostics before AI advice;
the compact dashboard layout remains unchanged.

## Daily allocation assistant (current)

### Cancellation-rate analysis route

The same floating assistant also accepts “Why did the cancellation rate change?”,
followed by “Why?”, “Give me the supporting evidence.” and “What should we do next?”.
This route uses the Patient Dashboard date/clinician/segment/appointment-type
selection, not the future clinician availability window or daily review budget.
Chat identity includes both filter snapshots, preventing cross-filter history reuse.
The independent cancellation/no-show reason dropdowns are not cohort filters for
this comparison; all cancellation reasons are decomposed against all appointments.

The backend compares the complete selected cohort with the preceding equal-length
period. Reason contributions are `current reason count / current appointments`
minus `previous reason count / previous appointments`, in percentage points.
They sum to the total rate change; both positive and negative contributions are
retained, with ties preserved. Decreases are not reported as increases. Missing
period data produces an insufficient-data response. These are recorded reasons,
not identified causal mechanisms. Evidence includes up to eight source examples
per period; counts are never estimated from those samples.

Comparison, why and evidence responses are computed. Only next-step guidance
retrieves cancellation SOPs and calls the configured LLM, with citation/length
validation and visible rule-only fallback. Other date requests, clinician
comparisons, no-show analysis and arbitrary subgroup requests are not supported
through chat yet; change the existing page filters to change the cohort.
Tests: `tests/unit/test_pandion_cancellation_chat.py`.

### Daily review planning

Chat presentation is conclusion-first: the default plan shows only the selected
groups and any high-priority capacity warning. Calculation metadata and generated
rationale are collapsed under “Why this order?”. Evidence is separate: first a
group-count summary, then an expandable complete list of the selected batch's
source records (not the entire database). SOP guidance is labelled separately.
An explicit request for daily-plan evidence routes to `daily_evidence` and skips
advice generation. Enter sends; Shift+Enter inserts a newline; IME composition
does not trigger submission. Suggested prompts disappear after the first turn.
Short follow-ups such as “Why?”, “Why these patients?” and “Why them first?”
retain the current daily-plan budget and route to `daily_why`. The response shows
a short rationale directly, with evidence collapsed, rather than repeating the
plan. The model is asked for at most 65 words (responses over 75 words fall back
to a labelled rule explanation). Without prior context, bare “Why?” asks for
clarification. Existing flags explain ordering, not the original clinical reason
for assigning a flag.

The floating **Ask AI** now supports cross-alert administrative review planning.
Ask “What should my team focus on today?” or “We can review 20 patients today.
Where should we start?”, then try “Make that 40 patients.” No-limit requests use
an explicitly labelled illustrative budget of 20; this is not measured staff capacity.

The backend re-creates the three allocation cohorts with the same role/type scope
as the clinician dashboard: high-priority referrals, other referrals waiting over
seven days, and overdue follow-ups. It deduplicates patient IDs, gives each patient
their strongest tier, then orders by longest wait within tier and stable IDs.
The order is an explicit demo operations rule, not learned clinical triage or
profit optimisation: existing high-priority flags, other long waits, recorded time
conflicts, confirmed follow-up need, then other overdue records. Missing priority
information in follow-up records is not evidence of low clinical risk.

Default synthetic fixture: 27 + 67 + 130 alert memberships become 207 unique
patients after removing 17 duplicate memberships. A budget of 20 selects 20
high-priority reviews and flags seven remaining high-priority patients for capacity
escalation. A budget of 40 includes all 27 high-priority patients and 13 from the
next tier. Neither batch guarantees bookings or authorises delaying care.

DeepSeek can add cited operational guidance using retrieved SOPs, but does not
set the queue order or calculate the counts. The UI separately labels rule-only
fallback. The scenario state retains the patient-count limit for follow-ups.
Other constraints (staff hours, afternoon availability, financial optimisation)
are not implemented and should be declined rather than silently applied.
All planning is as of the fixed demo anchor, not the computer's calendar date.

Tests: `tests/unit/test_pandion_daily_plan.py` covers cohort parity, deduplication,
budget, priority overflow, role filtering, empty inputs, state and citation guards.
Browser smoke verification: the 20-patient shortcut and the free-text follow-up
“Make that 40 patients.” both returned cited RAG guidance and the expected 20 →
27+13 batch counts. This is a single-run check, not a reliability benchmark.

### Earlier overdue-only questions

In the running dashboard (`http://127.0.0.1:8765/`), open **Clinician
Dashboard**, then click the floating **Ask AI** button at the bottom right.
The standalone file preview links to the running version. The original dashboard
layout is retained; the assistant is an independent floating chat window, not
part of the explanation drawer. It uses the Clinician Dashboard filters even
when opened from another page, and explicitly labels its overdue-follow-up scope.
English-only UI prompts focus on rationale, evidence and next actions; there is
no “show all” shortcut or full-record browsing panel.

This bounded first version supports overdue-age scope (all or over 30 days),
workflow groups, representative evidence, prioritisation and next-step questions.
It does not execute bookings/contact, provide clinical decisions, or calculate
profit. It is not a general-purpose dashboard assistant.

Flow: a shortcut or model intent router selects an allowlisted operation;
the backend independently rebuilds the cohort from the synthetic ledger;
counts and evidence are computed, not generated. Advice additionally retrieves
SOPs with a `record_type=sop` filter, narrows to allocation/capacity guidance,
and asks the configured model for grounded prose. Returned source IDs must
exist and include both operational evidence and guidance. Failed generation
or citation validation is visibly labelled as fallback, not a RAG success.
Citation existence checks do not establish entailment or causality.

Context consists of explicit age/group state and the latest six user questions,
not unrestricted model memory. Up to eight displayed turns are retained per
dashboard filter selection in page memory. Refresh clears them. Closing the
drawer or switching pages cancels the frontend request and rejects stale
responses; it does not guarantee cancellation of an already-started provider call.

Browser smoke test on 2026-09-19: over-30-day shortcut returned 60 of 130;
Chinese follow-up “其中有多少人已确认仍需复诊？” retained the age scope and returned
12; next-step advice completed as `live_rag` with linked record/event/SOP sources.
The first live test exposed SOP retrieval starvation by feedback records; the
SOP metadata filter fixed this tested case. This is a smoke test, not a measured
multi-run reliability claim.

Regression coverage: `tests/unit/test_pandion_insight_chat.py` checks validation,
scope, source guards and fallback; `tests/pandion_chat.test.cjs` checks history,
filter isolation, late responses and error recovery. Existing operational-review
and layout checks remain applicable.

## Retrieval evaluation

Run the fixed 20-question retrieval benchmark:

```bash
.venv/bin/python scripts/evaluate_pandion_retrieval.py
```

The Golden Set is stored in
`docs/evaluation/pandion_golden_test_set.json`. The script compares Dense,
BM25 and scenario-routed Hybrid retrieval using Hit Rate@5, MRR@5 and local
latency, then writes both JSON and Markdown reports under `docs/evaluation/`.
# Conversational cancellation periods

Request boundaries run before date/type shortcuts: monetary-loss requests,
unsupported patient-group conditions and clinician grouping return an explicit
limitation with unchanged conversation state, not substituted all-patient totals.
Unrecognised scope modifiers also request supported dashboard filters. This is
a bounded parser, not a guarantee of interpreting every natural-language condition.
Generated cancellation advice containing internal instruction terms is rejected
in favour of the existing labelled rule-based fallback.

Appointment-type comparison is supported with `Which appointment type contributed
most to the increase?`. It inherits the current cancellation dates/cohort, or asks
for dates and resumes the same task. Assessment and Follow-up contributions use
each period's full-cohort appointment denominator; their sum equals the overall
rate change. This is not a highest-rate ranking and can reflect appointment mix.
Ties, decreases, zero change, missing periods and small groups are handled explicitly.
A single-type dashboard filter is never silently broadened.

After the comparison, `Why did cancellations increase in that group?` drills into
the unique leading type's recorded reasons; ties require choosing `Assessment` or
`Follow-up`. `What should we do first?` and `Show supporting evidence` retain that
type and the comparison dates. Before drilling down, evidence shows the two-type
comparison. Clinician grouping is not included. Figures/ranking are computed;
next-action generation reuses the scoped SOP retrieval and guarded LLM response.

Cancellation replies use a short headline, separate known-reason/missing-reason
findings, and one next step. Rate contributions and source records remain folded
under Supporting evidence. A Why follow-up explains the review priority instead
of repeating denominators. Known reasons are ranked by contribution in the
observed direction, independently of Unknown; evidence samples cover those
discussed reasons. These summaries are code-grounded, not new causal claims.

The assistant now asks for a period when a cancellation comparison is vague.
Reply `Yes` to accept the proposed dashboard range, or select/type `Last 7 days`
or `Last 30 days`. The pending clarification is kept in conversation state.
Date overrides affect chat only; clinician/type/segment filters remain in force.
Why, evidence and next-action follow-ups retain the resolved comparison.

Supported date forms: last/past N days (1–90, ending on the synthetic anchor
2026-09-15), last week (last complete Monday–Sunday), last month (last complete
calendar month versus the prior calendar month), and ISO start/end dates.
One explicit range uses the immediately preceding equal-length period; four ISO
dates specify later range first, earlier range second. Ranges must not overlap.
Incomplete this-week/month questions request explicit dates; invalid, future or
unavailable ranges do not produce invented comparisons. Reset clears chat scope.
No waiting-queue root-cause functionality or new clinical records were added.
