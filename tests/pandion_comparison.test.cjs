const assert=require('node:assert/strict');
const data=require('../examples/pandion_demo/synthetic_operations.json');
const {create}=require('../examples/pandion_demo/clinic_model.js');
const m=create(data);
for(const days of [7,30,90])for(const clinician of ['all','CLN-001','missing'])for(const kind of ['cancelled','no_show']){
  const f={...m.range(days),clinician},c=m.reasonComparison(f,kind);
  assert.equal(c.breakdown.reduce((n,r)=>n+r.current,0),c.currentCount);
  assert.equal(c.breakdown.reduce((n,r)=>n+r.previous,0),c.previousCount);
  assert.equal(c.breakdown.reduce((n,r)=>n+r.change,0),c.currentCount-c.previousCount);
  assert.equal(c.previous.end,m.range(days,true).end);
  if(c.currentTotal&&c.previousTotal)assert.ok(Math.abs(c.breakdown.reduce((n,r)=>n+r.rateChange,0)-(c.currentRate-c.previousRate))<1e-9);
  else assert.equal(c.currentRate,null);
}
const c=m.reasonComparison(m.range(7),'cancelled');
assert.equal(c.currentCount,43);assert.equal(c.previousCount,29);
assert.equal(c.breakdown[0].label,'Unknown');assert.equal(c.breakdown[0].change,7);
assert.equal(c.breakdown.find(r=>r.label==='Emergency / Unforeseen Obligations').change,-2);
console.log('PASS: complete reason counts, contribution sums, equal periods, empty cohorts and known cancellation case.');
