/* Read-only conversations scoped to the currently selected overdue insight. */
'use strict';
const insightChats=new Map();
let activeInsightChat=null,insightChatAbort=null,insightChatVersion=0;
const chatGroups={all:'All workflow groups',time_mismatch:'Time conflicts',active_need:'Confirmed ongoing need',external_report:'Reported external bookings',no_reply_recorded:'Existing offers',missing_history:'Missing history',needs_review:'Needs review'};
function stopInsightChat(){insightChatVersion++;insightChatAbort?.abort();insightChatAbort=null;const c=insightChats.get(activeInsightChat);if(c)c.turns=c.turns.filter(t=>t.result);activeInsightChat=null;if($('#insightChat'))$('#insightChat').hidden=true;$('#insightChatLauncher')?.setAttribute('aria-expanded','false');}
function mountInsightChat(meta){
  const local=['127.0.0.1','localhost'].includes(location.hostname);
  const key=JSON.stringify([meta.filters,meta.feedbackFilters||null]);
  if(!insightChats.has(key)){
    if(insightChats.size>=8)insightChats.delete(insightChats.keys().next().value);
    insightChats.set(key,{state:{age:'all',group:'all'},turns:[],filters:{...meta.filters},feedbackFilters:meta.feedbackFilters});
  }
  activeInsightChat=key;
  $('#insightChat').hidden=false;
  $('#insightChatLauncher')?.setAttribute('aria-expanded','true');
  if(!local){$('#insightChatBody').innerHTML='<p class="chat-welcome">Open <a href="http://127.0.0.1:8765/">the running dashboard</a> to ask questions.</p>';return;}
  renderInsightChat();
}
function initInsightChat(){
  document.body.insertAdjacentHTML('beforeend',`<button id="insightChatLauncher" aria-label="Open AI assistant" aria-expanded="false" aria-controls="insightChat"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-8 8H5l-4 3V11.5a9.5 9.5 0 0 1 19 0Z"/><path d="M6 10h8M6 14h5"/></svg><span>Ask AI</span></button><section id="insightChat" role="dialog" aria-modal="false" aria-labelledby="insightChatTitle" hidden><header class="chat-header"><div><strong id="insightChatTitle">Pandion assistant</strong><small>Operations assistant</small></div><button id="insightChatClose" aria-label="Close AI assistant">×</button></header><div id="insightChatBody"></div></section>`);
  $('#insightChatLauncher').addEventListener('click',()=>{
    if(!$('#insightChat').hidden){stopInsightChat();return;}
    closeDrawer();mountInsightChat({filters:clinicianFilter(),feedbackFilters:feedbackFilter()});$('#insightQuestion')?.focus();
  });
  $('#insightChatClose').addEventListener('click',()=>{stopInsightChat();$('#insightChatLauncher').focus();});
  $('#insightChat').addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();stopInsightChat();$('#insightChatLauncher').focus();}});
  $('#insightChat').addEventListener('keydown',handleChatEnter);
  $('#insightChat').addEventListener('submit',e=>{e.preventDefault();const field=$('#insightQuestion');if(field)sendInsightQuestion(field.value);});
  $('#insightChat').addEventListener('click',e=>{
    const button=e.target.closest('[data-chat-prompt],[data-chat-reset]');if(!button)return;
    if(button.hasAttribute('data-chat-reset')){
      const chat=insightChats.get(activeInsightChat);if(!chat)return;
      chat.state={age:'all',group:'all'};chat.turns=[];renderInsightChat();
    }else sendInsightQuestion(button.dataset.chatPrompt);
  });
}
if(typeof document!=='undefined')initInsightChat();
function handleChatEnter(e){
  if(e.target.id==='insightQuestion'&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){
    e.preventDefault();if(!e.repeat&&!e.target.disabled)sendInsightQuestion(e.target.value);
  }
}
function renderInsightChat(pending=false,error=''){
  const chat=insightChats.get(activeInsightChat),target=$('#insightChatBody');if(!chat||!target)return;
  const comparisonQuestion='Why did the cancellation rate change?';
  target.innerHTML=`<div class="chat-turns" role="log" aria-live="polite">${chat.turns.length?'':'<div class="chat-welcome"><strong>Where should your team start?</strong><p>Compare priorities and build a practical review plan.</p></div>'}`+
    chat.turns.slice(-8).map(t=>`<article class="chat-turn"><p class="chat-question">${esc(t.question)}</p>${t.result?renderChatAnswer(t.result):'<p>Checking records…</p>'}</article>`).join('')+
    `</div><div class="chat-compose">${(!pending&&chat.state.pending_period)?`<div class="chat-prompts">${(chat.turns.at(-1)?.result?.choices||[]).map(q=>`<button type="button" data-chat-prompt="${esc(q)}">${esc(q)}</button>`).join('')}</div>`:''}${chat.turns.length?'':`<div class="chat-prompts">${['What should my team focus on today?',comparisonQuestion].map(q=>`<button type="button" data-chat-prompt="${esc(q)}">${esc(q)}</button>`).join('')}</div>`}<form><label for="insightQuestion">Ask a follow-up question</label><textarea id="insightQuestion" maxlength="600" rows="2" required ${pending?'disabled':''} placeholder="Ask a question…"></textarea><button type="submit" ${pending?'disabled':''}>${pending?'Checking…':'Send'}</button> <button type="button" data-chat-reset ${pending?'disabled':''}>New conversation</button></form><p role="status" class="data-note">${esc(error||'Enter to send · Shift+Enter for a new line · Demo data')}</p></div>`;
  const log=target.querySelector?.('.chat-turns');if(log)log.scrollTop=log.scrollHeight;
}
function renderChatAnswer(r){
  if(r.comparison)return renderCancellationAnswer(r);
  if(r.plan){
    if(r.intent==='daily_why')return `<p>${esc(r.answer)}</p>${r.mode==='rules_only'?'<p class="data-note">Based on the plan rules · AI explanation unavailable</p>':''}<details><summary>Supporting evidence</summary>${renderPlanEvidence(r.plan)}${renderSources((r.evidence||[]).filter(e=>e.kind==='sop'))}</details>`;
    if(r.intent==='daily_evidence')return renderPlanEvidence(r.plan);
    return renderDailyPlan(r.plan)+`<details><summary>Why this order?</summary><p>${esc(r.answer)}</p><p class="data-note">${r.mode==='live_rag'?'AI explanation with retrieved guidance.':'Rule-based plan; AI explanation unavailable.'}</p>${renderPlanMethod(r.plan)}</details><details><summary>Supporting evidence</summary>${renderPlanEvidence(r.plan)}${renderSources((r.evidence||[]).filter(e=>e.kind==='sop'))}</details>`;
  }
  const f=r.facts;
  const counts=f?`<p><strong>${f.selected_total} matching follow-ups.</strong></p><p>${Object.entries(f.groups).map(([k,n])=>esc(chatGroups[k]||k)+': '+n).join(' · ')}</p>`:'';
  const prose=['counts','evidence'].includes(r.intent)?'':`<p>${esc(r.answer)}</p>`;
  return counts+prose+(r.mode==='rules_only'?'<p class="data-note">AI unavailable · rule-based guidance</p>':'')+
    ((r.evidence||[]).length?`<details ${r.intent==='evidence'?'open':''}><summary>Supporting evidence</summary><p class="data-note">Examples supporting this group, not its complete patient list.</p>${renderSources(r.evidence)}</details>`:'');
}
function renderSources(evidence){
  return evidence.map(e=>`<details><summary>${esc(e.kind==='sop'?'Operational guidance':e.kind==='event'?'Recorded event':'Patient record')} · ${esc(e.source)}</summary><p>${esc(e.text)}</p></details>`).join('');
}
function renderPlanEvidence(p){
  return `<p><strong>The selected records support this review order:</strong></p><ul>${p.steps.map(s=>`<li>${s.count} selected from ${s.available} · ${esc(s.title)}</li>`).join('')}</ul><p>Existing priority flags come first; within each group, the longest waits come first.</p><details><summary>View selected records (${p.records.length})</summary><p class="data-note">All records in this review batch, not all dashboard patients. Waiting days are calculated as of ${esc(p.as_of)}.</p>${p.records.map(r=>`<article class="ai-evidence-card"><strong>${esc(r.patient)} · ${esc(r.source)}</strong><p>${esc(p.steps.find(s=>s.title===dailyTierLabels[r.tier])?.title||dailyTierLabels[r.tier])} · ${r.age} days</p><p>${esc(r.text)}</p></article>`).join('')}</details>`;
}
const dailyTierLabels=['High-priority waiting patients','Other patients waiting over seven days','Follow-ups with a recorded time conflict','Follow-ups with confirmed ongoing need','Other overdue follow-ups requiring review'];
function renderPlanMethod(p){
  return `<p class="data-note">As of ${esc(p.as_of)} · ${p.total} unique patients · ${p.overlap} duplicate alert memberships removed. This is a review plan, not a booking or clinical decision.</p>`;
}
async function sendInsightQuestion(question){
  question=question.trim();if(!question||question.length>600||insightChatAbort)return;
  const key=activeInsightChat,chat=insightChats.get(key);if(!chat)return;
  const version=++insightChatVersion,controller=new AbortController();insightChatAbort=controller;
  const history=chat.turns.filter(t=>t.result).slice(-6).map(t=>t.question);
  const turn={question};chat.turns.push(turn);renderInsightChat(true);
  const timeout=setTimeout(()=>controller.abort(),60000);
  try{
    const response=await fetch('/api/insight-chat',{method:'POST',headers:{'content-type':'application/json'},signal:controller.signal,
      body:JSON.stringify({insight:'allocation-overdue',filters:chat.filters,feedback_filters:chat.feedbackFilters,state:chat.state,question,history})});
    const result=await response.json();if(!response.ok)throw new Error('Assistant unavailable');
    if(version!==insightChatVersion||activeInsightChat!==key)return;
    turn.result=result;chat.state=result.state;chat.turns=chat.turns.slice(-8);renderInsightChat();
  }catch(e){
    if(version===insightChatVersion&&activeInsightChat===key){chat.turns.pop();renderInsightChat(false,'Request did not complete. Your scope is unchanged; please retry.');if($('#insightQuestion'))$('#insightQuestion').value=question;}
  }finally{
    clearTimeout(timeout);
    if(insightChatAbort===controller)insightChatAbort=null;
    // A closed drawer must not retain an unanswered turn.
    if(version!==insightChatVersion)chat.turns=chat.turns.filter(t=>t!==turn);
  }
}
function renderDailyPlan(p){
  if(!p.selected)return '<p>No patients match the current selection.</p>';
  const groups=p.steps.map(s=>`${s.count} ${s.title.toLowerCase()}`);
  return `<p><strong>Start by reviewing ${esc(groups.join(', then '))}.</strong></p>${p.high_remaining?`<p>Another ${p.high_remaining} high-priority patients need review. Arrange extra support rather than leaving them unattended.</p>`:''}`;
}
function renderCancellationAnswer(r){
  const c=r.comparison;
  const scope=[c.current_period.join(' – ')+' vs '+c.previous_period.join(' – '),...['clinician','segment','type'].filter(k=>c.filters[k]!=='all').map(k=>({assessment:'Assessment',follow_up:'Follow-up'}[c.filters[k]]||c.filters[k]))].join(' · ');
  const breakdown=c.comparable?`<p>${c.current_outcomes} / ${c.current_appointments} appointments cancelled, versus ${c.previous_outcomes} / ${c.previous_appointments} in ${esc(c.previous_period.join(' – '))}.</p><ul>${c.reasons.map(x=>`<li>${esc(x.reason)}: ${x.previous} → ${x.current}; ${x.rate_contribution_pp>=0?'+':''}${x.rate_contribution_pp.toFixed(1)} pp</li>`).join('')}</ul><p class="data-note">Each contribution uses all appointments in its period as the denominator. Recorded reasons explain the arithmetic, not a proven root cause.</p>`:'';
  const body=r.brief?`<p><strong>${esc(r.brief.headline)}</strong></p>${r.brief.findings.map(s=>`<p>${esc(s)}</p>`).join('')}${r.brief.next_step?`<p><strong>Start here:</strong> ${esc(r.brief.next_step)}</p>`:''}`:`<p>${esc(r.answer)}</p>`;
  const types=r.type_breakdown?`<ul>${r.type_breakdown.map(g=>`<li><strong>${esc(g.label)}</strong>: ${g.contribution_pp===null?'Not available':(g.contribution_pp>=0?'+':'')+g.contribution_pp.toFixed(2)+' percentage points'} of the overall change.</li>`).join('')}</ul><p class="data-note">Each contribution uses all appointments in that period, not just this type. Contributions sum to the overall rate change and reflect both cancellation behaviour and appointment mix; they do not establish a cause.</p>`:breakdown;
  return body+`<p class="data-note">${esc(scope)}${r.mode==='rules_only'?' · AI unavailable; rule-based suggestion':''}</p>${c.comparable?`<details ${['cancellation_evidence','cancellation_type_evidence'].includes(r.intent)?'open':''}><summary>Supporting evidence</summary>${types}<details><summary>View source records</summary><p class="data-note">Selected examples covering the discussed groups; totals use all matching appointments. Operational guidance informs actions, not causes.</p>${renderSources(r.evidence||[])}</details></details>`:''}`;
}
