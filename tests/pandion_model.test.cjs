const assert=require('node:assert/strict');
const data=require('../examples/pandion_demo/synthetic_operations.json');
const {create,add}=require('../examples/pandion_demo/clinic_model.js');
const m=create(data);let combinations=0;
for(const days of [7,30,90])for(const role of ['All Roles',...new Set(data.clinicians.map(c=>c.role))]){
  const f={...m.range(days),role},s=m.stats(f);
  const split=['Confirmed','Rescheduled','Cancelled'].map(status=>m.stats({...f,status}));
  assert.equal(split.reduce((n,x)=>n+x.total,0),s.total);
  assert.equal(split.reduce((n,x)=>n+x.revenue,0),s.revenue);
  assert.equal(split[2].revenue,0);assert.equal(split[1].revenue,0);
  assert.equal(split[2].used,0);assert.equal(split[1].used,0);
  assert.ok(s.used<=s.capacity);
  assert.equal(m.buckets(f,13).reduce((n,b)=>n+m.stats(b).total,0),s.total);
  const t=m.themes(f);assert.equal(t.themes.reduce((n,x)=>n+x.count,0),t.total);
  combinations++;
}
for(const days of [14,28,56])for(const role of ['All Roles',...new Set(data.clinicians.map(c=>c.role))])for(const type of ['all','assessment','follow_up']){
  const s=m.capacity({start:add(m.anchor,1),end:add(m.anchor,days),role,type});
  assert.equal(s.roster.reduce((n,c)=>n+c.total,0),s.total);
  assert.equal(s.roster.reduce((n,c)=>n+c.used,0),s.used);
  assert.equal(s.roster.reduce((n,c)=>n+c.free,0),s.total-s.used);
  assert.ok(s.used<=s.total);
  const union=new Set([...s.priority,...s.waiting,...s.followups].map(r=>r.patient_id));assert.equal(union.size,s.atRisk);
  for(const c of s.roster)assert.ok(c.rate===null||(c.rate>=0&&c.rate<=100));
  combinations++;
}
for(const clinician of ['all',...data.clinicians.map(c=>c.id)])for(const segment of ['all','high_risk','new_patient','continuing_patient'])for(const type of ['all','assessment','follow_up']){
  const f={...m.range(7),clinician,segment,type};
  const s=m.stats(f),t=m.themes(f);
  assert.equal(s.total,s.confirmed+s.cancelled+s.rescheduled);
  assert.ok(t.total<=s.total);
  assert.equal(m.reasons(f,'cancelled','Financial Issues').length<=s.cancelled,true);
  combinations++;
}
const empty=m.stats({...m.range(7),clinician:'missing'});assert.equal(empty.total,0);assert.equal(empty.cancellationRate,null);
for(const days of [7,30,90]){
  const f=m.range(days),events=m.lifecycle(f);
  assert.equal(m.buckets(f,8).reduce((n,b)=>n+m.stats(b).total,0),m.stats(f).total);
  assert.equal(m.buckets(f,8).reduce((n,b)=>n+m.lifecycle(b).length,0),events.length);
  assert.deepEqual(m.lifecycle({...f,status:'Cancelled'}),events);
  for(const key of ['revenue','total','patients','utilisation'])for(const point of m.sparkline(f,key)){
    assert.equal(point.value,m.stats({...f,start:add(point.date,-6),end:point.date})[key]);
  }
}
assert.ok(data.lifecycle_events.length>0);
for(const e of data.lifecycle_events){assert.ok(['new','reactivated','inactivity','inactivated'].includes(e.kind));assert.ok(e.source_id);assert.ok(e.date<=m.anchor);}
for(const r of data.feedback)if(r.sentiment==='negative')assert.ok(r.complaint_impact_score>=1&&r.complaint_impact_score<=5);
const week=m.stats(m.range(7)),month=m.stats(m.range(30));assert.ok(week.cancellationRate>month.cancellationRate+3);
console.log(`PASS: ${combinations} filter combinations; partitions, zero cancelled revenue, capacity, theme counts, empty state, queue union, incident contrast.`);
console.log(JSON.stringify({week:{total:week.total,cancelled:week.cancelled,rate:week.cancellationRate,revenue:week.revenue},month:{total:month.total,cancelled:month.cancelled,rate:month.cancellationRate,revenue:month.revenue}},null,2));
