const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {test} = require('node:test');

test('cancellation brief separates takeaway, explanation and action; evidence stays folded',()=>{
  const ctx=vm.createContext({esc:String});
  vm.runInContext(fs.readFileSync('examples/pandion_demo/insight_chat.js','utf8'),ctx);
  const html=ctx.renderChatAnswer({intent:'cancellation_analysis',brief:{headline:'Rate rose.',findings:['Known reasons.','Missing reasons.'],next_step:'Check records.'},comparison:{current_period:['a','b'],previous_period:['c','d'],filters:{clinician:'all',segment:'all',type:'all'},comparable:true,reasons:[]},evidence:[]});
  assert.match(html,/<strong>Rate rose\.<\/strong>/);
  assert.match(html,/<p>Known reasons\.<\/p><p>Missing reasons\.<\/p>/);
  assert.match(html,/<strong>Start here:<\/strong> Check records\./);
  assert.doesNotMatch(html,/<details open/);
  assert.ok(html.indexOf('Start here:')<html.indexOf('Supporting evidence'));
  const types=ctx.renderChatAnswer({intent:'cancellation_types',answer:'Follow-up contributed most.',type_breakdown:[{label:'Assessment',contribution_pp:1},{label:'Follow-up',contribution_pp:2}],comparison:{current_period:['a','b'],previous_period:['c','d'],filters:{clinician:'all',segment:'all',type:'all'},comparable:true,reasons:[]},evidence:[]});
  assert.match(types,/Assessment<\/strong>: \+1.00 percentage points/);
  assert.match(types,/appointment mix/);
  assert.doesNotMatch(types,/<details open/);
});

test('concise plan leads with action; Enter sends, Shift+Enter and composition do not', () => {
  const ctx=vm.createContext({esc:String});
  vm.runInContext(fs.readFileSync('examples/pandion_demo/insight_chat.js','utf8'),ctx);
  const brief=ctx.renderDailyPlan({selected:20,high_remaining:7,steps:[{title:'High-priority waiting patients',count:20}]});
  assert.match(brief,/Start by reviewing 20 high-priority waiting patients/);
  assert.match(brief,/Another 7/);
  assert.doesNotMatch(brief,/Demo date|scenario limit|unique patients/);
  const why=ctx.renderChatAnswer({intent:'daily_why',mode:'live_rag',answer:'These patients already carry priority flags.',plan:{steps:[],records:[]},evidence:[]});
  assert.ok(why.startsWith('<p>These patients already carry priority flags.</p>'));
  assert.doesNotMatch(why,/Start by reviewing|Why this order/);
  const sent=[];ctx.sendInsightQuestion=q=>sent.push(q);
  let prevented=0;
  const event={target:{id:'insightQuestion',value:'Question'},key:'Enter',preventDefault(){prevented++;}};
  ctx.handleChatEnter({...event,shiftKey:true});
  ctx.handleChatEnter({...event,isComposing:true});
  ctx.handleChatEnter({...event,keyCode:229});
  assert.equal(sent.length,0);
  ctx.handleChatEnter(event);
  assert.deepEqual(sent,['Question']);assert.equal(prevented,1);
});

test('chat retains same-filter history, isolates filters and ignores late responses', async () => {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {innerHTML:'', value:'', setAttribute(){}, insertAdjacentHTML(){}, addEventListener(){}});
    return nodes.get(id);
  };
  const requests = [];
  const ctx = vm.createContext({
    $:node, location:{hostname:'localhost'}, esc:String, AbortController, setTimeout, clearTimeout,
    fetch:(url,options) => new Promise(resolve => requests.push({resolve,body:JSON.parse(options.body)})),
  });
  vm.runInContext(fs.readFileSync('examples/pandion_demo/insight_chat.js','utf8'),ctx);
  const a={filters:{role:'All Roles'}}, b={filters:{role:'Coaching'}};
  ctx.mountInsightChat(a);
  assert.equal(node('#insightChat').hidden,false);
  assert.doesNotMatch(node('#insightChatBody').innerHTML,/中文|Show all overdue follow-ups/);
  const pending=ctx.sendInsightQuestion('Show supporting records');
  assert.match(node('#insightChatBody').innerHTML,/Checking records/);
  ctx.stopInsightChat();
  assert.equal(node('#insightChat').hidden,true);
  ctx.mountInsightChat(b);
  requests[0].resolve({ok:true,json:async()=>({state:{age:'over30',group:'all'},mode:'computed',answer:'OLD RESPONSE'})});
  await pending;
  assert.doesNotMatch(node('#insightChatBody').innerHTML,/OLD RESPONSE/);
  assert.match(node('#insightChatBody').innerHTML,/Where should your team start/);
  ctx.stopInsightChat();ctx.mountInsightChat(a);
  assert.doesNotMatch(node('#insightChatBody').innerHTML,/Checking records/);
  const next=ctx.sendInsightQuestion('Only follow-ups over 30 days overdue');
  requests[1].resolve({ok:true,json:async()=>({state:{age:'over30',group:'all'},mode:'computed',answer:'SAVED RESPONSE'})});
  await next;
  ctx.stopInsightChat();ctx.mountInsightChat(a);
  assert.match(node('#insightChatBody').innerHTML,/SAVED RESPONSE/);
  const follow=ctx.sendInsightQuestion('Show supporting records');
  assert.equal(requests[2].body.state.age,'over30');
  assert.deepEqual(requests[2].body.history,['Only follow-ups over 30 days overdue']);
  requests[2].resolve({ok:false,json:async()=>({})});
  await follow;
  assert.equal(node('#insightQuestion').value,'Show supporting records');
  assert.match(node('#insightChatBody').innerHTML,/scope is unchanged/);
  ctx.stopInsightChat();ctx.mountInsightChat({...a,feedbackFilters:{start:'2026-09-01',end:'2026-09-07'}});
  assert.doesNotMatch(node('#insightChatBody').innerHTML,/SAVED RESPONSE/);
  const ask=ctx.sendInsightQuestion('Why did cancellations change?');
  requests[3].resolve({ok:true,json:async()=>({state:{age:'all',group:'all',pending_period:{start:'2026-09-01',end:'2026-09-07'}},mode:'clarification',answer:'Which periods?',choices:['Last 30 days']})});
  await ask;
  assert.match(node('#insightChatBody').innerHTML,/data-chat-prompt="Last 30 days"/);
  const reply=ctx.sendInsightQuestion('Last 30 days');
  assert.equal(requests[4].body.state.pending_period.start,'2026-09-01');
  assert.doesNotMatch(node('#insightChatBody').innerHTML,/data-chat-prompt="Last 30 days"/);
  requests[4].resolve({ok:true,json:async()=>({state:{age:'all',group:'all',topic:'cancellation'},mode:'computed',answer:'Compared.'})});
  await reply;
  assert.doesNotMatch(node('#insightChatBody').innerHTML,/data-chat-prompt="Last 30 days"/);
});
