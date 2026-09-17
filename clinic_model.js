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
    return {data,anchor,range,rows,slots,surveys,stats,buckets,themes,reasons,capacity};
  }
  const api={create,add,rate,sum,mean};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PandionModel=api;
})(typeof globalThis!=='undefined'?globalThis:this);
