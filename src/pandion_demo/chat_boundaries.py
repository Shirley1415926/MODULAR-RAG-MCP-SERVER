"""Check unsupported requests before date shortcuts or type routing run."""
import re


def request_boundary(question, state):
    q=question.lower().strip().rstrip('?.!')
    message=None
    if re.search(r'\b(profits?|revenue|income|margin|financial loss|money|dollars?)\b',q) or re.search(r'\bhow much\b.*\b(cost|lost|loss)\b',q):
        message=('I cannot calculate money or profit lost from cancellations: this analysis does not link cancellations to payments, costs or replacement bookings. '
                 'I can compare cancellation rates and recorded reasons instead.')
    elif re.search(r'\b(clinicians?|doctors?|psychiatrists?|psychologists?|therapists?|paediatricians?)\b',q):
        message=('I cannot compare clinician groups yet. I can compare Assessment and Follow-up appointments within your current dashboard selection.')
    elif re.search(r'\b(female|male|women|woman|men|man|gender|sex|children|adults?|age[ds]?|older|younger|ethnicity|ethnic|insurance|insured|uninsured|postcode|location|new patients?|returning patients?|high.risk patients?)\b',q):
        message=('I cannot apply that patient-group condition in chat. I will not substitute figures for all patients. '
                 'Use a supported Patient Dashboard filter and start a new conversation, or ask about the current selection.')
    elif re.search(r'\b(no.show|no.shows)\b',q):
        message='No-show analysis is not available in this assistant yet. I can analyse cancellations, which are a different outcome.'
    elif re.search(r'\b(cancel|cancellations?|cancellation|appointment types?)\b',q) or state.get('topic')=='cancellation' or state.get('pending_period'):
        # Scope modifiers not implemented by the request parser must fail closed,
        # including unfamiliar groups; do not rely on a list of demographics.
        residual=re.sub(r'\b(?:for|among|within|in) (?:that|this|the|these|those|current|selected) (?:group|selection|cohort|patients?|period)\b','',q)
        residual=re.sub(r'\b(?:for|in|over) (?:the )?(?:last|past|previous) \d+ days?\b','',residual)
        residual=re.sub(r'\b(?:compared with|compared to|by appointment type|by type)\b','',residual)
        if re.search(r'\b(for|among|within|only|with|by)\b',residual):
            message=('I cannot reliably apply that extra condition. Please use the dashboard filters for the group you need; '
                     'I can then compare cancellation periods or Assessment versus Follow-up without dropping your filter.')
    if message:return {'mode':'unsupported','state':dict(state),'answer':message,'evidence':[]}
    return None


def plain_advice(answer):
    """Reject internal instruction echoes; use the existing safe fallback."""
    return not re.search(r'\b(SOP|prompt|system instruction|preserve|provided sources|return JSON|hard.constraint|soft.preference)\b',answer,re.I)
