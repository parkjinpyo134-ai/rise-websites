/* Screen-down Y policy: full real six-export replay without changing Python
 * commands, slab rotation, geometry, durations or source plan/state objects. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const M=require('./model.js'),TopDown=require('./ui/top-down-motion.js');
const ROOT=path.resolve(__dirname,'..');
const manifestPath=process.env.RISE_SIX_DESIGN_MANIFEST || path.join(ROOT,'tmp/simulator_six_design_manifest.json');
const manifest=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,'utf8')):null;
const items=manifest?.areas.flatMap(a=>a.exports.map(e=>({area:a.target_area_cm2,...e}))) || [];
const report={status:'PENDING',direction:'top-to-bottom-and-back',hardware_accessed:false,designs:[]};
const near=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
function freeze(value) {if(value && typeof value==='object' && !Object.isFrozen(value)){Object.freeze(value);Object.values(value).forEach(freeze);}return value;}
function pointNear(a,b,tolerance=1e-7){near(a.x,b.x,tolerance);near(a.y,b.y,tolerance);}
const renderer=vm.createContext({});
for (const file of ['machine-skin.js','slab-surface.js','machine-view.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname,'ui',file),'utf8'),renderer,{filename:file});
}
function attribute(markup,name) {
  const matched=markup.match(new RegExp(`\\b${name}="([^"]+)"`));
  assert.ok(matched,`${name} is rendered`);return Number(matched[1]);
}

if(!manifest)test('six fresh exports for top-down production',{skip:'Create simulator_six_design_manifest.json first.'},()=>{});
for(const item of items)test(`A${item.area} design ${item.current_design_id}: top-down strokes and exact displayed contact`,()=>{
  const job=JSON.parse(fs.readFileSync(item.paths.simulation_json,'utf8'));
  const plan=freeze(M.createPlan({layout:M.parseInput(JSON.stringify(job))}));
  const planBefore=JSON.stringify(plan);let sampleCount=0,contactChecks=0,continuityChecks=0;
  function sample(time) {
    // Always project a fresh physical sample. Re-projecting a projected state
    // would reverse its already-reversed trace endpoints a second time.
    const source=freeze(M.sample(plan,time)),before=JSON.stringify(source);
    const state=TopDown.project(plan,source);sampleCount++;
    assert.equal(JSON.stringify(source),before,'Projection leaves source state untouched');
    assert.equal(state.rotation,source.rotation);assert.equal(state.rotaryPulse,source.rotaryPulse);
    assert.equal(state.elapsed,source.elapsed);assert.equal(state.complete,source.complete);
    assert.equal(state.progress,source.progress);assert.equal(state.completedPasses,source.completedPasses);
    assert.deepEqual(state.heads.map(h=>h.motor),source.heads.map(h=>h.motor));
    state.heads.forEach((head,i)=>{
      assert.equal(head.x,source.heads[i].x);assert.equal(head.limitActive,source.heads[i].limitActive);
      assert.equal(head.referencedX,source.heads[i].referencedX);assert.equal(head.y,state.y);
    });
    const omitY=({fromY,toY,...rest})=>rest;
    assert.deepEqual(omitY(state.operation),omitY(source.operation));
    assert.equal(state.traversalDirection,'top-to-bottom-and-back');
    return state;
  }
  const initial=sample(0);
  assert.ok(initial.y < -Math.hypot(150,30),'Home is above the complete rotating slab envelope');
  near(initial.y,-M.HOME_Y);assert.ok(initial.heads.every(h=>!h.active));
  let lastOperation;
  for(const operation of plan.operations) {
    const state=sample((operation.start+operation.end)/2);
    assert.equal(state.operation.kind,operation.kind);
    if(lastOperation){near(lastOperation.toY,state.operation.fromY);continuityChecks++;}
    lastOperation=state.operation;
    if(operation.kind==='cut' || operation.kind==='return') {
      const values=Array.from({length:9},(_,i)=>sample(operation.start+operation.duration*i/8).y);
      for(let i=1;i<values.length;i++) {
        if(operation.kind==='cut')assert.ok(values[i]>values[i-1],'The drawing stroke goes down');
        else assert.ok(values[i]<values[i-1],'The lifted return goes up');
      }
      if(operation.kind==='return')near(values.at(-1),initial.y);
    }
    if(operation.kind!=='cut')assert.ok(state.heads.every(h=>!h.active));
  }
  for(const pass of plan.passes) {
    const cutOp=plan.operations.find(o=>o.passIndex===pass.index&&o.kind==='cut');
    const start=sample(cutOp.start),end=sample(cutOp.end);
    near(start.y,pass.endY);near(end.y,pass.startY);
    const cuts=plan.cuts.filter(c=>c.passIndex===pass.index);
    assert.ok(start.y<Math.min(...cuts.map(c=>c.low)));
    assert.ok(end.y>Math.max(...cuts.map(c=>c.high)));
    assert.equal(pass.rotaryMotor.targetPulse,job.motor_plan.passes[pass.index].rotaryMotor.targetPulse);
    assert.deepEqual(pass.motorMoves,job.motor_plan.passes[pass.index].motorMoves);
    for(const cut of cuts) {
      for(const fraction of [.2,.5,.8]) {
        const time=cut.cutStart+(cut.low+cut.length*fraction-pass.endY)/plan.feed;
        const state=sample(time),progress=state.cuts.find(c=>c.id===cut.id),head=state.heads[cut.head-1];
        assert.equal(state.operation.kind,'cut');assert.equal(head.active,true);assert.equal(head.state,'절단 중');
        near(progress.completedLength,cut.length*fraction);
        pointNear(progress.localStart,cut.localEnd);
        pointNear(progress.localEnd,cut.localStart);
        pointNear(M.rotate(progress.localEndDone.x,progress.localEndDone.y,state.rotation),{x:head.x,y:head.y});
        contactChecks++;
        if(fraction===.5) {
          const markup=renderer.RiseMachineView.markup({plan,state,uid:'top-down-check'}),view=renderer.RiseMachineView.view;
          const contact=markup.match(new RegExp(`<circle data-live-contact="${cut.head-1}"[^>]+>`))?.[0];
          const trace=markup.match(new RegExp(`<line [^>]*data-completed-cut="${cut.id}"[^>]*>`))?.[0];
          const pen=markup.match(new RegExp(`<g data-live-head="${cut.head-1}"[^>]+>`))?.[0];
          assert.ok(contact && trace && pen,'Live contact, completed trace and pen are rendered');
          assert.match(contact,/visibility="visible"/);
          const world=M.rotate(attribute(trace,'x2'),attribute(trace,'y2'),state.rotation);
          near(attribute(contact,'cx'),view.centerX+world.x*view.materialScale,2e-6);
          near(attribute(contact,'cy'),view.centerY+world.y*view.materialScale,2e-6);
          const pose=pen.match(/transform="translate\(([^ ]+) ([^)]+)\)"/);
          assert.ok(pose);near(Number(pose[1]),attribute(contact,'cx'),2e-6);
          near(Number(pose[2])+12*view.penScale,attribute(contact,'cy'),2e-6);
        }
      }
    }
  }
  const final=sample(plan.duration),originalFinal=M.sample(plan,plan.duration);
  assert.equal(final.complete,true);assert.equal(final.completedLines,plan.cuts.length);
  assert.equal(final.completedPasses,plan.passes.length);near(final.y,initial.y);
  assert.ok(final.heads.every(h=>h.motor.positionPulse===0 && !h.active && h.limitActive));
  final.cuts.forEach((cut,i)=>{
    const original=originalFinal.cuts[i];
    pointNear(cut.localStart,original.localEnd);pointNear(cut.localEnd,original.localStart);
    pointNear(cut.localEndDone,original.localStart);near(cut.completedLength,original.length);
    assert.equal(cut.x,original.x);assert.equal(cut.rotation,original.rotation);
  });
  assert.equal(JSON.stringify(plan),planBefore,'Neither Python plan nor original geometry changes');
  report.designs.push({area_cm2:item.area,design_id:item.current_design_id,status:'PASS',passes:plan.passes.length,
    active_lines:plan.cuts.length,sampled_states:sampleCount,partial_contact_checks:contactChecks,
    continuity_checks:continuityChecks,home_y:initial.y,final_y:final.y,
    final_x_pulses:final.heads.map(h=>h.motor.positionPulse),motor_and_rotary_commands_unchanged:true});
});

test.after(()=>{
  report.status=report.designs.length===6?'PASS':'INCOMPLETE';
  if(manifest)fs.writeFileSync(path.join(ROOT,'tmp/simulator_top_down_motion_report.json'),JSON.stringify(report,null,2));
});
