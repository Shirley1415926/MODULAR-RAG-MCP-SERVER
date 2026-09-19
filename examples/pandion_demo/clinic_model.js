/* Pure calculations shared by browser and Node regression tests. No display multipliers. */
(function(root){
  'use strict';
  const dayMs=86400000, sum=(rows,key)=>rows.reduce((n,r)=>n+(Number(r[key])||0),0);
  const add=(date,n)=>new Date(Date.parse(date+'T12:00:00Z')+n*dayMs).toISOString().slice(0,10);
  const rate=(n,d)=>d?100*n/d:null;
  const mean=(rows,key)=>{const vals=rows.filter(r=>r[key]!=null);return vals.length?sum(vals,key)/vals.length:null;};
  function create(data){
    const anchor=data.metadata.reference_date;
    const byAppt=new Map(data.appointments.map(a=>[a.appointment_id,a]));
    const occupied=new Set(data.appointments.filter(a=>['confirmed','completed','no_show'].includes(a.status)).map(a=>a.slot_id));
    function range(days=30,previous=false){const end=add(anchor,previous?-days:0);return {start:add(end,1-days),end};}
    function match(a,f={}){
      return (!f.start||a.appointment_date>=f.start)&&(!f.end||a.appointment_date<=f.end)&&
        (!f.role||f.role==='All Roles'||a.clinician_role===f.role)&&(!f.status||f.status==='All Status'||a.status_group===f.status.toLowerCase())&&
        (!f.clinician||f.clinician==='all'||a.clinician_id===f.clinician)&&
        (!f.type||f.type==='all'||a.appointment_type===f.type)&&
        (!f.segment||f.segment==='all'||(f.segment==='high_risk'?!!a.high_risk:a.patient_segment===f.segment));
    }
    function rows(f){return data.appointments.filter(a=>match(a,f));}
    function slots(f={}){return data.slots.filter(s=>(!f.start||s.date>=f.start)&&(!f.end||s.date<=f.end)&&
      (!f.role||f.role==='All Roles'||s.role===f.role)&&(!f.clinician||f.clinician==='all'||s.clinician_id===f.clinician)&&(!f.type||f.type==='all'||s.appointment_type===f.type));}
    function surveys(f){return data.feedback.filter(r=>match(byAppt.get(r.appointment_id),f));}
    function stats(f){
      const a=rows(f), s=slots(f), confirmed=a.filter(r=>r.status_group==='confirmed'), cancelled=a.filter(r=>r.status==='cancelled'), rescheduled=a.filter(r=>r.status==='rescheduled'), noshow=a.filter(r=>r.status==='no_show');
      const capacity=sum(s,'duration_minutes'), used=sum(confirmed,'duration_minutes');
      return {rows:a,total:a.length,confirmed:confirmed.length,cancelled:cancelled.length,rescheduled:rescheduled.length,no_show:noshow.length,
        completed:a.filter(r=>r.status==='completed').length, patients:new Set(a.map(r=>r.patient_id)).size,
        revenue:sum(a,'service_revenue_cents')/100,fees:sum(a,'cancellation_fee_cents')/100,capacity,used,utilisation:rate(used,capacity),
        cancellationRate:rate(cancelled.length,a.length),noShowRate:rate(noshow.length,a.length)};
    }
    function buckets(f,count){
      const days=Math.round((Date.parse(f.end)-Date.parse(f.start))/dayMs)+1, width=Math.max(1,Math.ceil(days/(count||days))), result=[];
      for(let n=0;n<days;n+=width){const start=add(f.start,n),end=add(f.start,Math.min(days-1,n+width-1));result.push({...f,start,end});}
      return result;
    }
    function themes(f){
      const feedback=surveys(f),groups=new Map();
      feedback.forEach(r=>{if(!groups.has(r.theme))groups.set(r.theme,{key:r.theme,label:r.theme_label,sentiment:r.sentiment,records:[]});groups.get(r.theme).records.push(r);});
      return {total:feedback.length,insufficient:feedback.length<5,themes:[...groups.values()].map(t=>({...t,count:t.records.length,share:rate(t.records.length,feedback.length)})).sort((a,b)=>b.count-a.count||a.key.localeCompare(b.key))};
    }
    function lifecycle(f){return (data.lifecycle_events||[]).filter(e=>e.date>=f.start&&e.date<=f.end&&(!f.role||f.role==='All Roles'||e.role===f.role));}
    function sparkline(f,key){return buckets(f).map(b=>({date:b.end,value:stats({...f,start:add(b.end,-6),end:b.end})[key]}));}
    function reasons(f,kind,reason){return rows(f).filter(a=>a.status===kind&&(!reason||reason==='All Reasons'||a[kind==='cancelled'?'cancellation_reason':'no_show_reason']===reason));}
    function capacity(f){
      const offered=slots(f), booked=offered.filter(s=>occupied.has(s.slot_id)), free=offered.filter(s=>!occupied.has(s.slot_id));
      const referrals=data.referrals.filter(r=>(!f.role||f.role==='All Roles'||r.role===f.role)&&(!f.type||f.type==='all'||r.appointment_type===f.type));
      function compatible(r,s){return r.role===s.role&&r.appointment_type===s.appointment_type&&(!r.clinician_id||r.clinician_id===s.clinician_id)&&(r.preferred_time==='any'||(r.preferred_time==='morning')===(s.start_minute<720));}
      const roster=data.clinicians.filter(c=>!f.role||f.role==='All Roles'||c.role===f.role).map(c=>{
        const cs=offered.filter(s=>s.clinician_id===c.id),bs=booked.filter(s=>s.clinician_id===c.id),fs=free.filter(s=>s.clinician_id===c.id);
        const total=sum(cs,'duration_minutes'),used=sum(bs,'duration_minutes'),matched=referrals.filter(r=>fs.some(s=>compatible(r,s)));
        return {...c,total,used,free:total-used,rate:rate(used,total),next:fs[0]||null,matched:matched.length,matchedIds:matched.map(r=>r.referral_id)};
      });
      const priority=referrals.filter(r=>r.priority==='high'),waiting=referrals.filter(r=>add(r.created_date,7)<anchor);
      const latest=new Map();
      data.appointments.filter(a=>a.status==='completed'&&a.appointment_date<=anchor).forEach(a=>latest.set(a.patient_id,a));
      const future=new Set(data.appointments.filter(a=>a.appointment_date>anchor&&a.status==='confirmed').map(a=>a.patient_id));
      const followups=[...latest.values()].filter(a=>a.followup_due&&a.followup_due<=f.end&&!future.has(a.patient_id)&&(!f.role||f.role==='All Roles'||a.clinician_role===f.role)&&(!f.type||f.type==='all'||f.type==='follow_up'));
      const atRisk=new Set([...priority,...waiting,...followups].map(r=>r.patient_id)).size;
      return {roster,offered,booked,free,referrals,priority,waiting,followups,atRisk,total:sum(offered,'duration_minutes'),used:sum(booked,'duration_minutes'),compatible};
    }
    function allocationDetails(records,f){
      const free=slots({...f,type:'all'}).filter(s=>!occupied.has(s.slot_id));
      const workflow=new Map(followupCases(records).map(c=>[c.source,c]));
      return records.map(r=>{
        const followup=!!r.followup_due,p=data.patients.find(p=>p.patient_id===r.patient_id),role=r.role||r.clinician_role,type=followup?'follow_up':r.appointment_type,caseRow=workflow.get(r.appointment_id),preferred=caseRow?.finding==='time_mismatch'?caseRow.events.at(-1).available_period:r.preferred_time||p?.preferred_time;
        const roleSlots=free.filter(s=>s.role===role),continuity=roleSlots.filter(s=>!r.clinician_id||s.clinician_id===r.clinician_id),typed=continuity.filter(s=>s.appointment_type===type);
        const matches=typed.filter(s=>preferred==='any'||preferred==='morning'&&s.start_minute<720||preferred==='afternoon'&&s.start_minute>=720).sort((a,b)=>a.date.localeCompare(b.date)||a.start_minute-b.start_minute);
        const blocker=!roleSlots.length?'capacity':!continuity.length?'continuity':!typed.length?'type':!['any','morning','afternoon'].includes(preferred)?'unknown':!matches.length?'time':'ready';
        const overdue=followup?Math.round((Date.parse(anchor)-Date.parse(r.followup_due))/dayMs):null;
        const bucket=overdue==null?'referral':overdue<=0?'upcoming':overdue<=7?'1–7 days':overdue<=30?'8–30 days':'Over 30 days';
        return {record:r,blocker,bucket,overdue,matchedSlots:matches.length,next:matches[0]||null,preferred};
      });
    }
    function reasonComparison(f,kind){
      const days=Math.round((Date.parse(f.end)-Date.parse(f.start))/dayMs)+1;
      const previous={...f,start:add(f.start,-days),end:add(f.start,-1)};
      const currentRows=rows(f),previousRows=rows(previous),key=kind==='cancelled'?'cancellation_reason':'no_show_reason';
      const current=currentRows.filter(r=>r.status===kind),prior=previousRows.filter(r=>r.status===kind);
      const labels=[...new Set([...current,...prior].map(r=>r[key]||'Unknown'))];
      const breakdown=labels.map(label=>{
        const now=current.filter(r=>(r[key]||'Unknown')===label).length,before=prior.filter(r=>(r[key]||'Unknown')===label).length;
        return {label,current:now,previous:before,change:now-before,rateChange:currentRows.length&&previousRows.length?100*(now/currentRows.length-before/previousRows.length):null};
      }).sort((a,b)=>(b.rateChange??0)-(a.rateChange??0)||b.change-a.change||a.label.localeCompare(b.label));
      return {previous,currentTotal:currentRows.length,previousTotal:previousRows.length,currentCount:current.length,previousCount:prior.length,currentRate:rate(current.length,currentRows.length),previousRate:rate(prior.length,previousRows.length),breakdown};
    }
    function priorities(scope,f){
      const items=[];
      const push=(id,score,title,impact,action,records)=>{if(records.length)items.push({id,score,title,impact,action,records});};
      if(scope==='allocation'){
        const s=capacity(f),blocked=s.priority.filter(r=>!s.free.some(slot=>s.compatible(r,slot)));
        push('allocation-blocked',100,`${blocked.length} priority referrals have no matching slot`,'No free slot in this window meets the recorded role, appointment type and continuity/time constraints.','Review these constraints with staff; confirm alternative times or additional capacity before offering a booking.',blocked);
        const ready=s.priority.filter(r=>!blocked.includes(r));
        push('allocation-ready',90,`${ready.length} priority referrals have matching availability`,'These patients could be contacted using the currently available matching slots. Matches are candidates, not reserved appointments.','Contact high-priority patients first and confirm suitability and slot availability.',ready);
        const overdue=s.followups.filter(r=>r.followup_due<anchor).sort((a,b)=>a.followup_due.localeCompare(b.followup_due));
        push('allocation-overdue',95,`${overdue.length} follow-ups are overdue`,'These patients have passed the recorded follow-up date and have no confirmed future appointment.','Ask the care team to review continuity needs and contact patients to arrange follow-up.',overdue);
        const waiting=s.waiting.filter(r=>r.priority!=='high').sort((a,b)=>a.created_date.localeCompare(b.created_date));
        push('allocation-waiting',70,`${waiting.length} other referrals exceed the 7-day wait rule`,'The demo waiting-time threshold has been exceeded; high-priority referrals are handled separately.','Work through the oldest referrals, verify constraints and offer suitable availability.',waiting);
        const upcoming=s.followups.filter(r=>r.followup_due>=anchor);
        push('allocation-followup',60,`${upcoming.length} follow-ups are due by ${f.end}`,'No future appointment is confirmed for these upcoming follow-ups.','Confirm follow-up needs with the care team and contact patients before their due dates.',upcoming);
      }else{
        const days=Math.round((Date.parse(f.end)-Date.parse(f.start))/dayMs)+1;
        const previous={...f,start:add(f.start,-days),end:add(f.start,-1)},s=stats(f),p=stats(previous),t=themes(f);
        for(const [kind,key,label,action] of [['cancelled','cancellationRate','Cancellation','Review the recorded reasons, contact affected patients about rebooking, and compare the rate in the next equal-length period.'],['no_show','noShowRate','No-show','Check reminder delivery and confirmation records before choosing a reminder or outreach change.']]){
          const current=reasons(f,kind),change=s[key]-p[key];
          if(s.total>=20&&p.total>=20&&current.length>=3&&change>=3)push('feedback-'+(kind==='cancelled'?'cancellation':'noshow'),80+change,`${label} rate increased by ${change.toFixed(1)} percentage points`,`${current.length} of ${s.total} appointments; ${s[key].toFixed(1)}% versus ${p[key].toFixed(1)}% in the previous equal-length period. This comparison does not establish a cause.`,action,current);
        }
        const actions={waiting:'Review appointment availability and communicate realistic waiting times before booking.',rescheduling:'Review rescheduling contacts and identify which hand-offs can be simplified.',reminders:'Check reminder delivery logs and contact details; test a confirmation step before expanding it.',cost:'Review when fee information is shared and clarify costs before patients confirm bookings.'};
        if(!t.insufficient)for(const theme of t.themes.filter(x=>x.sentiment==='negative'&&x.count>=3&&x.share>=15))push('feedback-theme-'+theme.key,50+theme.share/10,`${theme.label}: ${theme.count} patient responses`,`${theme.share.toFixed(1)}% of ${t.total} filtered responses mention this pre-labelled primary theme; this is not a proven explanation for attendance changes.`,actions[theme.key]||'Review the original comments and agree one operational change to test.',theme.records);
      }
      return items.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,3);
    }
    function followupCases(records){
      return records.filter(r=>r.followup_due).map(r=>{
        const events=(data.followup_events||[]).filter(e=>e.appointment_id===r.appointment_id&&e.patient_id===r.patient_id&&e.date>=r.appointment_date&&e.date<=anchor).sort((a,b)=>a.date.localeCompare(b.date)||a.event_id.localeCompare(b.event_id));
        let finding='missing_history',evidence_ids=[];
        if(events.length){
          const last=events[events.length-1],offer=events.slice(0,-1).find(e=>e.kind==='offer_sent'&&e.event_id===last.reply_to);
          if(last.kind==='offer_declined'&&offer&&['morning','afternoon'].includes(offer.offered_period)&&['morning','afternoon'].includes(last.available_period)&&offer.offered_period!==last.available_period){finding='time_mismatch';evidence_ids=[offer.event_id,last.event_id];}
          else {finding=({offer_sent:'no_reply_recorded',external_booking_reported:'external_report',care_need_confirmed:'active_need'})[last.kind]||'needs_review';evidence_ids=[last.event_id];}
        }
        return {source:r.appointment_id,patient_id:r.patient_id,finding,evidence_ids,events};
      });
    }
    function followupOperations(records){
      const cases=followupCases(records),total=cases.length;
      const counts=Object.fromEntries(['time_mismatch','external_report','active_need','no_reply_recorded','missing_history','needs_review'].map(k=>[k,cases.filter(c=>c.finding===k).length]));
      const drivers=['time_mismatch','external_report'].filter(k=>counts[k]).map(key=>({key,count:counts[key],share:100*counts[key]/total})).sort((a,b)=>b.count-a.count);
      const actions=['time_mismatch','active_need','external_report','no_reply_recorded','missing_history','needs_review'].filter(key=>counts[key]).map(key=>({key,count:counts[key]}));
      return {total,drivers,actions,tied:drivers.length>1&&drivers[0].count===drivers[1].count};
    }
    function allocationInvestigation(records,f){
      const details=allocationDetails(records,f),n=details.length;
      const ids=keys=>details.filter(r=>keys.includes(r.blocker)).map(r=>r.record.referral_id||r.record.appointment_id);
      return [
        {id:'availability',status:n?'checked':'insufficient_data',support:ids(['capacity','continuity','type','time']),counter:ids(['ready']),unknown:ids(['unknown'])}
      ];
    }
    return {data,anchor,range,rows,slots,surveys,stats,buckets,themes,reasons,capacity,lifecycle,sparkline,priorities,reasonComparison,allocationDetails,allocationInvestigation,followupCases,followupOperations};
  }
  const api={create,add,rate,sum,mean};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PandionModel=api;
})(typeof globalThis!=='undefined'?globalThis:this);
