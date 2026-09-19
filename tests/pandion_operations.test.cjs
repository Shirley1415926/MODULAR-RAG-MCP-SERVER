const assert=require('node:assert/strict');
const {create,add}=require('../examples/pandion_demo/clinic_model.js');
const data=require('../examples/pandion_demo/synthetic_operations.json'),m=create(data);
const f={start:add(m.anchor,1),end:add(m.anchor,28),role:'All Roles',type:'all'};
const rows=m.capacity(f).followups.filter(r=>r.followup_due<m.anchor);
const result=m.followupOperations(rows);
assert.equal(result.total,130);
assert.equal(result.tied,true);
assert.deepEqual(result.drivers.map(d=>[d.key,d.count,d.share]),[['time_mismatch',26,20],['external_report',26,20]]);
assert.deepEqual(result.actions.slice(0,3).map(a=>a.key),['time_mismatch','active_need','external_report']);
const active=m.followupCases(rows).filter(c=>c.finding==='active_need').map(c=>c.source);
const onlyActive=m.followupOperations(rows.filter(r=>active.includes(r.appointment_id)));
assert.equal(onlyActive.drivers.length,0);
assert.equal(onlyActive.actions[0].key,'active_need');
assert.deepEqual(m.followupOperations([]),{total:0,drivers:[],actions:[],tied:false});
for(const role of ['Psychiatrist','Coaching']){
 const selected=rows.filter(r=>r.clinician_role===role),s=m.followupOperations(selected);
 assert.equal(s.total,selected.length);
 for(const d of s.drivers)assert.equal(d.share,100*d.count/selected.length);
}
console.log('PASS: operational shares, ties, action order, filtered cohorts and empty evidence.');
