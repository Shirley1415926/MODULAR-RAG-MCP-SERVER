"""Bounded date resolution and resumable cancellation clarification."""
import re
from datetime import date, timedelta

from src.pandion_demo.clinic_dataset import ANCHOR
from src.pandion_demo.cancellation_chat import cancellation_scope


def resolve_period(question, base):
    """Return a checked scope, or None when dates are absent/ambiguous."""
    q=question.lower().strip().rstrip('?.!')
    f={k:v for k,v in base.items() if k not in {'previous_start','previous_end'}}
    if q in {'yes','yes please','confirm','use current dashboard selection','use dashboard selection'}:
        return dict(base)
    dates=re.findall(r'\b\d{4}-\d{2}-\d{2}\b',q)
    if dates:
        if len(dates) not in {2,4}: raise ValueError('Give a start and end date, for example 2026-09-01 to 2026-09-07.')
        f.update(start=dates[0],end=dates[1])
        if len(dates)==4:f.update(previous_start=dates[2],previous_end=dates[3])
        return f
    if re.search(r'\bthis (week|month)\b',q):
        raise ValueError('This period is incomplete. Please give its start/end dates and the comparison dates.')
    spans=re.findall(r'\b(?:last|past|previous)\s+(\d+)\s+days?\b',q)
    if spans:
        n=int(spans[0])
        if not 1<=n<=90:raise ValueError('Choose a period between 1 and 90 days.')
        if len(spans)>1 and any(int(x)!=n for x in spans[1:]):
            raise ValueError('For different-length periods, provide both start and end dates.')
        end=ANCHOR;start=end-timedelta(days=n-1)
    elif re.search(r'\blast week\b',q):
        end=ANCHOR-timedelta(days=ANCHOR.weekday()+1);start=end-timedelta(days=6)
    elif re.search(r'\blast month\b',q):
        end=ANCHOR.replace(day=1)-timedelta(days=1);start=end.replace(day=1)
        before=start-timedelta(days=1)
        return {**f,'start':str(start),'end':str(end),'previous_start':str(before.replace(day=1)),'previous_end':str(before)}
    else:return None
    return {**f,'start':str(start),'end':str(end)}


def clarify_period(ledger, state, base, message=None):
    proposed=cancellation_scope(ledger,base)
    start=date.fromisoformat(proposed['start']);end=date.fromisoformat(proposed['end'])
    previous=[str(start-timedelta(days=(end-start).days+1)),str(start-timedelta(days=1))]
    text=message or (f"Which periods should I compare? Use {start}–{end} versus {previous[0]}–{previous[1]} from the dashboard, or choose another range.")
    return {'mode':'clarification','state':{**state,'pending_period':proposed},'answer':text,'evidence':[],
            'choices':['Use current dashboard selection','Last 7 days','Last 30 days']}
