const assert=require('node:assert/strict');
const data=require('../examples/pandion_demo/synthetic_operations.json');
const {create,add}=require('../examples/pandion_demo/clinic_model.js');
const m=create(data);
for(const days of [7,30,90])for(const clinician of ['all','CLN-001','missing']){
  const f={...m.range(days),clinician},items=m.priorities('feedback',f),rows=new Set(m.rows(f).map(r=>r.appointment_id));
  assert.ok(items.length<=3);
  for(const item of items)for(const row of item.records)assert.ok(rows.has(row.appointment_id));
  if(clinician==='missing')assert.equal(items.length,0);
}
for(const role of ['All Roles','Psychiatrist','Coaching','missing']){
  const f={start:add(m.anchor,1),end:add(m.anchor,28),role,type:'all'},s=m.capacity(f),items=m.priorities('allocation',f);
  assert.ok(items.length<=3);
  for(const item of items){
    assert.ok(item.records.length);
    if(item.id==='allocation-blocked')for(const r of item.records)assert.ok(!s.free.some(slot=>s.compatible(r,slot)));
    if(item.id==='allocation-ready')for(const r of item.records)assert.ok(s.free.some(slot=>s.compatible(r,slot)));
    if(item.id==='allocation-overdue')for(const r of item.records)assert.ok(r.followup_due<m.anchor);
  }
  if(role==='missing')assert.equal(items.length,0);
}
assert.notDeepEqual(m.priorities('feedback',m.range(7)).map(x=>x.title),m.priorities('feedback',m.range(90)).map(x=>x.title));
console.log('PASS: priorities follow cohort, capacity constraints, dates and empty states.');
