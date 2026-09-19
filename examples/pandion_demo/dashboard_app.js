/* All visible metrics are projections of the same versioned synthetic ledger. */
'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const M=PandionModel.create(window.PANDION_SYNTHETIC_OPERATIONS), {add,rate,sum,mean}=PandionModel;
const fmt=n=>n==null?'—':Number(n).toLocaleString('en-AU',{maximumFractionDigits:1});
const money=n=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',maximumFractionDigits:0}).format(n);
const pc=n=>n==null?'—':fmt(n)+'%', hours=n=>fmt(n/60)+'h';
const dateLabel=d=>new Date(d+'T12:00:00Z').toLocaleDateString('en-AU',{day:'numeric',month:'short',timeZone:'UTC'});
const bucketLabel=b=>b.start===b.end?dateLabel(b.start):[dateLabel(b.start),'– '+dateLabel(b.end)];
const chartLegend={position:'bottom',labels:{usePointStyle:true,pointStyle:'circle',boxWidth:7,boxHeight:7,padding:16,font:{size:10},color:'#68738a'}};
const chartGrid={color:'#edf0f6',lineWidth:.7};
const time=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
const palette=['#6d70c4','#b8bbe9','#ffbd75','#f7777b','#15b887'];
const charts={};let bookingPeriod=7, selectedDay=M.anchor, sortAscending=true, currentScope='', clinicianState;
const panelItems={allocation:[],feedback:[]}, liveCache=new Map();
const panelMeta={};
let liveTimer,liveController,liveVersion=0;
function renderPriorities(scope,f){
  const items=panelItems[scope]=M.priorities(scope,f),allocation=scope==='allocation';
  const target=allocation?$('.risk'):$('#feedbackInsights');
  const scopeLabel=allocation?`${f.role} · ${f.type==='all'?'All appointment types':f.type.replaceAll('_',' ')}`:`${f.clinician==='all'?'All clinicians':M.data.clinicians.find(c=>c.id===f.clinician)?.name||f.clinician} · ${{all:"All patients",high_risk:"High-risk patients",new_patient:"New patients",continuing_patient:"Continuing patients"}[f.segment]||f.segment} · ${f.type==='all'?'All appointment types':f.type.replaceAll('_',' ')}`;
  panelMeta[scope]={filters:{...f},range:`${f.start} – ${f.end}`,label:scopeLabel,status:'Rule-based advice',updated:new Date().toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'})};
  const shortCopy={
    'allocation-blocked':['priority patients unmatched','Review constraints and available slots.','red','!'],
    'allocation-ready':['priority patients waiting','Matching slots available; confirm suitability.','red','!'],
    'allocation-overdue':['follow-ups overdue','Review continuity and arrange follow-up.','blue','↻'],
    'allocation-waiting':['patients waiting over 7 days','Contact the longest-waiting patients first.','yellow','7d'],
    'allocation-followup':['follow-ups need booking','Arrange care before the recorded due date.','blue','↻']
  };
  target.innerHTML=(allocation?`<div class="risk-head"><div><h3 class="panel-h">Allocation Risk Panel</h3><div class="panel-desc">Patient demand that needs attention before SLA breach.</div></div><span class="risk-badge">${M.capacity(f).atRisk} AT RISK</span></div>`:`<div class="insights-head"><div class="insights-title"><h2>Key Operational Insights</h2><span class="ai-badge">✦ ${items.length} PRIORITIES</span></div></div>`)+
    items.map((item,i)=>{
      const compact=shortCopy[item.id],button=`<button class="${allocation?'ai-inline-btn':'insight-evidence'}" data-priority-scope="${scope}" data-priority-index="${i}">View detailed explanation</button>`;
      if(allocation)return `<div class="risk-card"><span class="risk-icon ${compact[2]}">${compact[3]}</span><div class="risk-copy"><b title="${esc(item.title)}">${item.records.length} ${compact[0]}</b><p title="${esc(compact[1])}">${compact[1]}</p>${button}</div></div>`;
      const summary=item.id==='feedback-cancellation'?'Review cancellation reasons and rebooking opportunities.':item.id==='feedback-noshow'?'Check reminder delivery and patient confirmation.':'Review patient comments and choose a targeted service improvement.';
      return `<div class="insight"><span class="insight-icon">ⓘ</span><div class="insight-copy"><b>${esc(item.title)}</b><p>${summary}</p></div>${button}</div>`;
    }).join('')+(!items.length?'<p class="data-note">No priorities identified in this scope. Broaden filters if the sample is small.</p>':'');
  scheduleLiveReview(scope,f);
}
function recordSummary(r){
  const field=(label,value)=>`<div><strong>${esc(label)}:</strong> ${esc(value)}</div>`;
  if(r.text)return `<blockquote>${esc(r.text)}</blockquote>`+field('Feedback date',r.date)+field('Clinician',r.clinician||r.clinician_id)+field('Linked appointment',r.appointment_id);
  if(r.followup_due){
    const overdue=Math.round((Date.parse(M.anchor)-Date.parse(r.followup_due))/86400000);
    return field('Patient',r.patient_id)+field('Last completed visit',r.appointment_date)+field('Clinician',r.clinician_name)+field('Follow-up due',r.followup_due)+field('Timing',overdue>0?`${overdue} days overdue as of ${M.anchor}`:overdue===0?'Due on the demo reference date':`Due in ${-overdue} days`)+field('Next appointment','No confirmed future appointment in this ledger')+'<p>Check contact history and ongoing care needs before arranging follow-up.</p>';
  }
  if(r.referral_id)return field('Patient',r.patient_id)+field('Referral received',r.created_date)+field('Waiting',Math.round((Date.parse(M.anchor)-Date.parse(r.created_date))/86400000)+' days as of '+M.anchor)+field('Service',r.role)+field('Appointment type',r.appointment_type.replaceAll('_',' '))+field('Preferred time',r.preferred_time)+field('Continuity',r.clinician_id||'No specific clinician recorded');
  const reason=r.cancellation_reason||r.no_show_reason;
  return field('Patient',r.patient_id)+field('Appointment date',r.appointment_date)+field('Clinician',r.clinician_name)+field('Outcome',r.status.replaceAll('_',' '))+field('Recorded reason',!reason||reason==='Unknown'?'Not recorded':reason);
}
function comparisonDetails(item,f){
  if(!['feedback-cancellation','feedback-noshow'].includes(item.id))return '';
  const c=M.reasonComparison(f,item.id==='feedback-cancellation'?'cancelled':'no_show'),net=c.currentCount-c.previousCount;
  const sign=n=>n>0?'+'+fmt(n):fmt(n),leader=c.breakdown.find(r=>r.rateChange>0),largest=[...c.breakdown].sort((a,b)=>b.current-a.current)[0];
  const finding=leader?`${leader.label==='Unknown'?'Not recorded':leader.label} contributes most to the rate increase (${sign(leader.rateChange)} percentage points; ${sign(leader.change)} cases). ${leader.label==='Unknown'?'This is a documentation gap to investigate, not an identified root cause.':'Check the associated records to understand the operational circumstances.'}`:'No recorded reason increased in case count.';
  const action=leader?.label==='Unknown'?'First ask the operations team to complete missing reasons, then reassess which recorded categories increased most.':leader?`Review the ${leader.current} current records labelled “${leader.label}”, verify the underlying circumstances, and choose an intervention supported by those findings.`:'Review the denominator and case mix before choosing an intervention.';
  item.dataAction=action;
  return `<section class="detail-analysis"><h3>Key finding</h3><p>${esc(finding)}</p><h3>Where the change comes from</h3><p>${c.previousCount} → ${c.currentCount} outcomes (${sign(net)}); appointments ${c.previousTotal} → ${c.currentTotal}. Rate: ${pc(c.previousRate)} → ${pc(c.currentRate)}.</p><p class="data-note">Previous: ${c.previous.start} – ${c.previous.end}<br>Current: ${f.start} – ${f.end}. Same clinician, patient and appointment-type filters.</p><table><caption>Recorded reasons across all matching appointments</caption><thead><tr><th>Reason</th><th>Prior</th><th>Now</th><th>Δ cases</th><th title="Percentage-point contribution to the total rate change">Rate contribution</th></tr></thead><tbody>${c.breakdown.map((r,i)=>`<tr><th scope="row"><button class="reason-link" data-reason-index="${i}">${esc(r.label==='Unknown'?'Not recorded':r.label)}</button></th><td>${r.previous}</td><td>${r.current}</td><td>${sign(r.change)}</td><td>${r.rateChange==null?'—':sign(r.rateChange)}</td></tr>`).join('')}</tbody></table>${largest&&leader&&largest.label!==leader.label?`<p>The largest current category is ${esc(largest.label)} (${largest.current} cases), but its change is ${sign(largest.change)}. The largest category is not necessarily the source of the increase.</p>`:''}<p class="data-note">Rate contribution (percentage points) = 100 × (current reason count ÷ current appointments − prior reason count ÷ prior appointments). These contributions sum to the overall rate change before rounding. This identifies recorded sources of change; workflow logs or contact notes are still needed to establish the underlying cause. Small samples should be interpreted cautiously.</p></section>`;
}
const allocationLabels={ready:'Matching availability',capacity:'No free slot for this service',continuity:'Original clinician unavailable',type:'Appointment type mismatch',time:'Preferred time unavailable',unknown:'Time preference needs checking'};
const allocationActions={ready:'Confirm current care needs, suitability and availability with staff, then contact the patient.',capacity:'Review capacity with the service lead; confirm options before contacting the patient.',continuity:'Ask the original clinician about availability; any change of clinician requires a continuity review.',type:'Review slots for the required appointment type; do not substitute another type automatically.',time:'Confirm whether the patient can accept other times or ask staff to review scheduling options.',unknown:'Confirm the patient’s time preference before matching.'};
function allocationDetailsView(item,f){
  if(!item.id.startsWith('allocation-'))return '';
  const rows=M.allocationDetails(item.records,f),counts=Object.fromEntries(Object.keys(allocationLabels).map(k=>[k,rows.filter(r=>r.blocker===k).length]));
  const old=rows.filter(r=>r.bucket==='Over 30 days').length;
  item.dataAction=old?`First confirm ongoing care needs for the ${old} follow-ups overdue more than 30 days. Then review available matches and resolve scheduling barriers with staff.`:`Review ${counts.ready} patients with candidate availability first; route other scheduling constraints to the appropriate staff member.`;
  return `<section class="detail-analysis"><h3>Allocation assessment</h3><p>${counts.ready} of ${rows.length} records have at least one matching free slot in this window. ${rows.length-counts.ready} need a constraint or data check.</p>${old?`<p>${old} follow-ups are over 30 days overdue. Use the linked care reviews above where available; verify ongoing need where it remains undocumented. An old due date alone does not establish active need.</p>`:''}${rows.some(r=>r.overdue!==null)?'<h3>Follow-up timing</h3>'+['1–7 days','8–30 days','Over 30 days','upcoming'].map(bucket=>`<p>${bucket==='upcoming'?'Due today or later':esc(bucket)}: ${rows.filter(r=>r.bucket===bucket).length}</p>`).join(''):''}<h3>What needs resolving</h3>${Object.entries(counts).filter(([,n])=>n).map(([key,n])=>`<details class="detail-records"><summary>${allocationLabels[key]} · ${n} records</summary><p>${allocationActions[key]}</p>`+rows.filter(r=>r.blocker===key).map(r=>`<article class="ai-evidence-card">${recordSummary(r.record)}${r.next?`<p>Earliest candidate: ${esc(r.next.date)} · ${time(r.next.start_minute)} · ${esc(r.next.clinician_id)}<br>${r.matchedSlots} matching slots (not reserved).</p>`:''}<small>Source: ${esc(r.record.referral_id||r.record.appointment_id)}</small></article>`).join('')+'</details>').join('')}<p class="data-note">For a linked time-conflict reply, matching uses the latest stated time period; otherwise it uses the stored preference. Checks run in order: service capacity → original clinician → appointment type → preferred time. Each record is counted under its first blocking check; other constraints may coexist. Slots can match multiple patients. These are scheduling checks, not clinical suitability assessments or evidence of failed outreach.</p></section>`;
}
const workflowCopy={
  time_mismatch:{title:'Offered times explicitly declined',status:'Supported by linked records',meaning:'A patient reply explicitly rejects the linked offer because its time period does not match their stated availability. This supports a specific booking obstacle, not the entire history of the delay.',action:'Scheduling coordinator: use the latest stated availability to check suitable options and confirm with the patient; do not reuse the old preference without checking.'},
  no_reply_recorded:{title:'Offer sent; no later reply in imported history',status:'Observed state — not confirmed non-response',meaning:'The latest imported event is an offer. Contact occurred, which is evidence against assuming no outreach. Replies outside this ledger may be missing.',action:'Operations coordinator: check message delivery and other contact channels before deciding whether to follow up.'},
  external_report:{title:'Patient reports an external booking',status:'Recorded report — needs confirmation',meaning:'The patient has reported arranging follow-up elsewhere. There is no independent confirmation or completed care-plan reconciliation.',action:'Care coordinator: confirm the external arrangement and ask the responsible clinician to reconcile the follow-up plan before further offers.'},
  active_need:{title:'Clinician recently confirmed ongoing need',status:'Supported fact — delay cause unresolved',meaning:'A clinician-recorded review supports continuing follow-up. This is evidence against treating an old due date alone as an inactive need; it does not explain the booking delay.',action:'Scheduling coordinator: check candidate availability and contact history, then agree a suitable appointment with the patient.'},
  missing_history:{title:'No linked workflow history available',status:'Insufficient evidence',meaning:'No usable linked contact or care-review events were imported. Missing records do not prove no contact took place.',action:'Operations coordinator: retrieve contact history and the current care plan before attributing a cause.'},
  needs_review:{title:'Latest event needs manual interpretation',status:'Unresolved',meaning:'The latest event does not support a specific rule-based conclusion. Earlier findings may have been superseded.',action:'Operations coordinator: review the complete timeline and verify the current state.'}
};
function investigationView(item,f){
  if(!item.id.startsWith('allocation-')||!item.records.some(r=>r.followup_due))return '';
  const cases=M.followupCases(item.records),groups=Object.keys(workflowCopy).map(key=>({key,rows:cases.filter(c=>c.finding===key)})).filter(g=>g.rows.length);
  const documented=cases.filter(c=>c.events.length).length;
  item.workflowAction=groups.slice(0,2).map(g=>`${g.rows.length} records: ${workflowCopy[g.key].action}`).join(' ');
  return '<section class="detail-analysis"><h3>What the workflow records show</h3><p><strong>Synthetic demonstration records — not real patient communications.</strong></p><p>'+documented+' of '+cases.length+' follow-ups have linked workflow history. Each record appears once below, classified by its latest imported event as of '+esc(M.anchor)+'.</p>'+
    groups.map(g=>{const c=workflowCopy[g.key];return '<details class="detail-records"><summary>'+esc(c.title)+' · '+g.rows.length+' records · '+esc(c.status)+'</summary><p>'+esc(c.meaning)+'</p><h4>Recommended action</h4><p>'+esc(c.action)+'</p><details><summary>View linked event timelines ('+g.rows.length+')</summary>'+g.rows.map(r=>'<article class="ai-evidence-card"><h4>'+esc(r.patient_id)+'</h4><p>Follow-up source: '+esc(r.source)+'</p>'+(r.events.length?'<ol>'+r.events.map(e=>'<li><strong>'+esc(e.date)+' · '+esc(e.actor)+'</strong><p>'+esc(e.note)+'</p><small>'+esc(e.event_id)+(e.reply_to?' · replies to '+esc(e.reply_to):'')+(r.evidence_ids.includes(e.event_id)?' · supports this finding':'')+'</small></li>').join('')+'</ol>':'<p>No linked events available; no cause assigned.</p>')+'</article>').join('')+'</details></details>';}).join('')+
    '<details class="detail-records"><summary>Analysis limits and remaining checks</summary><p>Findings are derived from dated events, not generated root-cause labels. A rejected offer is a documented obstacle, not proof it caused the full overdue interval. Current candidate slots may be shared and do not prove historical availability. Patient reports require confirmation. No booking, outreach or care-plan change has been executed.</p></details></section>';
}
function openPriority(scope,index){
  const item=panelItems[scope][index],meta=panelMeta[scope];
  currentScope=`priority:${scope}:${index}`;
  drawer(item.title,scope==='allocation'&&item.records.length&&item.records.every(r=>r.followup_due&&r.followup_due<M.anchor)?operationsView(item,meta):managerDetail(item,meta,scope));
}
function operationsView(item,meta){
  const summary=M.followupOperations(item.records);
  const labels={time_mismatch:'Offered times did not suit patients',external_report:'Patients report booking elsewhere'};
  const steps={
    time_mismatch:['Recover bookings with a clear time conflict','Scheduling coordinator: find slots matching the latest stated availability, check that patients are not competing for the same slot, then send specific options.','New confirmed bookings, associated booking value and vacant hours filled.'],
    active_need:['Convert confirmed follow-up demand','Scheduling coordinator: check the last contact, then offer suitable slots to patients whose clinician has confirmed ongoing need.','Booking conversion and reduction in the overdue queue.'],
    external_report:['Confirm potential demand leakage','Care coordinator: confirm the external arrangement, record why the patient chose another provider where they are willing to explain, and reconcile the follow-up plan.','Confirmed external bookings and recurring reasons for choosing another provider.'],
    no_reply_recorded:['Follow up outstanding offers','Operations coordinator: check delivery and other contact channels before sending a targeted follow-up.','Offers converted to bookings and unnecessary repeat contacts avoided.'],
    missing_history:['Resolve missing contact history','Operations coordinator: retrieve the latest contact and care-plan records before choosing a booking action.','Records with a clear next action and responsible owner.'],
    needs_review:['Review unresolved cases','Operations coordinator: review the latest event and establish the current booking state.','Cases moved to an actionable group.']
  };
  const action=(a,i)=>{const s=steps[a.key];return `<article><h4>${i+1}. ${esc(s[0])} · ${a.count} follow-ups</h4><p>${esc(s[1])}</p><p><strong>Track:</strong> ${esc(s[2])}</p>${supportingEvidence(item,a.key)}</article>`;};
  item.rulePlan=summary.actions.slice(0,3).map(action).join('');
  return `<p class="ai-summary">${esc(meta.range)} · ${esc(meta.label)}</p><p class="data-note">Synthetic demo data · ${summary.total} overdue follow-ups</p><section class="detail-analysis"><h3>Business impact</h3><p>Unbooked follow-ups put future appointment revenue at risk. If other bookings do not fill the vacant clinician hours, utilisation and profit may also fall.</p><h3>Main booking obstacles</h3>`+
    (summary.drivers.length?'<div class="ops-metrics">'+summary.drivers.map(d=>`<article class="ops-metric"><strong>${fmt(d.share)}%</strong><b>${esc(labels[d.key])}</b><small>${d.count} of ${summary.total} · ${d.key==='external_report'?'Patient-reported; confirm booking':'Supported by linked replies'}</small></article>`).join('')+'</div>':'<p>No specific booking obstacle is established in the available records. Start with the actionable groups below.</p>')+
    `<p class="data-note">${summary.tied?'These two signals are tied in share. ':''}Percentages use all ${summary.total} overdue follow-ups in this selection; other records are workflow states or evidence gaps, not established reasons.</p><h3>What to do first</h3>`+
    `<p id="detailReviewStatus" class="data-note">${esc(item.review?.action_plan?'RAG-generated plan · staff review required':meta.status+' · rule-based plan shown')}</p><div id="operationalActionPlan">${operationalPlan(item)}</div>`+
    '</section><details class="detail-records"><summary>How priorities and impact are assessed</summary><p>When available, RAG ranks actions using current verified ledger facts and retrieved demo guidance. Otherwise, rules prioritise explicit time conflict, confirmed ongoing need, then reported external booking. Citations are checked for source membership, not proof that every model statement is correct; staff review is required. It is not a calculated profit ranking or clinical urgency assessment. No revenue loss amount is estimated. Booking value is not realised revenue or profit; cost and replacement bookings must be considered separately. Operational outcome measures are proposed, not results already achieved.</p><div id="detailPolicies">'+policyDetails(item)+'</div></details>';
}
function supportingEvidence(item,group,step){
  const cases=M.followupCases(item.records).filter(c=>c.finding===group);
  const selected=step?cases.flatMap(c=>c.events).filter(e=>step.event_ids.includes(e.event_id)):(cases[0]?.events.filter(e=>cases[0].evidence_ids.includes(e.event_id))||[]);
  const eventView=e=>`<p>${esc(e.date)} · ${esc(e.actor)}: ${esc(e.note)}<br><small>${esc(e.event_id)}</small></p>`;
  const policies=step?(item.policies||[]).filter(p=>step.sources.includes(p.source)):[];
  return `<details><summary>Supporting evidence</summary><p>${cases.length} follow-ups in this group · synthetic records. Examples support the finding; counts use the full group.</p>`+selected.map(eventView).join('')+(!selected.length?'<p>No linked events support a specific cause. This action addresses missing information.</p>':'')+(policies.length?'<h4>SOP guidance</h4><p class="data-note">Action guidance, not proof of a cause.</p>'+policies.map(p=>`<p><strong>${esc(p.source)}</strong> · ${esc(p.quote)}</p>`).join(''):'')+`<details><summary>View full group timelines (${cases.length})</summary>`+cases.map(c=>`<article class="ai-evidence-card"><h4>${esc(c.patient_id)}</h4><small>Follow-up: ${esc(c.source)}</small>${c.events.length?c.events.map(eventView).join(''):'<p>No linked workflow history available.</p>'}</article>`).join('')+'</details></details>';
}
function operationalPlan(item){
  if(!item.review?.action_plan)return item.rulePlan||'';
  const cases=M.followupCases(item.records);
  return item.review.action_plan.map((step,i)=>{
    const count=cases.filter(c=>c.finding===step.group).length;
    return `<article class="ops-first"><span class="ops-tag">PRIORITY ${i+1} · ${count} FOLLOW-UPS</span><h4>${esc(workflowCopy[step.group]?.title||step.group)}</h4><p><strong>Why prioritise:</strong> ${esc(step.why)}</p><p>${esc(step.action)}</p><p><strong>Track:</strong> ${esc(step.measure)}</p>${supportingEvidence(item,step.group,step)}</article>`;
  }).join('');
}
function managerDetail(item,meta,scope){
  const f=meta.filters,n=item.records.length;
  let impact='',findings='',action=item.action,track='',extra='',why='',evidenceRows=item.records;
  const metric=(value,label,note)=>`<article class="ops-metric"><strong>${esc(value)}</strong><b>${esc(label)}</b><small>${esc(note)}</small></article>`;
  if(scope==='allocation'){
    const rows=M.allocationDetails(item.records,f),ready=rows.filter(r=>r.blocker==='ready').length;
    impact=item.id==='allocation-followup'?'Unbooked follow-up demand puts future appointment revenue at risk. Booking before due dates helps protect continuity and planned clinician utilisation.':'Waiting demand can turn into lost bookings. Unfilled clinician hours reduce utilisation and can put revenue and profit at risk.';
    const barriers=Object.keys(allocationLabels).filter(k=>k!=='ready').map(key=>({key,count:rows.filter(r=>r.blocker===key).length})).filter(r=>r.count).sort((a,b)=>b.count-a.count);
    findings=metric(pc(100*ready/n),'Have candidate availability',`${ready} of ${n} records; slots not reserved`)+barriers.slice(0,2).map(r=>metric(pc(100*r.count/n),allocationLabels[r.key],`${r.count} of ${n}; first blocking check`)).join('');
    if(ready){action=item.id==='allocation-followup'?'Confirm ongoing follow-up need, then offer suitable slots before the due date. Check shared slots before sending offers.':'Start with patients who have matching availability. Check shared slots and suitability, then offer specific times; within this group, work through the oldest referrals first.';}
    else if(barriers.length)action=allocationActions[barriers[0].key];
    track='Confirmed bookings, booking value and previously vacant hours filled; remaining waiting demand.';
    why=ready?`${ready} of ${n} records have candidate availability, giving the team a concrete route to confirmed bookings.`:'No record has a matching candidate in this window; resolve the most common recorded constraint before making offers.';
    const target=ready?'ready':barriers[0]?.key;
    evidenceRows=rows.filter(r=>r.blocker===target).map(r=>r.record);
    extra='<p>Matching checks service, clinician continuity, appointment type and recorded time preference. Shares use all records in this priority. Candidate slots may be shared; matching is not a reservation or clinical suitability assessment.</p>';
  }else if(['feedback-cancellation','feedback-noshow'].includes(item.id)){
    const cancelled=item.id==='feedback-cancellation',c=M.reasonComparison(f,cancelled?'cancelled':'no_show');
    impact=cancelled?'Cancellations put appointment revenue at risk. When released slots cannot be refilled, clinician utilisation and profit can fall.':'Missed appointments can leave paid clinician time unused and reduce revenue opportunities. Rebooking and preventing repeat missed visits can help recover demand.';
    const top=c.breakdown.filter(r=>r.current).sort((a,b)=>b.current-a.current).slice(0,2);
    findings=top.map(r=>metric(pc(100*r.current/c.currentCount),r.label==='Unknown'?'Reason not recorded':r.label,`${r.current} of ${c.currentCount} ${cancelled?'cancellations':'missed appointments'}`)).join('');
    const leader=c.breakdown.find(r=>r.rateChange>0);
    why=leader?`${leader.label==='Unknown'?'Missing reasons':leader.label} contributes most to the rate increase (${fmt(leader.rateChange)} percentage points). Target this change rather than assuming the largest current category caused the increase.`:'Check the appointment denominator and recorded circumstances before choosing a targeted intervention.';
    if(leader){const reasonKey=cancelled?'cancellation_reason':'no_show_reason';evidenceRows=item.records.filter(r=>(r[reasonKey]||'Unknown')===leader.label);}
    action=leader?.label==='Unknown'?'First complete the missing reasons in affected records so the team targets the right problem. In parallel, offer suitable replacement appointments to patients who want to rebook.':leader?`Start with records labelled “${leader.label}”, the largest contributor to the rate increase. Verify the circumstances, agree a targeted change, and offer suitable rebooking options.`:item.action;
    track=`Rebooked appointments, refilled hours and ${cancelled?'cancellation':'no-show'} rate in the next equal-length period.`;
    extra=comparisonDetails(item,f);
    findings+=`<p class="data-note">Current rate ${pc(c.currentRate)} vs ${pc(c.previousRate)} previously. Shares above describe recorded outcomes, not proven root causes. Largest current groups and largest contributors to the increase may differ.</p>`;
  }else{
    const t=M.themes(f);
    impact='Poor booking or service experiences can create repeat administrative work and discourage future bookings, putting retention and revenue at risk.';
    findings=metric(pc(100*n/t.total),'Mention this feedback theme',`${n} of ${t.total} filtered survey responses`);
    action=item.action+' Start with the original comments to identify the repeated friction before changing the process.';
    track='Share of feedback mentioning this issue in the next comparable period, plus the affected workflow’s completion rate.';
    why=`This theme appears in ${n} of ${t.total} filtered responses. Reviewing repeated feedback provides a specific starting point for a workflow improvement.`;
    extra='<p>Feedback themes are pre-labelled primary topics, not established causes of cancellations or lost revenue.</p>';
  }
  const recordCard=r=>`<article class="ai-evidence-card">${recordSummary(r)}<small>Source: ${esc(r.record_id||r.referral_id||r.appointment_id)}</small></article>`;
  return `<p class="ai-summary">${esc(meta.range)} · ${esc(meta.label)}</p><p class="data-note">Synthetic demo data · ${n} supporting records</p><section class="detail-analysis"><h3>Business impact</h3><p class="ops-impact">${esc(impact)}</p><h3>Main findings</h3><div class="ops-metrics">${findings}</div><h3>What to do first</h3><article class="ops-first"><span class="ops-tag">PRIORITY 1</span><p id="mainInsightStatus" class="data-note">${esc(scope==='feedback'?(item.review?.why_prioritise?'RAG-generated advice · staff review required':meta.status+' · rule-based advice shown'):'Rule-based advice')}</p><p><strong>Why prioritise:</strong> <span id="mainInsightWhy">${esc(scope==='feedback'&&item.review?.why_prioritise||why)}</span></p><p id="mainInsightAction">${esc(scope==='feedback'&&item.review?.recommendation||action)}</p><p><strong>Track:</strong> <span id="mainInsightMeasure">${esc(scope==='feedback'&&item.review?.measure||track)}</span></p><details><summary>Supporting evidence</summary><p>${evidenceRows.length} records support the selected focus; up to two examples shown. Counts use the full selected cohort.</p>${evidenceRows.slice(0,2).map(recordCard).join('')}<div id="detailPolicies">${policyDetails(item)}</div><details><summary>View full records (${n})</summary>${item.records.map(recordCard).join('')}</details><details><summary>View calculations and analysis limits</summary>${extra}<div id="reasonRecords"></div></details>${scope==='feedback'?'':`<details><summary>Supplementary AI advice</summary><p id="detailReviewStatus">${esc(meta.status)}</p><p id="detailRecommendation">${esc(item.review?.recommendation||item.dataAction||item.action)}</p></details>`}</details></article></section>`;
}
function policyDetails(item){return item.policies?.length?'<details class="detail-records"><summary>Retrieved demo guidance</summary>'+evidence(item.policies.map(r=>({record_id:r.source,text:r.quote})),r=>r.text)+'</details>':'';}
function showReasonRecords(index){
  const [,scope,itemIndex]=currentScope.split(':'),item=panelItems[scope]?.[Number(itemIndex)];
  if(!item)return;
  const f=panelMeta[scope].filters,kind=item.id==='feedback-cancellation'?'cancelled':'no_show',c=M.reasonComparison(f,kind),reason=c.breakdown[index];
  if(!reason)return;
  const key=kind==='cancelled'?'cancellation_reason':'no_show_reason';
  const records=period=>M.reasons(period,kind).filter(r=>(r[key]||'Unknown')===reason.label);
  $('#reasonRecords').innerHTML=`<section class="detail-records"><h3>${esc(reason.label==='Unknown'?'Not recorded':reason.label)} · matching evidence</h3>`+[[f,'Current period'],[c.previous,'Previous period']].map(([period,label])=>{const rows=records(period);return `<details ${label==='Current period'?'open':''}><summary>${label}: ${rows.length} records</summary>`+(rows.map(r=>`<article class="ai-evidence-card">${recordSummary(r)}<small>Source: ${esc(r.appointment_id)}</small></article>`).join('')||'<p>No matching records.</p>')+'</details>';}).join('')+'</section>';
  $('#reasonRecords').scrollIntoView({block:'start',behavior:'smooth'});
}
function evidenceOverview(item){
  const counts=new Map();
  for(const r of item.records){const label=r.clinician_role||r.role||r.theme_label||'Other';counts.set(label,(counts.get(label)||0)+1);}
  const groups=[...counts].sort((a,b)=>b[1]-a[1]).map(([label,count])=>`${label}: ${count}`).join(' · ');
  const due=item.records.filter(r=>r.followup_due),overdue=due.filter(r=>r.followup_due<M.anchor);
  return `<p class="ai-summary">${esc(groups)}</p>`+(due.length?`<p class="ai-summary">${overdue.length} already overdue; ${due.length-overdue.length} due on or after ${M.anchor}. ${overdue.length?'Earliest outstanding due date: '+esc(overdue.map(r=>r.followup_due).sort()[0])+'.':''} “Completed” refers to the earlier visit, not the outstanding follow-up.</p>`:'');
}
function scheduleLiveReview(scope,f){
  const page=scope==='allocation'?'clinician':'feedback';
  if(!$('#'+page).classList.contains('active'))return;
  clearTimeout(liveTimer);liveController?.abort();const version=++liveVersion;
  if(!['127.0.0.1','localhost'].includes(location.hostname))return;
  const candidates=panelItems[scope].map(item=>({id:item.id,title:item.title,impact:item.impact,action:item.action,source_ids:item.records.map(r=>r.record_id||r.referral_id||r.appointment_id)}));
  if(!candidates.length)return;
  const payload={scope,filters:f,candidates},key=JSON.stringify(payload);
  const setStatus=text=>{panelMeta[scope].status=text;if(currentScope.startsWith(`priority:${scope}:`)){const item=panelItems[scope][Number(currentScope.split(':')[2])];if($('#operationalActionPlan'))$('#operationalActionPlan').innerHTML=operationalPlan(item);if(scope==='feedback'&&$('#mainInsightStatus')){$('#mainInsightStatus').textContent=item.review?.why_prioritise?'RAG-generated advice · staff review required':text+' · rule-based advice shown';if(item.review?.why_prioritise){$('#mainInsightWhy').textContent=item.review.why_prioritise;$('#mainInsightAction').textContent=item.review.recommendation;$('#mainInsightMeasure').textContent=item.review.measure;}}if($('#detailReviewStatus'))$('#detailReviewStatus').textContent=text;if($('#detailRecommendation'))$('#detailRecommendation').textContent=item.review?.recommendation||item.workflowAction||item.dataAction||item.action;if($('#detailPolicies'))$('#detailPolicies').innerHTML=policyDetails(item);}};
  const show=output=>{
    if(version!==liveVersion)return;
    if(output.generation_mode!=='live_rag'){setStatus('AI review unavailable · rule-based advice shown');return;}
    for(const result of output.items){
      const index=panelItems[scope].findIndex(item=>item.id===result.id);if(index<0)continue;
      const item=panelItems[scope][index];item.review=result;const sources=[...result.sources,...(result.action_plan||[]).flatMap(s=>s.sources)];item.policies=output.evidence.filter(e=>sources.includes(e.source));
    }
    setStatus('Statistics calculated · AI recommendation generated');
  };
  if(liveCache.has(key)){show(liveCache.get(key));return;}
  setStatus('Reviewing priorities against operational guidance…');
  liveTimer=setTimeout(async()=>{
    liveController=new AbortController();const controller=liveController,timeout=setTimeout(()=>controller.abort(),60000);
    try{
      const response=await fetch('/api/operational-review',{method:'POST',headers:{'content-type':'application/json'},signal:controller.signal,body:JSON.stringify(payload)});
      const output=await response.json();if(!response.ok)throw new Error('Analysis unavailable');
      if(version!==liveVersion)return;
      if(output.generation_mode==='live_rag')liveCache.set(key,output);
      show(output);
    }catch(error){if(version===liveVersion)setStatus('AI review unavailable · rule-based advice shown');}
    finally{clearTimeout(timeout);}
  },700);
}
function toast(s){$('#toast').textContent=s;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),3000);}
function draw(id,labels,sets,type='bar',options={}){
  const datasets=sets.map((s,i)=>({label:s.label,data:s.data,backgroundColor:palette[i%5],borderColor:palette[i%5],borderWidth:type==='line'?2:0,tension:0,pointRadius:type==='line'?3:0,spanGaps:false,...s}));
  if(charts[id]&&charts[id].config.type!==type){charts[id].destroy();delete charts[id];}
  if(charts[id]){charts[id].data={labels,datasets};charts[id].options=optionsFor(type,options);charts[id].update('none');return;}
  charts[id]=new Chart($('#'+id),{type,data:{labels,datasets},options:optionsFor(type,options)});
}
function optionsFor(type,options){return {responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:type!=='doughnut',labels:{boxWidth:9,font:{size:10}}},tooltip:{enabled:true}},...(type==='doughnut'?{}:{scales:{x:{grid:{display:false},ticks:{maxTicksLimit:8,font:{size:10}}},y:{beginAtZero:true,ticks:{font:{size:10}}}}}),...options};}
const controls=scope=>$$(`[data-scope="${scope}"]`);
function overviewFilter(previous=false){const c=controls('overview');return {...M.range(Number(c[2].value),previous),role:c[0].value,status:c[1].value};}
function clinicianFilter(){const c=controls('clinician');return {start:add(M.anchor,1),end:add(M.anchor,Number(c[2].value)),role:c[0].value,type:c[1].value};}
function feedbackFilter(previous=false){const c=controls('feedback');return {...M.range(Number(c[0].value),previous),clinician:c[1].value,segment:c[2].value,type:c[3].value};}
function delta(n,p,pp=false){const diff=Math.round((n-p)*10)/10||0;const percent=p?(Math.round((n-p)/p*1000)/10||0):0;return n==null||p==null?'No comparison':pp?`${diff>=0?'+':''}${fmt(diff)} pp`:(p?`${percent>=0?'+':''}${fmt(percent)}%`:n?'New activity':'No change');}
function note(parent,id,text){let el=$('#'+id);if(!el){el=document.createElement('p');el.id=id;el.className='data-note';$(parent).append(el);}el.textContent=text;}
function shade(n){return n==null?'#e8ebf1':n<30?'#efb8a5':n<50?'#eac29c':n<65?'#aaaed6':n<80?'#8d92d2':'#7379c1';}
function bookingShade(n){return n==null?'#e8ebf1':n>=85?'#41488f':n>=70?'#6269bf':n>=50?'#7066e8':'#c8c6f5';}
function renderOverview(){
  const f=overviewFilter(),s=M.stats(f),p=M.stats(overviewFilter(true)), bs=M.buckets(f,Number(controls('overview')[2].value)>30?12:8),b=bs.map(x=>M.stats(x));
  [['rev',money(s.revenue)],['appointments',fmt(s.total)],['patients',fmt(s.patients)],['util',pc(s.utilisation)],['totalAppt',fmt(s.total)],['cancelledAppt',fmt(s.cancelled)],['rescheduledAppt',fmt(s.rescheduled)],['completedAppt',fmt(s.confirmed)]].forEach(([id,v])=>$('#'+id).textContent=v);
  const vals=['revenue','total','patients','utilisation'];
  $$('.overview-kpi').forEach((card,i)=>{card.querySelector('.trend-chip').textContent=delta(s[vals[i]],p[vals[i]],i===3);card.querySelector('.trend-chip').className='trend-chip '+(s[vals[i]]>=p[vals[i]]?'green':'red');card.querySelector('.trend-caption').textContent='vs previous '+controls('overview')[2].value+' days';
    const series=M.sparkline(f,vals[i]),data=series.map(x=>x.value),max=Math.max(1,...data.filter(v=>v!=null)),step=80/Math.max(1,data.length-1);
    const spark=card.querySelector('.mini-spark');spark.setAttribute('role','img');spark.setAttribute('aria-label',`${vals[i]}: rolling 7-day ${i===3?'weighted utilisation':i===2?'unique patients':'total'}`);
    const title=`${vals[i]} · rolling 7-day ${i===3?'weighted rate':'values'}\n`+series.map(x=>`${x.date}: ${i===0?money(x.value):i===3?pc(x.value):fmt(x.value)}`).join('\n');
    spark.innerHTML=`<title>${esc(title)}</title>`+([1,2].includes(i)?data.map((v,j)=>`<rect x="${2+j*step}" y="${32-(v||0)/max*29}" width="${Math.max(1,step*.6)}" height="${(v||0)/max*29}" rx=".4" fill="currentColor"/>`).join(''):`<path d="${data.map((v,j)=>v==null?'':`${j===0||data[j-1]==null?'M':'L'}${2+j*step},${32-v/max*29}`).join(' ')}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`);
  });
  note('#overview .appointment-stat','accountingNote',`${dateLabel(f.start)} – ${dateLabel(f.end)} · Appointments per date range`);
  $('#accountingNote').title=`Confirmed includes ${s.completed} completed and ${s.no_show} no-shows. Late cancellation fees ${money(s.fees)} are separate. Unique patients are not additive across statuses.`;
  draw('appointmentChart',bs.map(bucketLabel),['confirmed','rescheduled','cancelled'].map(k=>({label:k[0].toUpperCase()+k.slice(1),data:b.map(x=>x[k]),maxBarThickness:38,categoryPercentage:.68,barPercentage:.88})), 'bar',{interaction:{mode:'index',intersect:false},scales:{x:{stacked:true,offset:true,grid:{display:false},ticks:{autoSkip:false,maxRotation:0,font:{size:10},padding:9}},y:{stacked:true,beginAtZero:true,grid:chartGrid,ticks:{precision:0,maxTicksLimit:6}}},plugins:{legend:chartLegend,tooltip:{callbacks:{title:items=>{const x=bs[items[0].dataIndex];return x.start+' → '+x.end;},footer:items=>'Total: '+b[items[0].dataIndex].total}}}});
  const roles=[...new Set(M.data.clinicians.map(c=>c.role))].filter(r=>f.role==='All Roles'||r===f.role);
  const roleColors={'Psychiatrist':'#555b98','Paediatrician':'#b0b4dd','Psychologist':'#f08082','Coaching':'#ffbf6a','Allied Service':'#ffedcb'};
  draw('professionChart',roles,[{label:'Utilisation rate',data:roles.map(role=>M.stats({...f,role}).utilisation),backgroundColor:roles.map(role=>roleColors[role]),borderRadius:0,barThickness:18}],'bar',{indexAxis:'y',layout:{padding:{top:4}},scales:{x:{min:0,max:100,title:{display:true,text:'Utilisation Rate (%)'},grid:{color:'#edf0f6',borderDash:[4,4]}},y:{grid:{display:false}}},plugins:{legend:{display:false}}});
  const heatBuckets=M.buckets(f,5);
  $('#professionHeatmap').style.gridTemplateColumns=`78px repeat(${heatBuckets.length},1fr)`;
  $('#professionHeatmap').innerHTML=roles.map(role=>`<span class="rowlab">${esc(role)}</span>`+heatBuckets.map(x=>{const t=M.stats({...x,role});return `<span class="cell" title="${x.start}–${x.end}: ${hours(t.used)} / ${hours(t.capacity)}" style="background:${shade(t.utilisation)}">${pc(t.utilisation)}</span>`;}).join('')).join('')+'<span></span>'+heatBuckets.map(x=>`<span class="axis">${dateLabel(x.start)}</span>`).join('');
  const life=bs.map(x=>M.lifecycle(x)),kinds=['reactivated','new','inactivity','inactivated'];
  draw('patientTrend',bs.map(bucketLabel),kinds.map((kind,i)=>({label:['Reactivated','New','Inactivity','Inactivated'][i],data:life.map(events=>events.filter(e=>e.kind===kind).length*(i>1?-1:1)),backgroundColor:['#6d70c4','#b8bbe9','#ffc97f','#ed9090'][i],stack:'lifecycle',maxBarThickness:25,categoryPercentage:.64})), 'bar',{interaction:{mode:'index',intersect:false},scales:{x:{stacked:true,offset:true,grid:{display:false},ticks:{autoSkip:false,maxRotation:0,font:{size:9}}},y:{stacked:true,grid:chartGrid,ticks:{precision:0,maxTicksLimit:5}}},plugins:{legend:{...chartLegend,position:'top',labels:{...chartLegend.labels,padding:12,font:{size:9}}},tooltip:{callbacks:{title:items=>{const x=bs[items[0].dataIndex];return x.start+' → '+x.end;},label:ctx=>`${ctx.dataset.label}: ${Math.abs(ctx.raw)} patients`}}}});
  note('#overview .patient-trend','patientDefinition','Patient activity · all appointment statuses ⓘ');
  $('#patientDefinition').title='Demo rules: New = first completed visit, Reactivated = return after >45 days, Inactivity = 45 days without a completed visit, Inactivated = 90 days (administrative dormancy, not clinical discharge). Bars count state transitions, not negative patient numbers. Click for source events.';
  $('#patientDefinition').onclick=()=>drawer('Patient lifecycle definitions & records',`<p>${esc($('#patientDefinition').title)}</p>`+evidence(M.lifecycle(f).slice(0,30),r=>`${r.date} · ${r.patient_id} · ${r.kind} · source ${r.source_id}`));
  const reviews=M.surveys(f),previous=M.surveys(overviewFilter(true));
  $('#overviewRatings').innerHTML=[['quality','Service Satisfaction'],['booking','Reservation Satisfaction']].map(([k,label])=>`<div class="rating" title="${reviews.filter(r=>r[k]!=null).length} valid responses"><div>${label}</div><strong>${fmt(mean(reviews,k))}/5</strong><span class="up">${delta(mean(reviews,k),mean(previous,k),true).replace(' pp','')}</span></div>`).join('')+`<div class="rating" title="Overall score below 3/5, out of ${reviews.length} responses">Number of Below<br>Average Review<br><strong>${reviews.filter(r=>r.overall<3).length}</strong></div>`;
  $('#overviewAlerts').innerHTML=`<div class="alert-chip ${f.status==='All Status'&&s.cancellationRate>15?'red':'green'}" title="${s.cancelled}/${s.total} selected attempts">ⓘ Cancellation ${pc(s.cancellationRate)}</div><div class="alert-chip green">↗ ${reviews.length} survey responses</div><div class="alert-chip ${reviews.length<5?'red':'green'}">${reviews.length<5?'ⓘ Insufficient evidence':'♙ Quality '+fmt(mean(reviews,'quality'))+'/5'}</div>`;
  if(selectedDay<f.start||selectedDay>f.end)selectedDay=f.end;
  renderCalendar();
}
function renderCalendar(){
  const f=overviewFilter(),month=selectedDay.slice(0,7),start=month+'-01',end=new Date(Date.parse(start+'T12:00:00Z'));end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);
  $('#overview .calendar-head').innerHTML=`<button data-month="-1" aria-label="Previous month">‹</button><span>${new Date(start+'T12:00:00Z').toLocaleDateString('en-AU',{month:'long',year:'numeric',timeZone:'UTC'})}</span><button data-month="1" aria-label="Next month">›</button>`;
  const offset=(new Date(start+'T12:00:00Z').getUTCDay()+6)%7;
  $('#overview .calendar').innerHTML=['Mo','Tu','We','Th','Fr','Sa','Su'].map(t=>`<b>${t}</b>`).join('')+'<span></span>'.repeat(offset)+Array.from({length:end.getUTCDate()},(_,i)=>{const day=add(start,i);return `<button data-day="${day}" ${day<f.start||day>f.end?'disabled':''} class="${day===selectedDay?'selected':''}">${i+1}</button>`;}).join('');
  $$('#overview .daily-item').forEach(e=>e.remove());
  const rows=M.rows({...f,start:selectedDay,end:selectedDay});
  $('#overview .view-all').insertAdjacentHTML('beforebegin',rows.slice(0,4).map(a=>`<div class="daily-item"><span class="portrait"></span><div><b>${time(a.start_minute)} · ${a.appointment_type==='assessment'?'Assessment':'Follow-up'}</b><div>${esc(a.clinician_name)}<br>${a.patient_id} · ${a.status.replace('_',' ')}</div></div></div>`).join('')||'<div class="daily-item">No matching appointments on this day.</div>');
  $('#overview .view-all').textContent=`View all ${rows.length} appointments · ${dateLabel(selectedDay)}`;
}
function clinicianStatus(c){return !c.total?'NO CAPACITY':c.rate>=85?'ON TARGET':c.rate<50&&c.matched?'FILL FIRST':c.rate<70&&c.matched?'PRIORITY':'MONITOR';}
function renderClinician(){
  const f=clinicianFilter(),s=M.capacity(f);clinicianState=s;
  const gap=Math.max(0,.85*s.total-s.used);
  [['availableHours',hours(s.total)],['bookedHours',hours(s.used)],['unbookedHours',hours(s.total-s.used)],['hoursToTarget',hours(gap)]].forEach(([id,v])=>$('#'+id).textContent=v);
  const pills=$$('.cl-kpis .pill'),desc=$$('.cl-kpis p');
  pills[0].textContent=`${s.roster.length} clinicians`;pills[1].textContent=pc(rate(s.used,s.total))+' booked';pills[2].textContent=s.free.length+' open slots';pills[3].textContent='85% target';
  desc[0].textContent=`${dateLabel(f.start)} – ${dateLabel(f.end)}`;desc[1].textContent='Confirmed future bookings';desc[2].textContent='Available for booking';desc[3].textContent='Additional hours needed';
  const cards=$$('.cl-second .cl-kpi');cards[0].querySelector('.big').textContent=s.referrals.length;cards[0].querySelector('p').textContent='Unique waiting patients · role/type scope';
  const prior=M.rows({...M.range(28),role:f.role,type:f.type}).filter(a=>a.status_group==='confirmed');const weekly=sum(prior,'duration_minutes')/4;
  cards[1].querySelector('.big').textContent=weekly?fmt(gap/weekly)+' weeks':'—';cards[1].querySelector('p').textContent='Estimate at recent appointment volume';
  $('.focus p').textContent=`${s.roster.filter(c=>clinicianStatus(c)==='FILL FIRST').length} fill first; ${s.roster.filter(c=>clinicianStatus(c)==='PRIORITY').length} priority. ${hours(gap)} required to reach 85%. Candidate matches are not assigned bookings.`;
  $('.waiting').innerHTML=fmt(s.referrals.length?s.referrals.reduce((n,r)=>n+(Date.parse(M.anchor)-Date.parse(r.created_date))/86400000,0)/s.referrals.length:null)+'d<small>current queue mean wait</small>';
  $('#capacityRows').innerHTML=s.roster.map(c=>`<div class="cap-row"><span title="${esc(c.name)}">${esc(c.name.replace(/^Dr\. /,'' ).split(' ')[0])}</span><div class="progress-track"><span style="width:${c.rate||0}%"></span><i class="target-line"></i></div><span class="cap-val">${pc(c.rate)}</span><span class="pill ${c.rate>=85?'soft-green':clinicianStatus(c)==='FILL FIRST'?'soft-red':clinicianStatus(c)==='PRIORITY'?'soft-orange':'soft-blue'}">${clinicianStatus(c)}</span></div>`).join('');
  renderPriorities('allocation',f);
  renderClinicianTable();renderBooking();
}
function visibleClinicians(){const q=$('.search').value.toLowerCase();return clinicianState.roster.filter(c=>(c.name+' '+c.id+' '+c.role).toLowerCase().includes(q)).sort((a,b)=>(sortAscending?1:-1)*((a.rate??-1)-(b.rate??-1)));}
function renderClinicianTable(){
  const rows=visibleClinicians();$('#clinicianListCount').textContent=`Showing ${rows.length} / ${clinicianState.roster.length}`;
  $('#clinicianBody').innerHTML=rows.map(c=>`<tr><td>${c.id}</td><td><div class="name-cell"><span class="small-av"></span>${esc(c.name)}</div></td><td>${esc(c.role)}</td><td><div class="bar-cell"><span style="width:${c.rate||0}%;background:${c.rate>=85?'#28b66f':c.rate<78?'#ffc35f':'#2474ef'}">${pc(c.rate)}</span></div></td><td>${hours(c.free)}</td><td>${c.next?dateLabel(c.next.date)+' '+time(c.next.start_minute):'No slot in range'}</td><td>${c.matched}</td><td><span class="pill ${c.rate>=85?'soft-green':clinicianStatus(c)==='FILL FIRST'?'soft-red':clinicianStatus(c)==='PRIORITY'?'soft-orange':'soft-blue'}">${clinicianStatus(c)}</span></td><td><button class="action" data-clinician-detail="${c.id}">View matches</button></td></tr>`).join('')||'<tr><td colspan="9">No clinicians match this search.</td></tr>';
}
function renderBooking(){
  const f=clinicianFilter();f.end=add(M.anchor,Math.min(bookingPeriod,Number(controls('clinician')[2].value)));
  const s=M.capacity(f);let html='<span></span>'+['Mon','Tue','Wed','Thu','Fri'].map(x=>`<b>${x}</b>`).join('');
  for(const h of [9,10,11,13,14,15,16]){
    html+=`<span>${h}:00–${h+1}:00</span>`;
    for(let weekday=1;weekday<=5;weekday++){
      const overlap=r=>Math.max(0,Math.min(r.start_minute+r.duration_minutes,(h+1)*60)-Math.max(r.start_minute,h*60));
      const offered=s.offered.filter(r=>new Date(r.date+'T12:00:00Z').getUTCDay()===weekday),booked=s.booked.filter(r=>new Date(r.date+'T12:00:00Z').getUTCDay()===weekday);
      const total=offered.reduce((n,r)=>n+overlap(r),0),used=booked.reduce((n,r)=>n+overlap(r),0),v=rate(used,total);
      html+=`<span class="cell" title="${hours(used)} booked / ${hours(total)} offered" style="background:${bookingShade(v)}">${pc(v)}</span>`;
    }
  }
  $('#bookingHeatmap').innerHTML=html;$('.weekly-head .panel-desc').textContent=`${dateLabel(f.start)} – ${dateLabel(f.end)} · lighter cells show more availability`;
  $('.weekly-head .panel-desc').title='Booked minutes divided by offered minutes. — means no offered capacity.';
}
function feedbackStats(f){const all=M.rows(f),c=M.reasons(f,'cancelled',controls('feedback')[5].value),n=M.reasons(f,'no_show',controls('feedback')[4].value);return {all,c,n,cr:rate(c.length,all.length),nr:rate(n.length,all.length)};}
function scoreMeter(score,label){
  const value=score==null?null:Math.round(score*10)/10;
  return `<div class="score-meter" role="img" aria-label="${esc(label)}: ${value==null?'No responses':value+' out of 5'}">`+Array.from({length:5},(_,i)=>`<span class="score-segment"><span class="score-fill" style="width:${value==null?0:Math.max(0,Math.min(1,value-i))*100}%"></span></span>`).join('')+'</div>';
}
function renderFeedback(){
  const f=feedbackFilter(),s=feedbackStats(f),p=feedbackStats(feedbackFilter(true)),t=M.themes(f),surveys=M.surveys(f),previous=M.surveys(feedbackFilter(true));
  [['cancelTotal',fmt(s.c.length)],['noShowTotal',fmt(s.n.length)],['cancelRate',pc(s.cr)],['noShowRate',pc(s.nr)]].forEach(([id,v])=>$('#'+id).textContent=v);
  $$('.fb-kpi .delta').forEach((el,i)=>el.textContent=[`${s.c.length-p.c.length>=0?'+':''}${s.c.length-p.c.length} vs prior`,`${s.n.length-p.n.length>=0?'+':''}${s.n.length-p.n.length} vs prior`,delta(s.cr,p.cr,true),delta(s.nr,p.nr,true)][i]);
  $$('.fb-kpi .delta').forEach((el,i)=>el.className='delta '+([s.c.length-p.c.length,s.n.length-p.n.length,s.cr-p.cr,s.nr-p.nr][i]>0?'red':'green'));
  $$('.fb-kpi .subtext').forEach(el=>{el.textContent='vs prior period';el.title=`${s.all.length} appointments · previous equal-length period`;});
  $('#feedback h1').title=`${dateLabel(f.start)} – ${dateLabel(f.end)} · ${surveys.length} responses`;
  const calendarBuckets=M.buckets(f,Number(controls('feedback')[0].value)>30?12:8);
  const buckets=calendarBuckets.filter(x=>x.start!==x.end||M.slots(x).length||M.rows(x).length),bucketStats=buckets.map(x=>feedbackStats(x));
  // Same baseline and ceiling for both rates and all date windows of a cohort.
  const reference=M.buckets({...f,...M.range(90)}).map(x=>feedbackStats(x));
  const ceiling=Math.min(100,Math.max(30,Math.ceil(Math.max(...reference.flatMap(x=>[x.cr||0,x.nr||0]))/10)*10));
  ['cancelChart','noShowChart'].forEach((id,i)=>draw(id,buckets.map(bucketLabel),[{label:i?'No-show rate (%)':'Cancellation rate (%)',data:bucketStats.map(x=>i?x.nr:x.cr),borderColor:i?'#9899da':'#ffb354',backgroundColor:i?'#9899da':'#ffca8b',pointBackgroundColor:i?'#9899da':'#ffb354',tension:0,pointStyle:'rectRounded',pointRadius:11,pointHoverRadius:13,hitRadius:28,pointBorderWidth:2.4,pointBorderColor:'#ffffff',borderWidth:2,fill:false}],'line',{interaction:{mode:'index',intersect:false},layout:{padding:{left:4,right:12,top:8}},scales:{x:{grid:{display:false},ticks:{autoSkip:false,maxRotation:0,font:{size:12,weight:'500'},padding:7}},y:{beginAtZero:true,max:ceiling,grid:{color:'#f0f2f7'},ticks:{maxTicksLimit:6,font:{size:12,weight:'500'},padding:7}}},plugins:{legend:{display:false},tooltip:{callbacks:{title:items=>{const x=buckets[items[0].dataIndex];return x.start+' → '+x.end;},afterLabel:ctx=>{const b=bucketStats[ctx.dataIndex];return `${i?b.n.length:b.c.length} / ${b.all.length} attempts${b.all.length<5?' · low sample':''}`;}}}}}));
  $$('.fb-charts .line-panel').forEach(panel=>{panel.title=calendarBuckets.length===7?'Service days only · non-working days excluded':'Grouped by the date ranges shown';});
  $('#feedbackSurveyStrip').innerHTML=[['overall','Overall satisfaction'],['booking','Booking process'],['waiting','Waiting time'],['experience','Appointment experience'],['quality','Consultation quality']].map(([k,l])=>{const score=mean(surveys,k);return `<div class="survey" title="Average of ${surveys.filter(r=>r[k]!=null).length} responses"><label>${l}</label><b>${fmt(score)}/5</b>${scoreMeter(score,l)}</div>`;}).join('');
  const reasons=['Emergency / Unforeseen Obligations','Change of Mind','Financial Issues','Patient Anxiety / Resistance','Unknown'], counts=reasons.map(r=>s.c.filter(a=>a.cancellation_reason===r).length), reasonColors=['#9497dd','#e76064','#474b9e','#f2a645','#fae8c7'];
  draw('reasonChart',reasons,[{label:'Cancelled appointments',data:counts,backgroundColor:reasonColors,borderWidth:0}],'doughnut',{cutout:'62%',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${c.label}: ${pc(rate(c.raw,s.c.length))}`}}}});
  $$('.donut-legend .legend-row').forEach((el,i)=>el.innerHTML=`<span class="swatch" style="background:${reasonColors[i]}"></span>${esc(reasons[i])} · ${counts[i]} (${pc(rate(counts[i],s.c.length))})`);
  const complaints=t.themes.filter(x=>x.sentiment==='negative'), themeColors={waiting:'#8b8cdb',rescheduling:'#ffbd58',reminders:'#fa767b',cost:'#f5b84d'};
  $('#feedbackThemes').innerHTML=t.insufficient?'<p>Not enough feedback yet.</p>':complaints.map(x=>{const score=mean(x.records,'complaint_impact_score');return `<div class="theme" title="${x.count} responses · Average reported impact, 1 (minor) to 5 (major)"><span>● &nbsp; ${esc(x.label)}</span><span class="theme-score">${score==null?'—':score.toFixed(1)} / 5</span><div class="theme-bar"><span style="width:${score==null?0:score/5*100}%;background:${themeColors[x.key]}"></span></div></div>`;}).join('')||'<p>No complaints in this period.</p>';
  renderPriorities('feedback',f);
  note('#feedback','feedbackDefinitions','About these metrics ⓘ');
  $('#feedbackDefinitions').onclick=()=>drawer('About these metrics','<p>Cancellation and no-show rates use all matching appointments. Reason filters narrow the relevant outcomes; ratings still cover the selected patient group.</p><p>Feedback scores are averages out of five. Complaint scores measure reported impact: 1 is minor, 5 is major. Frequencies and original comments are available in the evidence panel.</p><p>No appointments means no rate, rather than zero. Closed dates are omitted from daily charts; longer periods use the displayed date ranges.</p>');
}
function drawer(title,body){if(typeof stopInsightChat==='function')stopInsightChat();$('#aiDrawerBody').innerHTML=`<h2>${esc(title)}</h2>${body}`;$('#aiDrawer').classList.add('show');$('#aiBackdrop').classList.add('show');$('#aiDrawer').setAttribute('aria-hidden','false');}
function closeDrawer(){if(typeof stopInsightChat==='function')stopInsightChat();currentScope='';$('#aiDrawer').classList.remove('show');$('#aiBackdrop').classList.remove('show');$('#aiDrawer').setAttribute('aria-hidden','true');}
function evidence(rows,describe){return rows.map(r=>`<div class="ai-evidence-card"><b>${esc(r.record_id||r.referral_id||r.appointment_id||r.event_id)}</b><p>${esc(describe(r))}</p></div>`).join('')||'<p>No matching evidence.</p>';}
function exportClinicians(){const columns=['id','name','role','total','used','free','rate','matched'];const csv=[columns.join(','),...visibleClinicians().map(r=>columns.map(k=>'"'+String(r[k]??'').replaceAll('"','""')+'"').join(','))].join('\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'})),a=document.createElement('a');a.href=url;a.download='pandion-synthetic-clinicians.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function init(){
  Chart.defaults.font.family='Inter, Segoe UI, Arial, sans-serif';Chart.defaults.color='#68738a';Chart.defaults.font.size=11;
  Chart.register({id:'capacityTargetLines',afterDatasetsDraw(chart){if(chart.canvas.id!=='professionChart')return;const {ctx,chartArea:{top,bottom},scales:{x}}=chart;[[65,'#23c638'],[85,'#ff3940']].forEach(([value,color])=>{ctx.save();ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x.getPixelForValue(value),top);ctx.lineTo(x.getPixelForValue(value),bottom);ctx.stroke();ctx.restore();});}});
  function fit(){document.documentElement.style.setProperty('--dashboard-scale',((document.documentElement.clientWidth||window.innerWidth)/1536).toFixed(5));}
  fit();window.addEventListener('resize',fit);
  const ov=controls('overview');ov[1].insertAdjacentHTML('afterend','<select class="filter" data-scope="overview" aria-label="Overview date range"><option value="30">Last 30 Days</option><option value="7">Last 7 Days</option><option value="90">Last 90 Days</option></select>');
  $('.date-chip').title='Fixed reproducible demo date, not the current date';
  $('.date-chip span').textContent=dateLabel(M.anchor)+', '+M.anchor.slice(0,4);
  $$('.nav-group').filter(e=>!e.querySelector('.nav-page')).forEach(el=>{el.title='Not implemented in this prototype';});
  $$('.auth a').forEach(el=>{el.title='Not implemented in this prototype';el.onclick=e=>{e.preventDefault();toast('Not available in this demo');};});
  $$('.overview-kpi .k-label')[0].textContent='Service revenue (AUD)';$$('.overview-kpi .k-label')[1].textContent='Appointment attempts';$$('.overview-kpi .k-label')[2].textContent='Unique patients';$$('.overview-kpi .k-label')[3].textContent='Occupied capacity';
  $('#completedAppt').previousElementSibling.textContent='Confirmed';$('.heat-scale span').textContent='Occupied / offered minutes (%)';
  const cl=controls('clinician');cl[1].options[0].value='all';cl[1].options[1].value='assessment';cl[1].options[2].value='follow_up';[28,14,56].forEach((v,i)=>cl[2].options[i].value=v);
  $('.cl-kpis .cap').textContent='Total offered hours';
  const fb=controls('feedback');[7,30,90].forEach((v,i)=>fb[0].options[i].value=v);fb[1].innerHTML='<option value="all">All Clinicians</option>'+M.data.clinicians.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');fb[3].querySelector('[value="telehealth"]')?.remove();fb[4].insertAdjacentHTML('beforeend','<option>Unknown</option>');
  fb[2].innerHTML='<option value="all">All Patients</option><option value="high_risk">High Risk Only</option><option value="new_patient">New Patients</option><option value="continuing_patient">Continuing Patients</option>';
  fb[3].innerHTML='<option value="all">All Types</option><option value="assessment">Assessment</option><option value="follow_up">Follow Up</option>';
  fb[4].innerHTML='<option>All Reasons</option><option>Reminder Missed</option><option>Schedule Conflict</option><option>Unknown</option>';
  $$('.middle-card h2')[1].textContent='Negative Feedback Themes';
  $$('.middle-card h2')[1].title='Average reported complaint impact, out of 5';
  $('#feedbackSurveyStrip').insertAdjacentHTML('beforebegin','<h2 class="feedback-score-title">Patient Feedback Scores</h2>');
  $$('.disclaimer').forEach(el=>el.textContent='Demonstration only · Fictional data · As of 15 September 2026');
  $$('.nav-page').forEach(btn=>btn.addEventListener('click',()=>{closeDrawer();$$('.nav-page').forEach(b=>b.classList.toggle('active',b===btn));$$('.page').forEach(p=>p.classList.toggle('active',p.id===btn.dataset.page));if(btn.dataset.page==='feedback')renderPriorities('feedback',feedbackFilter());else if(btn.dataset.page==='clinician')renderPriorities('allocation',clinicianFilter());else{clearTimeout(liveTimer);liveController?.abort();liveVersion++;}}));
  $$('.filter').forEach(el=>el.addEventListener('change',()=>{closeDrawer();({overview:renderOverview,clinician:renderClinician,feedback:renderFeedback}[el.dataset.scope])();}));
  $$('.calendar-toggle').forEach(el=>el.addEventListener('click',()=>{bookingPeriod=el.dataset.bookingPeriod==='week'?7:28;$$('.calendar-toggle').forEach(x=>x.classList.toggle('active',x===el));renderBooking();}));
  $('.week-switches label').firstChild.textContent='Next 7 days ';
  $('.search').addEventListener('input',renderClinicianTable);
  const buttons=$$('.table-buttons button');buttons[0].remove();buttons[1].textContent='Sort · utilisation ↑';buttons[1].onclick=()=>{sortAscending=!sortAscending;buttons[1].textContent='Sort · utilisation '+(sortAscending?'↑':'↓');renderClinicianTable();};buttons[2].onclick=exportClinicians;
  const headers=$$('.clinician-table thead th');headers[0].textContent='Clinician ID';headers[1].textContent='Clinician';
  // No false promise that this read-only prototype creates clinical records.
  [...$$('.head-actions button'),buttons[3],...$$('.topbar .icon-btn')].forEach(el=>{el.disabled=true;el.title='Read-only data prototype: this workflow is not implemented.';});
  document.addEventListener('click',event=>{const e=event.target.closest('[data-reason-index],[data-priority-scope],[data-day],[data-month],[data-clinician-detail]');if(!e)return;
    if(e.dataset.reasonIndex!==undefined)showReasonRecords(Number(e.dataset.reasonIndex));
    if(e.dataset.priorityScope)openPriority(e.dataset.priorityScope,Number(e.dataset.priorityIndex));
    if(e.dataset.day){selectedDay=e.dataset.day;renderCalendar();}
    if(e.dataset.month){const f=overviewFilter(),d=new Date(selectedDay+'T12:00:00Z');d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+Number(e.dataset.month));const proposed=d.toISOString().slice(0,10);selectedDay=proposed<f.start?f.start:proposed>f.end?f.end:proposed;renderCalendar();}
    if(e.dataset.clinicianDetail){const c=clinicianState.roster.find(c=>c.id===e.dataset.clinicianDetail);drawer(c.name+' · matching candidates',`<p>${hours(c.used)} booked / ${hours(c.total)} offered. ${c.matched} unique candidates; a patient can match several clinicians and has not been assigned.</p>`+evidence(clinicianState.referrals.filter(r=>c.matchedIds.includes(r.referral_id)),r=>`${r.patient_id} · ${r.appointment_type} · ${r.preferred_time} · ${r.priority} priority`));}
  });
  $('#overview .view-all').onclick=()=>drawer('Appointments · '+selectedDay,evidence(M.rows({...overviewFilter(),start:selectedDay,end:selectedDay}),a=>`${time(a.start_minute)} · ${a.clinician_name} · ${a.patient_id} · ${a.status} · service ${money(a.service_revenue_cents/100)}`));
  $('#aiClose').onclick=closeDrawer;$('#aiBackdrop').onclick=closeDrawer;document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer();});
  renderOverview();renderClinician();renderFeedback();$$('.page').forEach(p=>p.style.visibility='visible');
}
try{init();}catch(error){console.error(error);document.body.insertAdjacentHTML('afterbegin','<div role="alert" style="padding:20px;background:#ffe1e1">Dashboard data could not be loaded. Do not rely on placeholder figures. Please reload or check the data assets.</div>');$$('.page').forEach(p=>p.style.visibility='hidden');}
