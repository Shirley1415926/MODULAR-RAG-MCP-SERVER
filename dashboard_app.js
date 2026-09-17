/* All visible metrics are projections of the same versioned synthetic ledger. */
'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const M=PandionModel.create(window.PANDION_SYNTHETIC_OPERATIONS), {add,rate,sum,mean}=PandionModel;
const fmt=n=>n==null?'—':Number(n).toLocaleString('en-AU',{maximumFractionDigits:1});
const money=n=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',maximumFractionDigits:0}).format(n);
const pc=n=>n==null?'—':fmt(n)+'%', hours=n=>fmt(n/60)+'h';
const dateLabel=d=>new Date(d+'T12:00:00Z').toLocaleDateString('en-AU',{day:'numeric',month:'short',timeZone:'UTC'});
const time=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
const palette=['#777bc6','#b8bbe9','#f4af67','#f7777b','#15b887'];
const charts={};let bookingPeriod=7, selectedDay=M.anchor, sortAscending=true, currentScope='', clinicianState;
function toast(s){$('#toast').textContent=s;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),3000);}
function draw(id,labels,sets,type='bar',options={}){
  const datasets=sets.map((s,i)=>({label:s.label,data:s.data,backgroundColor:palette[i%5],borderColor:palette[i%5],borderWidth:type==='line'?2:0,tension:0,pointRadius:type==='line'?3:0,spanGaps:false,...s}));
  if(charts[id]){charts[id].data={labels,datasets};charts[id].options=optionsFor(type,options);charts[id].update('none');return;}
  charts[id]=new Chart($('#'+id),{type,data:{labels,datasets},options:optionsFor(type,options)});
}
function optionsFor(type,options){return {responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:type!=='doughnut',labels:{boxWidth:9,font:{size:10}}},tooltip:{enabled:true}},...(type==='doughnut'?{}:{scales:{x:{grid:{display:false},ticks:{maxTicksLimit:8,font:{size:10}}},y:{beginAtZero:true,ticks:{font:{size:10}}}}}),...options};}
const controls=scope=>$$(`[data-scope="${scope}"]`);
function overviewFilter(previous=false){const c=controls('overview');return {...M.range(Number(c[2].value),previous),role:c[0].value,status:c[1].value};}
function clinicianFilter(){const c=controls('clinician');return {start:add(M.anchor,1),end:add(M.anchor,Number(c[2].value)),role:c[0].value,type:c[1].value};}
function feedbackFilter(previous=false){const c=controls('feedback');return {...M.range(Number(c[0].value),previous),clinician:c[1].value,segment:c[2].value,type:c[3].value};}
function delta(n,p,pp=false){return n==null||p==null?'No comparison':pp?`${n-p>=0?'+':''}${fmt(n-p)} pp`:(p?`${n>=p?'+':''}${fmt((n-p)/p*100)}%`:n?'New activity':'No change');}
function note(parent,id,text){let el=$('#'+id);if(!el){el=document.createElement('p');el.id=id;el.className='data-note';$(parent).append(el);}el.textContent=text;}
function shade(n){return n==null?'#e8ebf1':n>=85?'#41488f':n>=65?'#777bc6':n>=40?'#a5a5d5':'#d0bcae';}
function renderOverview(){
  const f=overviewFilter(),s=M.stats(f),p=M.stats(overviewFilter(true)), bs=M.buckets(f,Number(controls('overview')[2].value)>30?13:30),b=bs.map(x=>M.stats(x));
  [['rev',money(s.revenue)],['appointments',fmt(s.total)],['patients',fmt(s.patients)],['util',pc(s.utilisation)],['totalAppt',fmt(s.total)],['cancelledAppt',fmt(s.cancelled)],['rescheduledAppt',fmt(s.rescheduled)],['completedAppt',fmt(s.confirmed)]].forEach(([id,v])=>$('#'+id).textContent=v);
  const vals=['revenue','total','patients','utilisation'];
  $$('.overview-kpi').forEach((card,i)=>{card.querySelector('.trend-chip').textContent=delta(s[vals[i]],p[vals[i]],i===3);card.querySelector('.trend-chip').className='trend-chip '+(s[vals[i]]>=p[vals[i]]?'green':'red');card.querySelector('.trend-caption').textContent='vs previous '+controls('overview')[2].value+' days';
    const data=b.map(x=>x[vals[i]]||0),max=Math.max(1,...data),points=data.map((v,j)=>`${2+j*80/Math.max(1,data.length-1)},${32-v/max*30}`).join(' ');
    card.querySelector('.mini-spark').innerHTML=`<polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2"/>`;
  });
  note('#overview .appointment-stat','accountingNote',`${f.start} → ${f.end} · ${s.confirmed} confirmed + ${s.rescheduled} rescheduled + ${s.cancelled} cancelled = ${s.total} attempts. Confirmed includes ${s.completed} completed and ${s.no_show} no-shows. Service revenue excludes ${money(s.fees)} in late cancellation fees. Unique patients are not additive across statuses.`);
  draw('appointmentChart',bs.map(x=>dateLabel(x.start)),['confirmed','rescheduled','cancelled'].map(k=>({label:k[0].toUpperCase()+k.slice(1),data:b.map(x=>x[k])})), 'bar',{scales:{x:{stacked:true,grid:{display:false},ticks:{maxTicksLimit:8}},y:{stacked:true,beginAtZero:true}}});
  const roles=[...new Set(M.data.clinicians.map(c=>c.role))].filter(r=>f.role==='All Roles'||r===f.role);
  draw('professionChart',roles,[{label:'Occupied / offered minutes (%)',data:roles.map(role=>M.stats({...f,role}).utilisation)}],'bar',{indexAxis:'y',scales:{x:{min:0,max:100},y:{grid:{display:false}}}});
  const heatBuckets=M.buckets(f,5);
  $('#professionHeatmap').style.gridTemplateColumns=`78px repeat(${heatBuckets.length},1fr)`;
  $('#professionHeatmap').innerHTML=roles.map(role=>`<span class="rowlab">${esc(role)}</span>`+heatBuckets.map(x=>{const t=M.stats({...x,role});return `<span class="cell" title="${x.start}–${x.end}: ${hours(t.used)} / ${hours(t.capacity)}" style="background:${shade(t.utilisation)}">${pc(t.utilisation)}</span>`;}).join('')).join('')+'<span></span>'+heatBuckets.map(x=>`<span class="axis">${dateLabel(x.start)}</span>`).join('');
  draw('patientTrend',bs.map(x=>dateLabel(x.start)),['new_patient','continuing_patient'].map((k,i)=>({label:i?'Returning patients':'New patients',data:bs.map(x=>new Set(M.rows({...x,segment:k}).map(a=>a.patient_id)).size)})),'line');
  note('#overview .patient-trend','patientDefinition','Distinct patients per bucket, by episode at appointment time. A patient can appear in multiple dates or categories; these lines must not be added to the period-wide unique total.');
  const reviews=M.surveys(f),previous=M.surveys(overviewFilter(true));
  $('#overviewRatings').innerHTML=[['quality','Service satisfaction'],['booking','Booking satisfaction']].map(([k,label])=>`<div class="rating">${label}<br><strong>${fmt(mean(reviews,k))}/5</strong><span>${delta(mean(reviews,k),mean(previous,k),true).replace(' pp',' points')} · n=${reviews.filter(r=>r[k]!=null).length}</span></div>`).join('')+`<div class="rating">Below-average reviews (&lt;3/5)<br><strong>${reviews.filter(r=>r.overall<3).length}</strong><span>of ${reviews.length} overall ratings</span></div>`;
  $('#overviewAlerts').innerHTML=`<div class="alert-chip ${f.status==='All Status'&&s.cancellationRate>15?'red':''}">Cancelled share of selection: ${pc(s.cancellationRate)} · ${s.cancelled}/${s.total}</div><div class="alert-chip">Survey response: ${pc(rate(reviews.length,s.total))}</div><div class="alert-chip">${reviews.length<5?'Insufficient survey evidence':'Ratings from linked surveys'}</div>`;
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
  $('#overview .view-all').insertAdjacentHTML('beforebegin',rows.slice(0,4).map(a=>`<div class="daily-item"><div><b>${time(a.start_minute)} · ${esc(a.clinician_role)} ${a.appointment_type==='assessment'?'assessment':'follow-up'}</b><div>${esc(a.clinician_name)} · ${a.patient_id}<br>${a.appointment_id} · ${a.status.replace('_',' ')} · ${money(a.service_revenue_cents/100)}</div></div></div>`).join('')||'<div class="daily-item">No matching appointments on this day.</div>');
  $('#overview .view-all').textContent=`View all ${rows.length} appointments · ${dateLabel(selectedDay)}`;
}
function clinicianStatus(c){return !c.total?'NO CAPACITY':c.rate>=85?'ON TARGET':c.rate<50&&c.matched?'FILL FIRST':c.rate<70&&c.matched?'PRIORITY':'MONITOR';}
function renderClinician(){
  const f=clinicianFilter(),s=M.capacity(f);clinicianState=s;
  const gap=Math.max(0,.85*s.total-s.used);
  [['availableHours',hours(s.total)],['bookedHours',hours(s.used)],['unbookedHours',hours(s.total-s.used)],['hoursToTarget',hours(gap)]].forEach(([id,v])=>$('#'+id).textContent=v);
  const pills=$$('.cl-kpis .pill'),desc=$$('.cl-kpis p');
  pills[0].textContent=`${s.roster.length} clinicians · ${s.offered.length} slots`;pills[1].textContent=pc(rate(s.used,s.total))+' weighted fill';pills[2].textContent=s.free.length+' bookable slots';pills[3].textContent='85% of offered capacity';
  desc[0].textContent=`${f.start} → ${f.end}`;desc[1].textContent='Confirmed future bookings';desc[2].textContent='Offered minus booked';desc[3].textContent='max(0, target − booked)';
  const cards=$$('.cl-second .cl-kpi');cards[0].querySelector('.big').textContent=s.referrals.length;cards[0].querySelector('p').textContent='Unique waiting patients · role/type scope';
  const prior=M.rows({...M.range(28),role:f.role,type:f.type}).filter(a=>a.status_group==='confirmed');const weekly=sum(prior,'duration_minutes')/4;
  cards[1].querySelector('.big').textContent=weekly?fmt(gap/weekly)+' weeks':'—';cards[1].querySelector('p').textContent='Gap / trailing 4-week attended+no-show hours per week; estimate, not a forecast';
  $('.focus p').textContent=`${s.roster.filter(c=>clinicianStatus(c)==='FILL FIRST').length} fill first; ${s.roster.filter(c=>clinicianStatus(c)==='PRIORITY').length} priority. ${hours(gap)} required to reach 85%. Candidate matches are not assigned bookings.`;
  $('.waiting').innerHTML=fmt(s.referrals.length?s.referrals.reduce((n,r)=>n+(Date.parse(M.anchor)-Date.parse(r.created_date))/86400000,0)/s.referrals.length:null)+'d<small>current queue mean wait</small>';
  $('#capacityRows').innerHTML=s.roster.map(c=>`<div class="cap-row"><span title="${esc(c.name)}">${esc(c.name)}</span><div class="progress-track"><span style="width:${c.rate||0}%"></span><i class="target-line"></i></div><span class="cap-val">${pc(c.rate)}</span><span class="pill soft-blue">${clinicianStatus(c)}</span></div>`).join('');
  $('.risk-badge').textContent=s.atRisk+' UNIQUE AT RISK';
  const texts=[`${s.priority.length} high-priority patients waiting`,`${s.waiting.length} patients waiting longer than 7 days`,`${s.followups.length} follow-ups due without a future booking`];
  $$('.risk-copy b').forEach((el,i)=>el.textContent=texts[i]);$$('.risk-copy p').forEach((el,i)=>el.textContent=['Priority is a synthetic operational flag, not a diagnosis.','7 days is a demo SLA, not a published company commitment.','Risk categories overlap; badge counts unique patients.'][i]);
  renderClinicianTable();renderBooking();
}
function visibleClinicians(){const q=$('.search').value.toLowerCase();return clinicianState.roster.filter(c=>(c.name+' '+c.id+' '+c.role).toLowerCase().includes(q)).sort((a,b)=>(sortAscending?1:-1)*((a.rate??-1)-(b.rate??-1)));}
function renderClinicianTable(){
  const rows=visibleClinicians();$('#clinicianListCount').textContent=`Showing ${rows.length} / ${clinicianState.roster.length}`;
  $('#clinicianBody').innerHTML=rows.map(c=>`<tr><td>${c.id}</td><td>${esc(c.name)}</td><td>${esc(c.qualification)}</td><td>${pc(c.rate)}</td><td>${hours(c.free)}</td><td>${c.next?dateLabel(c.next.date)+' '+time(c.next.start_minute):'No slot in range'}</td><td>${c.matched}</td><td><span class="pill soft-blue">${clinicianStatus(c)}</span></td><td><button class="action" data-clinician-detail="${c.id}">View matches</button></td></tr>`).join('')||'<tr><td colspan="9">No clinicians match this search.</td></tr>';
}
function renderBooking(){
  const f=clinicianFilter();f.end=add(M.anchor,Math.min(bookingPeriod,Number(controls('clinician')[2].value)));
  const s=M.capacity(f);let html='<span></span>'+['Mon','Tue','Wed','Thu','Fri'].map(x=>`<b>${x}</b>`).join('');
  for(let h=9;h<15;h++){
    html+=`<span>${h}:00–${h+1}:00</span>`;
    for(let weekday=1;weekday<=5;weekday++){
      const overlap=r=>Math.max(0,Math.min(r.start_minute+r.duration_minutes,(h+1)*60)-Math.max(r.start_minute,h*60));
      const offered=s.offered.filter(r=>new Date(r.date+'T12:00:00Z').getUTCDay()===weekday),booked=s.booked.filter(r=>new Date(r.date+'T12:00:00Z').getUTCDay()===weekday);
      const total=offered.reduce((n,r)=>n+overlap(r),0),used=booked.reduce((n,r)=>n+overlap(r),0),v=rate(used,total);
      html+=`<span class="cell" title="${hours(used)} booked / ${hours(total)} offered" style="background:${shade(v)}">${pc(v)}</span>`;
    }
  }
  $('#bookingHeatmap').innerHTML=html;$('.weekly-head .panel-desc').textContent=`${f.start} → ${f.end} · weighted slot fill; — = no offered capacity`;
}
function feedbackStats(f){const all=M.rows(f),c=M.reasons(f,'cancelled',controls('feedback')[5].value),n=M.reasons(f,'no_show',controls('feedback')[4].value);return {all,c,n,cr:rate(c.length,all.length),nr:rate(n.length,all.length)};}
function renderFeedback(){
  const f=feedbackFilter(),s=feedbackStats(f),p=feedbackStats(feedbackFilter(true)),t=M.themes(f),surveys=M.surveys(f),previous=M.surveys(feedbackFilter(true));
  [['cancelTotal',fmt(s.c.length)],['noShowTotal',fmt(s.n.length)],['cancelRate',pc(s.cr)],['noShowRate',pc(s.nr)]].forEach(([id,v])=>$('#'+id).textContent=v);
  $$('.fb-kpi .delta').forEach((el,i)=>el.textContent=[`${s.c.length-p.c.length>=0?'+':''}${s.c.length-p.c.length} vs prior`,`${s.n.length-p.n.length>=0?'+':''}${s.n.length-p.n.length} vs prior`,delta(s.cr,p.cr,true),delta(s.nr,p.nr,true)][i]);
  $$('.fb-kpi .delta').forEach((el,i)=>el.className='delta '+([s.c.length-p.c.length,s.n.length-p.n.length,s.cr-p.cr,s.nr-p.nr][i]>0?'red':'green'));
  $$('.fb-kpi .subtext').forEach(el=>el.textContent=`${s.all.length} attempts · vs previous equal period`);
  $('#syntheticDataSummary').textContent=`${M.data.metadata.patient_count.toLocaleString()} fictional patients · ${M.data.clinicians.length} fictional clinicians · snapshot ${M.anchor} · ${s.all.length} matching appointments, ${surveys.length} surveys`;
  const buckets=M.buckets(f,Number(controls('feedback')[0].value)>30?13:30),bucketStats=buckets.map(x=>feedbackStats(x));
  // Same baseline and ceiling for both rates and all date windows of a cohort.
  const reference=M.buckets({...f,...M.range(90)}).map(x=>feedbackStats(x));
  const ceiling=Math.min(100,Math.max(30,Math.ceil(Math.max(...reference.flatMap(x=>[x.cr||0,x.nr||0]))/10)*10));
  ['cancelChart','noShowChart'].forEach((id,i)=>draw(id,buckets.map(x=>dateLabel(x.start)),[{label:i?'No-show rate (%)':'Cancellation rate (%)',data:bucketStats.map(x=>i?x.nr:x.cr),borderColor:i?'#777bc6':'#e97879',backgroundColor:i?'#777bc6':'#e97879'}],'line',{scales:{x:{grid:{display:false},ticks:{maxTicksLimit:8}},y:{beginAtZero:true,max:ceiling}},plugins:{legend:{display:false},tooltip:{callbacks:{afterLabel:ctx=>{const b=bucketStats[ctx.dataIndex];return `${i?b.n.length:b.c.length} / ${b.all.length} attempts${b.all.length<5?' · low sample':''}`;}}}}}));
  $('#feedbackSurveyStrip').innerHTML=[['overall','Overall satisfaction'],['booking','Booking process'],['waiting','Waiting time'],['experience','Appointment experience'],['quality','Consultation quality']].map(([k,l])=>`<div class="survey"><label>${l}</label><b>${fmt(mean(surveys,k))}/5</b><span class="good">n=${surveys.filter(r=>r[k]!=null).length} · ${delta(mean(surveys,k),mean(previous,k),true).replace(' pp',' points')}</span></div>`).join('');
  const reasons=['Emergency / Unforeseen Obligations','Change of Mind','Financial Issues','Patient Anxiety / Resistance','Unknown'], counts=reasons.map(r=>s.c.filter(a=>a.cancellation_reason===r).length), reasonColors=['#9497dd','#e76064','#474b9e','#f2a645','#fae8c7'];
  draw('reasonChart',reasons,[{label:'Cancelled appointments',data:counts,backgroundColor:reasonColors}],'doughnut');
  $$('.donut-legend .legend-row').forEach((el,i)=>el.innerHTML=`<span class="swatch" style="background:${reasonColors[i]}"></span>${esc(reasons[i])} · ${counts[i]} (${pc(rate(counts[i],s.c.length))})`);
  const complaints=t.themes.filter(x=>x.sentiment==='negative');
  $('#feedbackThemes').innerHTML=t.insufficient?'<p>Insufficient evidence: fewer than 5 responses. View individual comments without inferring recurring themes.</p>':complaints.map(x=>`<div class="theme-row"><span>${esc(x.label)}</span><b>${x.count} / ${t.total} · ${pc(x.share)}</b><div class="ai-theme-track"><span style="width:${x.share}%"></span></div></div>`).join('')||'<p>No negative feedback in this filtered sample.</p>';
  $('#feedbackInsights').innerHTML=`<div class="insights-head"><h2>Key Operational Insights</h2><button class="ai-generate" data-ai-scenario="feedback-overview">View all feedback themes & evidence</button></div>`+
    [[`Cancellation: ${pc(s.cr)}`,`${s.c.length} selected-reason cancellations / ${s.all.length} matching appointment attempts. ${delta(s.cr,p.cr,true)} vs the previous equal period. No-show reason selection does not change this metric.`,'feedback-cancellation'],
      [`No-show: ${pc(s.nr)}`,`${s.n.length} selected-reason no-shows / ${s.all.length} matching attempts. ${delta(s.nr,p.nr,true)} vs prior. The reminder incident on 9–12 September is a constructed simulation, not an observed company event.`,'feedback-noshow'],
      [t.insufficient?'Insufficient evidence':`${t.total} feedback records counted`,t.insufficient?'Fewer than 5 responses: show individual evidence, but do not infer recurring themes.':`Positive and negative themes are counted across all matching responses, not a Top-K retrieval sample. Most frequent: ${t.themes[0]?.label}. Correlation does not establish a cause.`,'feedback-overview']].map(([title,copy,scenario])=>`<div class="insight"><div class="insight-copy"><b>${esc(title)}</b><p>${esc(copy)}</p></div><button class="insight-evidence" data-ai-scenario="${scenario}">Evidence →</button></div>`).join('');
  note('#feedback','feedbackDefinitions',`Date/clinician/patient/type filter the entire cohort. Reason selectors filter only the respective cancellation/no-show numerator and reason chart; surveys/themes retain the cohort. Rates use all matching appointment attempts, including rescheduled attempts. Zero denominator = —. Both charts share 0–${ceiling}% based on this cohort's 90-day daily maximum, unchanged between 7/30/90-day views. Missing days are gaps.`);
}
function drawer(title,body){$('#aiDrawerBody').innerHTML=`<h2>${esc(title)}</h2>${body}`;$('#aiDrawer').classList.add('show');$('#aiBackdrop').classList.add('show');$('#aiDrawer').setAttribute('aria-hidden','false');}
function closeDrawer(){currentScope='';$('#aiDrawer').classList.remove('show');$('#aiBackdrop').classList.remove('show');$('#aiDrawer').setAttribute('aria-hidden','true');}
function evidence(rows,describe){return rows.map(r=>`<div class="ai-evidence-card"><b>${esc(r.record_id||r.referral_id||r.appointment_id)}</b><p>${esc(describe(r))}</p></div>`).join('')||'<p>No matching evidence.</p>';}
function openEvidence(scenario){
  currentScope=scenario;let body='',f;
  if(scenario.startsWith('feedback')){
    f=feedbackFilter();const t=M.themes(f),s=feedbackStats(f);
    body=`<p class="ai-analysis-note">${f.start} → ${f.end} · ${s.all.length} appointment attempts · ${t.total} linked feedback responses. Filters applied before counting.</p>`;
    if(scenario==='feedback-cancellation'||scenario==='feedback-noshow'){
      const rows=scenario==='feedback-cancellation'?s.c:s.n;
      body+=`<h3>${rows.length} matching outcomes · ${pc(rate(rows.length,s.all.length))}</h3><p>Up to 12 audit examples shown; totals use all ${rows.length} matching records.</p>`+evidence(rows.slice(0,12),r=>`${r.appointment_date} · ${r.clinician_name} · ${r.status} · ${r.cancellation_reason||r.no_show_reason}`);
    }else{
      body+=`<h3>${t.insufficient?'Insufficient evidence':'All-response theme frequencies'}</h3><p>One pre-labelled primary theme per fictional response. This is reproducible counting, not an LLM sentiment classifier.</p>`;
      if(!t.insufficient)body+=t.themes.map(x=>`<div class="ai-theme-row"><strong>${esc(x.label)} · ${x.sentiment}</strong><span>${x.count}/${t.total} · ${pc(x.share)}</span></div>`).join('');
      body+='<h3>Representative original comments</h3>'+t.themes.map(x=>evidence(x.records.slice(0,2),r=>`${r.date} · ${r.appointment_id} · ${r.text}`)).join('');
    }
    body+='<h3>Suggested next step</h3><p>Review the largest negative theme alongside positive feedback and sample size; test one booking/reminder change and compare equal periods. These data cannot establish clinical impact or causality.</p>';
  }else if(scenario.startsWith('allocation')){
    f=clinicianFilter();const s=M.capacity(f),rows=scenario.includes('priority')?s.priority:scenario.includes('waiting')?s.waiting:s.followups;
    body=`<p>${f.start} → ${f.end} · ${rows.length} records in this risk group; ${s.atRisk} unique patients across overlapping groups.</p><p>Demo rule: match service role, appointment type and preferred time against actual free slots. The 7-day SLA and 85% target are demonstration assumptions.</p>`+evidence(rows.slice(0,12),r=>r.referral_id?`${r.patient_id} · ${r.role} · ${r.appointment_type} · ${r.preferred_time} · waiting since ${r.created_date}`:`${r.patient_id} · ${r.clinician_role} · follow-up due ${r.followup_due}`)+'<p>Next action: review priority and overdue cases, then confirm suitability with staff before booking. No patient has been automatically allocated.</p>';
  }else{
    f=overviewFilter();const s=M.stats(f),p=M.stats(overviewFilter(true));
    body=`<p>${f.start} → ${f.end} · ${esc(f.role)} / ${esc(f.status)}</p><p>Service revenue ${money(s.revenue)} (${delta(s.revenue,p.revenue)} vs prior) is the sum of completed session fees. Late cancellation fees ${money(s.fees)} are separate; neither deposits nor Medicare rebates are counted again.</p><p>${s.confirmed} confirmed + ${s.rescheduled} rescheduled + ${s.cancelled} cancelled = ${s.total} appointment attempts. ${s.patients} distinct patients. ${hours(s.used)} occupied / ${hours(s.capacity)} offered = ${pc(s.utilisation)} utilisation.</p><p>These are arithmetic explanations, not proven causes of a change. First check the matching records and case mix.</p>`+evidence(s.rows.slice(0,10),r=>`${r.appointment_date} · ${r.status} · ${r.duration_minutes} min · service ${money(r.service_revenue_cents/100)} · cancellation fee ${money(r.cancellation_fee_cents/100)}`);
  }
  if(scenario==='feedback-overview'&&['127.0.0.1','localhost'].includes(location.hostname))body+='<button class="ai-generate" id="liveFeedbackButton">Generate live RAG explanation (uses configured API)</button><div id="liveFeedbackResult"></div>';
  body+='<div class="ai-prototype-note">Computed locally from the complete synthetic ledger. No live LLM call is made by this public evidence view. Company policy reference: <a href="https://www.pandionhealth.com.au/financial-consent-and-cancellation-policy/" target="_blank" rel="noopener">financial consent & cancellation</a>. Internal thresholds and proposed actions are demo rules, not company-approved SOPs.</div>';
  drawer('Evidence & calculation details',body);
  if($('#liveFeedbackButton'))$('#liveFeedbackButton').onclick=async()=>{
    const button=$('#liveFeedbackButton'),result=$('#liveFeedbackResult');button.disabled=true;result.textContent='Retrieving demo SOP and generating from verified full-cohort statistics…';
    try{const response=await fetch('/api/insights',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scenario:'feedback-overview',filters:{start_date:f.start,end_date:f.end,clinician:f.clinician,patient_segment:f.segment,appointment_type:f.type}})});const output=await response.json();if(!response.ok)throw new Error(output.error||'Service unavailable');
      result.innerHTML=`<h3>${esc(output.title)}</h3><p>${esc(output.summary)}</p><p>${esc(output.recommendation)}</p><p>Mode: ${esc(output.generation_mode)} · ${esc(output.model)} · ${output.analytics?.total_feedback??'—'} filtered responses</p>`+evidence(output.evidence.map(r=>({record_id:r.source,text:r.quote})),r=>r.text);
    }catch(error){result.textContent='Live synthesis unavailable. The verified counts and evidence above remain available.';}finally{button.disabled=false;}
  };
}
function exportClinicians(){const columns=['id','name','role','total','used','free','rate','matched'];const csv=[columns.join(','),...visibleClinicians().map(r=>columns.map(k=>'"'+String(r[k]??'').replaceAll('"','""')+'"').join(','))].join('\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'})),a=document.createElement('a');a.href=url;a.download='pandion-synthetic-clinicians.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function init(){
  Chart.register({id:'capacityTargetLines',afterDatasetsDraw(chart){if(chart.canvas.id!=='professionChart')return;const {ctx,chartArea:{top,bottom},scales:{x}}=chart;[[65,'#23c638'],[85,'#ff3940']].forEach(([value,color])=>{ctx.save();ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x.getPixelForValue(value),top);ctx.lineTo(x.getPixelForValue(value),bottom);ctx.stroke();ctx.restore();});}});
  function fit(){document.documentElement.style.setProperty('--dashboard-scale',((document.documentElement.clientWidth||window.innerWidth)/1536).toFixed(5));}
  fit();window.addEventListener('resize',fit);
  $('#portfolioBanner').innerHTML=`Synthetic clinic demonstration <span>· ${M.data.metadata.patient_count.toLocaleString()} fictional patients · 33 fictional clinicians · snapshot ${M.anchor} · AUD · all appointments telehealth</span>`;$('#portfolioBanner').classList.add('show');
  const ov=controls('overview');ov[1].insertAdjacentHTML('afterend','<select class="filter" data-scope="overview" aria-label="Overview date range"><option value="30">Last 30 Days</option><option value="7">Last 7 Days</option><option value="90">Last 90 Days</option></select>');
  $('.date-chip').title='Fixed reproducible demo date, not the current date';
  $$('.nav-group').filter(e=>!e.querySelector('.nav-page')).forEach(el=>{el.style.opacity='.45';el.title='Navigation placeholder · not implemented in this prototype';el.insertAdjacentHTML('beforeend','<small style="display:block;padding:0 12px 8px">Not in this prototype</small>');});
  $('.auth .nav-label').textContent='Authentication · design only';$$('.auth a').forEach(el=>{el.style.opacity='.45';el.title='Not implemented';});
  $$('.overview-kpi .k-label')[0].textContent='Service revenue (AUD)';$$('.overview-kpi .k-label')[1].textContent='Appointment attempts';$$('.overview-kpi .k-label')[2].textContent='Unique patients';$$('.overview-kpi .k-label')[3].textContent='Occupied capacity';
  $('#completedAppt').previousElementSibling.textContent='Confirmed';$('.heat-scale span').textContent='Occupied / offered minutes (%)';
  const cl=controls('clinician');cl[1].options[0].value='all';cl[1].options[1].value='assessment';cl[1].options[2].value='follow_up';[28,14,56].forEach((v,i)=>cl[2].options[i].value=v);
  $('.cl-kpis .cap').textContent='Total offered hours';
  const fb=controls('feedback');[7,30,90].forEach((v,i)=>fb[0].options[i].value=v);fb[1].innerHTML='<option value="all">All Clinicians</option>'+M.data.clinicians.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');fb[3].querySelector('[value="telehealth"]')?.remove();fb[4].insertAdjacentHTML('beforeend','<option>Unknown</option>');
  $$('.middle-card h2')[1].textContent='Negative feedback themes';
  $$('.disclaimer').forEach(el=>el.textContent='Entirely fictional records, not anonymised patient data. Team mix/selected list prices informed by public sources; volume, availability, incidents and service targets are modelling assumptions. All times Australia/Sydney.');
  $$('.nav-page').forEach(btn=>btn.addEventListener('click',()=>{$$('.nav-page').forEach(b=>b.classList.toggle('active',b===btn));$$('.page').forEach(p=>p.classList.toggle('active',p.id===btn.dataset.page));}));
  $$('.filter').forEach(el=>el.addEventListener('change',()=>{closeDrawer();({overview:renderOverview,clinician:renderClinician,feedback:renderFeedback}[el.dataset.scope])();}));
  $$('.calendar-toggle').forEach(el=>el.addEventListener('click',()=>{bookingPeriod=el.dataset.bookingPeriod==='week'?7:28;$$('.calendar-toggle').forEach(x=>x.classList.toggle('active',x===el));renderBooking();}));
  $('.week-switches label').firstChild.textContent='Next 7 days ';
  $('.search').addEventListener('input',renderClinicianTable);
  const buttons=$$('.table-buttons button');buttons[0].onclick=()=>controls('clinician')[0].focus();buttons[1].textContent='Sort · utilisation ↑';buttons[1].onclick=()=>{sortAscending=!sortAscending;buttons[1].textContent='Sort · utilisation '+(sortAscending?'↑':'↓');renderClinicianTable();};buttons[2].onclick=exportClinicians;
  // No false promise that this read-only prototype creates clinical records.
  [...$$('.head-actions button'),buttons[3],...$$('.topbar .icon-btn')].forEach(el=>{el.disabled=true;el.title='Read-only data prototype: this workflow is not implemented.';});
  document.addEventListener('click',event=>{const e=event.target.closest('[data-ai-scenario],[data-day],[data-month],[data-clinician-detail]');if(!e)return;
    if(e.dataset.aiScenario)openEvidence(e.dataset.aiScenario);
    if(e.dataset.day){selectedDay=e.dataset.day;renderCalendar();}
    if(e.dataset.month){const f=overviewFilter(),d=new Date(selectedDay+'T12:00:00Z');d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+Number(e.dataset.month));const proposed=d.toISOString().slice(0,10);selectedDay=proposed<f.start?f.start:proposed>f.end?f.end:proposed;renderCalendar();}
    if(e.dataset.clinicianDetail){const c=clinicianState.roster.find(c=>c.id===e.dataset.clinicianDetail);drawer(c.name+' · matching candidates',`<p>${hours(c.used)} booked / ${hours(c.total)} offered. ${c.matched} unique candidates; a patient can match several clinicians and has not been assigned.</p>`+evidence(clinicianState.referrals.filter(r=>c.matchedIds.includes(r.referral_id)),r=>`${r.patient_id} · ${r.appointment_type} · ${r.preferred_time} · ${r.priority} priority`));}
  });
  $('#overview .view-all').onclick=()=>drawer('Appointments · '+selectedDay,evidence(M.rows({...overviewFilter(),start:selectedDay,end:selectedDay}),a=>`${time(a.start_minute)} · ${a.clinician_name} · ${a.patient_id} · ${a.status} · service ${money(a.service_revenue_cents/100)}`));
  $('#aiClose').onclick=closeDrawer;$('#aiBackdrop').onclick=closeDrawer;document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer();});
  renderOverview();renderClinician();renderFeedback();$$('.page').forEach(p=>p.style.visibility='visible');
}
try{init();}catch(error){console.error(error);document.body.insertAdjacentHTML('afterbegin','<div role="alert" style="padding:20px;background:#ffe1e1">Dashboard data could not be loaded. Do not rely on placeholder figures. Please reload or check the data assets.</div>');$$('.page').forEach(p=>p.style.visibility='hidden');}
