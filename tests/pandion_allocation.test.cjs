const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {create,add}=require('../examples/pandion_demo/clinic_model.js');
const data=require('../examples/pandion_demo/synthetic_operations.json'),m=create(data);
for(const days of [14,28,56])for(const role of ['All Roles','Psychiatrist','Coaching']){
 const f={start:add(m.anchor,1),end:add(m.anchor,days),role,type:'all'};
 for(const item of m.priorities('allocation',f)){
  const details=m.allocationDetails(item.records,f);
  const result=JSON.parse(execFileSync('.venv/bin/python',['-c',`import json,sys
from src.pandion_demo.clinic_dataset import build_clinic_dataset
from src.pandion_demo.allocation_analysis import allocation_context
p=json.load(sys.stdin)
print(json.dumps(allocation_context(build_clinic_dataset(),p['records'],p['filters'])))`],{input:JSON.stringify({records:item.records,filters:f}),encoding:'utf8'}));
  assert.deepEqual(details.map(r=>[r.blocker,r.bucket,r.matchedSlots,r.next?.slot_id||null]),result.records.map(r=>[r.blocker,r.age_bucket,r.matching_slots,r.earliest_slot]));
  assert.deepEqual(m.allocationInvestigation(item.records,f),result.investigation);
  assert.deepEqual(m.followupCases(item.records),result.workflow_cases);
 }
}
console.log('PASS: frontend/backend allocation diagnostics agree across roles and windows.');
