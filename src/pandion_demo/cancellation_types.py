"""Appointment-type contributions, calculated from complete scoped cohorts."""
import re

from src.pandion_demo.cancellation_chat import cancellation_response, cancellation_scope
from src.pandion_demo.chat_periods import clarify_period, resolve_period
from src.pandion_demo.operational_review import reason_context

LABELS={'assessment':'Assessment','follow_up':'Follow-up'}


def type_comparison(ledger, filters):
    total=reason_context(ledger,filters,'cancelled')
    groups=[]
    for kind,label in LABELS.items():
        c=reason_context(ledger,{**filters,'type':kind},'cancelled')
        current,previous=total['current_appointments'],total['previous_appointments']
        groups.append({'type':kind,'label':label,**c,
                       'contribution_pp':100*(c['current_outcomes']/current-c['previous_outcomes']/previous) if current and previous else None})
    return total,groups


def type_response(service,ledger,filters,question,evidence=False):
    filters=cancellation_scope(ledger,filters)
    out=cancellation_response(service,ledger,filters,'cancellation_analysis',question)
    out['state']['type_parent']=filters
    if filters['type']!='all':
        out.pop('brief',None)
        out['answer']='Your selection contains only '+LABELS[filters['type']]+'. Set the Patient Dashboard appointment type to All before comparing types.'
        return out
    total,groups=type_comparison(ledger,filters)
    out['type_breakdown']=groups
    if not out['comparison']['comparable']:return out
    delta=out['comparison']['delta_pp']
    ranked=sorted(groups,key=lambda r:r['contribution_pp'],reverse=delta>0)
    leaders=[g for g in ranked if abs(g['contribution_pp']-ranked[0]['contribution_pp'])<1e-9] if abs(delta)>1e-9 else []
    names=' and '.join(g['label'] for g in leaders)
    heading=(names+(' contributed equally to' if len(leaders)>1 else ' contributed most to')+
             (' the increase.' if delta>0 else ' the decrease.')) if leaders else 'There was no overall cancellation-rate change.'
    facts=[]
    for g in groups:
        a,b=g['previous_appointments'],g['current_appointments']
        facts.append(f"{g['label']}: {g['previous_outcomes']} cancellations out of {a} appointments before; {g['current_outcomes']} out of {b} now.")
    if any(min(g['previous_appointments'],g['current_appointments'])<20 for g in groups):
        facts.append('At least one group has fewer than 20 appointments in a period. Treat this as a small-sample signal, not a reliable trend.')
    action=('Ask why cancellations changed in that group to inspect its recorded reasons.' if len(leaders)==1 else
            'Choose Assessment or Follow-up to inspect the recorded reasons; there is no single leading group.')
    out['brief']={'headline':heading,'findings':facts,'next_step':action}
    out['answer']=' '.join([heading,*facts,action])
    out['intent']='cancellation_type_evidence' if evidence else 'cancellation_types'
    # Reuse scoped evidence selection independently for each type.
    out['evidence']=[]
    for kind in LABELS:
        child=cancellation_response(service,ledger,{**filters,'type':kind},'cancellation_evidence',question)
        out['evidence'].extend({**e,'text':LABELS[kind]+' · '+e['text']} for e in child['evidence'])
    return out


def handle_types(service,ledger,question,state,dashboard,force=False):
    q=question.lower().strip().rstrip('?.!')
    if re.search(r'\b(clinician|doctor|no.show|psychiatrist|psychologist)\b',q):return None
    requested=force or bool(re.search(r'appointment types?|assessment.*follow.?up|follow.?up.*assessment',q))
    if requested and re.search(r'highest|lowest|most cancellations|fewest cancellations',q):
        return {'mode':'clarification','state':state,'answer':'This analysis ranks contributions to the change, not the highest cancellation rate. Ask which appointment type contributed most to the increase or decrease.','evidence':[]}
    parent=state.get('type_parent')
    pending=state.get('pending_task')=='cancellation_types'
    follow=bool(parent) and (q in {'why','why is that','what should we do next','what should we do first','show supporting evidence','show supporting records','assessment','follow-up','follow up'} or
                            bool(re.fullmatch(r'why did cancellations? (?:increase|change|decrease) in (?:that|this) group',q)))
    if not (requested or pending or follow):return None
    if pending and not requested and not re.search(r'yes|confirm|dashboard selection|last|past|\d{4}-\d{2}-\d{2}',q):return None
    base=state.get('pending_period') or parent or state.get('cancellation_scope') or dashboard
    if requested or pending:
        try:
            scope=resolve_period(question,base)
            if scope is None and re.search(r'\b(last|past|this|previous|today|yesterday)\b|\d{4}',q):
                raise ValueError('Please specify the comparison dates as YYYY-MM-DD, or choose Last 7 days or Last 30 days.')
            if scope is None and not parent and not state.get('cancellation_scope'):
                return clarify_period(ledger,{**state,'pending_task':'cancellation_types'},dashboard)
            return type_response(service,ledger,scope or base,question)
        except ValueError as exc:
            return clarify_period(ledger,{**state,'pending_task':'cancellation_types'},base,str(exc))
    if 'supporting' in q and not state.get('type_focus'):
        return type_response(service,ledger,parent,question,evidence=True)
    if parent['type']!='all':return type_response(service,ledger,parent,question)
    total,groups=type_comparison(ledger,parent)
    if not total['current_appointments'] or not total['previous_appointments']:
        return type_response(service,ledger,parent,question)
    delta=sum(g['contribution_pp'] for g in groups)
    ranked=sorted(groups,key=lambda r:r['contribution_pp'],reverse=delta>0)
    leaders=[g['type'] for g in ranked if abs(g['contribution_pp']-ranked[0]['contribution_pp'])<1e-9] if abs(delta)>1e-9 else []
    explicit='assessment' if q=='assessment' else 'follow_up' if q in {'follow-up','follow up'} else None
    focus=explicit or state.get('type_focus') or (leaders[0] if len(leaders)==1 else None)
    if not focus:
        return {'mode':'clarification','state':state,'answer':'There is no single leading group. Which should I inspect: Assessment or Follow-up?','evidence':[]}
    intent=('cancellation_action' if 'should' in q else 'cancellation_evidence' if 'supporting' in q else
            'cancellation_why' if state.get('type_focus') and q in {'why','why is that'} else 'cancellation_analysis')
    result=cancellation_response(service,ledger,{**parent,'type':focus},intent,question)
    result['state'].update(type_parent=parent,type_focus=focus)
    result['scope_label']=LABELS[focus]
    if 'brief' in result:result['brief']['headline']=LABELS[focus]+': '+result['brief']['headline']
    return result
