const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const html=fs.readFileSync('examples/pandion_demo/dashboard.html','utf8');
const app=fs.readFileSync('examples/pandion_demo/dashboard_app.js','utf8');
// Approved source: user's Dashboard V14.html, first stylesheet verbatim.
const css=html.match(/<style>([\s\S]*?)<\/style>/)[1];
assert.equal(crypto.createHash('sha256').update(css).digest('hex'),'7bae51544ffb51598b51cfa0ab5f346ff62db76f3f199a30fc3d01b87ed4eaa8');
assert.ok(!html.includes('!important'));
assert.ok(!html.includes('overviewBase=')); // No old hard-coded chart generator.
assert.ok(app.includes("pointStyle:'rectRounded'"));
assert.ok(app.includes("borderColor:i?'#9899da':'#ffb354'"));
assert.ok(app.includes("cutout:'62%'"));
assert.ok(app.includes('name-cell')&&app.includes('bar-cell'));
assert.ok(app.includes('Patient Feedback Scores'));
assert.ok(html.includes('#feedbackInsights .insight p{font-size:13px'));
assert.ok(html.includes('flex:0 0 29px'));
assert.ok(app.includes("headers[0].textContent='Clinician ID'"));
assert.ok(app.includes("headers[1].textContent='Clinician'"));
assert.ok(app.includes('buttons[0].remove()'));
const vm=require('node:vm');
const meter=app.match(/function scoreMeter\(score,label\)\{[\s\S]*?\n\}/)[0];
const context=vm.createContext({esc:s=>s});vm.runInContext(meter,context);
for(const [value,fills] of [[0,[0,0,0,0,0]],[3.5,[100,100,100,50,0]],[5,[100,100,100,100,100]],[null,[0,0,0,0,0]]]){
  const rendered=context.scoreMeter(value,'Test');
  assert.deepEqual([...rendered.matchAll(/width:([\d.]+)%/g)].map(m=>Number(m[1])),fills);
  if(value===null)assert.ok(rendered.includes('No responses'));
}
for(const id of ['appointmentChart','professionChart','patientTrend','cancelChart','noShowChart','reasonChart','aiDrawer','aiClose'])assert.ok(html.includes(`id="${id}"`));
console.log('PASS: V14 original stylesheet, chart markers/colors, donut ratio, table visuals and RAG DOM retained.');
