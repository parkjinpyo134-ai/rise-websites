/* Integration of fresh notebook exports, the physical timeline and UI playback.
 * RISE_SIX_DESIGN_MANIFEST may point to another six-export verification run. */
'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto'), vm=require('node:vm');
const M=require('./model.js'), Playback=require('./ui/playback.js');
const TopDownMotion=require('./ui/top-down-motion.js');
const ROOT=path.resolve(__dirname,'..');
const manifestPath=process.env.RISE_SIX_DESIGN_MANIFEST || path.join(ROOT,'tmp/simulator_six_design_manifest.json');
const manifest=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,'utf8')):null;
const exportsList=manifest?.areas.flatMap(area=>area.exports.map(item=>({area:area.target_area_cm2,...item}))) || [];
const report={status:'PENDING',manifest:manifestPath,hardware_accessed:false,designs:[],playback_checks:[]};
const near=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
const readJob=item=>JSON.parse(fs.readFileSync(item.paths.simulation_json,'utf8'));
const importJob=job=>M.createPlan({layout:M.parseInput(JSON.stringify(job)),homeX:[200,200,200,200],enabledHeads:[4]});

function scheduler(onChange=()=>{}) {
  let now=0,next=1;const queue=new Map(),events=[];
  const requestFrame=callback=>{const id=next++;queue.set(id,callback);return id;};
  const cancelFrame=id=>queue.delete(id);
  const playback=Playback.create({onChange:s=>{events.push({...s});onChange(s);},requestFrame,cancelFrame});
  function advance(ms=100) {
    now+=ms;
    const work=[...queue.values()];queue.clear();
    work.forEach(callback=>callback(now));
    assert.ok(queue.size<=1,'Playback schedules at most one frame');
  }
  function finish(maximum=100000) {
    let frames=0;
    while(playback.snapshot().playing && frames++<maximum) advance();
    assert.equal(playback.snapshot().playing,false,'Playback reaches a bounded end');
    assert.equal(queue.size,0,'Completed playback leaves no animation loop');
  }
  return {playback,advance,finish,queue,events,requestFrame,cancelFrame};
}

if (!manifest) test('fresh notebook six-export verification',{skip:'Run the notebook six-export runner to create its manifest.'},()=>{});
else {
  test('verification set contains two freshly optimized designs at each requested area',()=>{
    assert.equal(manifest.status,'PASS');assert.equal(manifest.population,500);assert.equal(manifest.generations,200);
    assert.equal(exportsList.length,6);
    assert.deepEqual(manifest.areas.map(a=>a.target_area_cm2).sort((a,b)=>a-b),[10000,20000,30000]);
    manifest.areas.forEach(a=>{assert.equal(a.exports.length,2);assert.equal(a.fresh_optimization,true);assert.equal(a.actual_evaluations,100000);});
  });
  for (const item of exportsList) test(`A${item.area} design ${item.current_design_id}: exact Python pulses and complete production`,()=>{
    const file=fs.readFileSync(item.paths.simulation_json),job=readJob(item),plan=importJob(job);
    assert.equal(crypto.createHash('sha256').update(file).digest('hex'),item.sha256.simulation_json);
    assert.equal(M.usesCurrentCalibration(plan),true);assert.equal(M.assessReachability(plan).feasible,true);
    assert.deepEqual(plan.passes,job.motor_plan.passes);assert.deepEqual(plan.operations,job.motor_plan.operations);
    assert.equal(plan.passes.length,item.pass_count);
    assert.deepEqual(plan.passes.map(p=>[0,2,1,3].map(i=>-p.motorMoves[i].targetPulse || 0)),item.high_targets_motor4_order);
    assert.deepEqual(plan.passes.map(p=>p.rotaryMotor.targetPulse),item.rotary_target_pulses);
    let pulseChecks=0,unusedChecks=0,zeroAngleChecks=0,continuityChecks=0,samples=0;
    for (const [index,pass] of plan.passes.entries()) {
      const state=M.sample(plan,pass.positionEnd),operations=plan.operations.filter(o=>o.passIndex===index);
      assert.deepEqual(operations.slice(-2).map(o=>o.kind),['x_home_seek','x_home_reference']);
      const needsRotationHome=index===0 || Math.abs(pass.rotation-plan.passes[index-1].rotation)>1e-6;
      assert.equal(pass.rotaryHomedBeforeMove,needsRotationHome);
      if (needsRotationHome && index>0) assert.deepEqual(operations.slice(0,2).map(o=>o.kind),['slab_home_seek','slab_home_reference']);
      if (!needsRotationHome) assert.equal(pass.rotaryMotor.pulses,0);
      assert.equal(state.rotaryPulse,job.motor_plan.passes[index].rotaryMotor.targetPulse);
      for (const [i,move] of pass.motorMoves.entries()) {
        assert.equal(move.fromPulse,0);assert.equal(move.pulses,move.targetPulse);
        assert.equal(state.heads[i].motor.positionPulse,job.motor_plan.passes[index].motorMoves[i].targetPulse);
        assert.equal(state.heads[i].motor.remainingPulses,0);
        near(state.heads[i].x,plan.homeX[i]+move.targetPulse/plan.drive.pulsesPerMm);
        pulseChecks++;
        if (!move.lineId) {assert.equal(move.targetPulse,0);near(state.heads[i].x,plan.homeX[i]);unusedChecks++;}
      }
      const returned=M.sample(plan,pass.end);
      returned.heads.forEach((head,i)=>{near(head.x,plan.homeX[i]);assert.equal(head.motor.positionPulse,0);});
      if (pass.rotaryMotor.zeroAngleHalfTurn) {
        assert.equal(pass.rotaryMotor.targetPulse,1220);assert.equal(pass.displayRotation,0);near(pass.rotation,180);zeroAngleChecks++;
      }
    }
    let previous=null,completed=0;
    for (const op of plan.operations) {
      if (previous) {
        near(previous.end,op.start);near(previous.toY,op.fromY);near(previous.toAngle,op.fromAngle);
        previous.toX.forEach((x,i)=>near(x,op.fromX[i]));continuityChecks++;
      }
      for (const fraction of [0,.25,.5,.75,1-1e-8]) {
        const state=M.sample(plan,op.start+op.duration*fraction);samples++;
        assert.ok(state.completedLines>=completed);completed=state.completedLines;
        assert.ok(Number.isSafeInteger(state.rotaryPulse));
        state.heads.forEach((head,i)=>{
          near(head.y,state.y);
          if (state.initialized) {
            assert.ok(Number.isSafeInteger(head.motor.positionPulse));
            near(head.x,plan.homeX[i]+head.motor.positionPulse/plan.drive.pulsesPerMm);
            if (!head.cutId) {near(head.x,plan.homeX[i]);assert.equal(head.motor.positionPulse,0);assert.equal(head.active,false);}
          }
          if (head.active) assert.equal(op.kind,'cut');
        });
      }
      previous=op;
    }
    const clock=scheduler();clock.playback.setPlan(plan);clock.playback.speed(8);clock.playback.full();clock.finish();
    near(clock.playback.snapshot().elapsed,plan.duration);
    const end=M.sample(plan,clock.playback.snapshot().elapsed),exported=M.report(plan,end);
    assert.equal(end.complete,true);assert.equal(end.completedPasses,plan.passes.length);assert.equal(end.completedLines,plan.cuts.length);
    end.heads.forEach((head,i)=>{near(head.x,plan.homeX[i]);assert.equal(head.motor.positionPulse,0);assert.equal(head.limitActive,true);assert.equal(head.active,false);});
    assert.equal(exported.complete,true);assert.equal(exported.completed_lines,plan.cuts.length);
    assert.deepEqual(exported.motor_program.map(x=>x.targetPulse),job.motor_plan.passes.flatMap(p=>p.motorMoves.map(m=>m.targetPulse)));
    assert.ok(exported.current_motor_state.every(h=>h.positionPulse===0));
    report.designs.push({area_cm2:item.area,design_id:item.current_design_id,status:'PASS',shape:item.shape,
      simulation_json:item.paths.simulation_json,sha256:item.sha256.simulation_json,passes:plan.passes.length,
      active_lines:plan.cuts.length,skipped_lines:plan.skippedLines.length,pulse_checks:pulseChecks,
      unused_checks:unusedChecks,zero_angle_checks:zeroAngleChecks,continuity_checks:continuityChecks,
      sampled_states:samples,simulated_duration_s:plan.duration,final_x_pulses:end.heads.map(h=>h.motor.positionPulse),
      high_targets_motor4_order:item.high_targets_motor4_order,rotary_target_pulses:item.rotary_target_pulses});
  });
}

const flowPlan=()=>exportsList.length?importJob(readJob(exportsList.find(x=>x.pass_count>=3))):M.createPlan({w:60,h:20,theta:90});
function controlTest(name,body) {test(name,()=>{body();report.playback_checks.push({name,status:'PASS'});});}

controlTest('whole production pauses, resumes, resets and restarts without duplicate frames',()=>{
  const c=scheduler(),p=flowPlan();c.playback.setPlan(p);c.playback.full();
  for(let i=0;i<30;i++)c.advance();
  const before=c.playback.snapshot().elapsed;assert.ok(before>0);
  c.playback.full();assert.equal(c.playback.snapshot().playing,false);assert.equal(c.queue.size,0);
  c.advance(60000);near(c.playback.snapshot().elapsed,before);
  c.playback.full();c.advance(60000);near(c.playback.snapshot().elapsed,before);
  c.advance();near(c.playback.snapshot().elapsed,before+.1);
  c.playback.reset();assert.equal(c.playback.snapshot().elapsed,0);assert.equal(c.queue.size,0);
  c.playback.speed(8);c.playback.full();c.finish();near(c.playback.snapshot().elapsed,p.duration);
  c.playback.full();assert.equal(c.playback.snapshot().elapsed,0);assert.equal(c.playback.snapshot().playing,true);c.playback.pause();
});

controlTest('selected pass from cold start initializes first and stops at that pass home return',()=>{
  const p=flowPlan(),c=scheduler(),index=2;c.playback.setPlan(p);c.playback.select(index);c.playback.speed(8);c.playback.pass();c.finish();
  near(c.playback.snapshot().elapsed,p.passes[index].end);assert.equal(c.playback.snapshot().selected,index);
  assert.ok(c.events.some(e=>e.playing&&e.elapsed>0&&e.elapsed<p.initializationEnd));
  assert.ok(c.events.some(e=>e.elapsed===p.passes[index].start));
  assert.ok(c.events.every(e=>e.elapsed<=p.initializationEnd || e.elapsed>=p.passes[index].start));
  const end=M.sample(p,c.playback.snapshot().elapsed);end.heads.forEach(h=>assert.equal(h.motor.positionPulse,0));
});

controlTest('Initialize stops at reference zero; full production and seeking keep deliberate boundaries',()=>{
  const p=flowPlan(),c=scheduler();c.playback.setPlan(p);c.playback.speed(4);c.playback.initialize();c.finish();
  near(c.playback.snapshot().elapsed,p.initializationEnd);
  const ready=M.sample(p,p.initializationEnd);assert.equal(ready.rotaryPulse,0);ready.heads.forEach(h=>assert.equal(h.motor.positionPulse,0));
  c.playback.full();assert.equal(c.playback.snapshot().elapsed,0);c.playback.pause();
  c.playback.seek(-100);near(c.playback.snapshot().elapsed,p.initializationEnd);
  c.playback.seek(p.duration+100);near(c.playback.snapshot().elapsed,p.duration);
  c.playback.full();assert.equal(c.playback.snapshot().elapsed,0);c.playback.pause();
});

controlTest('app visibilitychange pauses playback and returning to the tab never resumes silently',()=>{
  const nodes=new Map(),listeners=new Map();let appPlayback,clock;
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:0,checked:true,hidden:false,listeners:new Map(),addEventListener(name,fn){this.listeners.set(name,fn);},showModal(){},close(){}});return nodes.get(id);};
  const document={hidden:false,getElementById:node,querySelectorAll:()=>[],addEventListener:(name,fn)=>listeners.set(name,fn)};
  const context={document,FactorySimulation:M,RiseTopDownMotion:TopDownMotion,setTimeout:()=>1,clearTimeout:()=>{},
    RiseMotorMonitor:{mount(){},render(){}},RiseMachineView:{render(){}},RisePlanPanel:{render(){}},RiseFileActions:{connect(){}},
    RisePlayback:{create({onChange}){clock=scheduler(onChange);appPlayback=clock.playback;return appPlayback;}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'simulator.js'),'utf8'),context,{filename:'simulator.js'});
  nodes.get('play').listeners.get('click')();for(let i=0;i<12;i++)clock.advance();
  const before=appPlayback.snapshot().elapsed;assert.ok(before>0);
  document.hidden=true;listeners.get('visibilitychange')();assert.equal(appPlayback.snapshot().playing,false);assert.equal(clock.queue.size,0);
  clock.advance(60000);near(appPlayback.snapshot().elapsed,before);
  document.hidden=false;listeners.get('visibilitychange')();assert.equal(appPlayback.snapshot().playing,false);
  nodes.get('play').listeners.get('click')();clock.advance();near(appPlayback.snapshot().elapsed,before);clock.advance();assert.ok(appPlayback.snapshot().elapsed>before);appPlayback.pause();
});

// Run the actual app controller, plan panel and motor panel with a minimal DOM.
// The real renderer is deliberately observed through its presentation contract;
// pixel rendering is exercised in the separate browser verification.
function appHarness() {
  const nodes=new Map(),listeners=new Map();let clock,files,rendered;
  function element(tag='div') {
    const classes=new Set(),attrs=new Map();
    return {tag,children:[],value:0,checked:true,hidden:false,disabled:false,textContent:'',style:{},listeners:new Map(),
      appendChild(child){this.children.push(child);return child;},append(...children){this.children.push(...children);},
      replaceChildren(...children){this.children=[...children];},get firstChild(){return this.children[0];},
      setAttribute(name,value){attrs.set(name,value);},getAttribute(name){return attrs.get(name);},
      classList:{toggle(name,enabled){if(enabled)classes.add(name);else classes.delete(name);},contains:name=>classes.has(name)},
      addEventListener(name,fn){this.listeners.set(name,fn);},showModal(){this.open=true;},close(){this.open=false;}};
  }
  function node(id) {
    if (!nodes.has(id)) {const e=element();e.value=({feed:20,order:'horizontal-first','unit-w':60,'unit-h':60,angle:90})[id]??0;nodes.set(id,e);}
    return nodes.get(id);
  }
  const document={hidden:false,getElementById:node,createElement:element,
    querySelectorAll:selector=>selector==='#steps li'?node('steps').children:[],addEventListener:(name,fn)=>listeners.set(name,fn)};
  const context={document,FactorySimulation:M,RiseTopDownMotion:TopDownMotion,setTimeout:()=>1,clearTimeout(){},
    RiseMachineView:{render(value){rendered=value;}},RiseFileActions:{connect(value){files=value;}},
    RisePlayback:{create({onChange}){clock=scheduler(onChange);return clock.playback;}}};
  vm.createContext(context);
  for (const file of ['ui/motor-monitor.js','ui/plan-panel.js','simulator.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),context,{filename:file});
  }
  return {node,get clock(){return clock;},get files(){return files;},get rendered(){return rendered;},
    click(id){if(!node(id).disabled)node(id).listeners.get('click')({preventDefault(){}});},
    apply(){node('settings').listeners.get('submit')({preventDefault(){}});},
    load(text){files.load(M.parseInput(text));}};
}

controlTest('legacy JSON to coordinate CSV and Apply keeps current scale and synchronized home inputs',()=>{
  const a=appHarness();a.load(fs.readFileSync(path.join(__dirname,'examples/selected_design_001_simulation.json'),'utf8'));
  assert.equal(M.usesCurrentCalibration(a.files.getPlan()),false);
  a.load('line_id,x_start_mm,y_start_mm,x_end_mm,y_end_mm\nL1,60,0,60,60');
  assert.equal(M.usesCurrentCalibration(a.files.getPlan()),true);
  for (let i=0;i<4;i++) {near(Number(a.node(`home-${i+1}`).value),M.HOME_X[i]);assert.equal(a.node(`home-${i+1}`).disabled,false);}
  const pulses=a.files.getPlan().passes.map(p=>p.motorMoves.map(m=>m.targetPulse));
  a.apply();assert.equal(M.usesCurrentCalibration(a.files.getPlan()),true);
  assert.deepEqual(a.files.getPlan().passes.map(p=>p.motorMoves.map(m=>m.targetPulse)),pulses);
  assert.equal(a.node('plan-error').hidden,true);
});

controlTest('selected third pass ends with its own title, lines and zero live motor targets',()=>{
  const a=appHarness(),p=flowPlan();
  const source=exportsList.find(item=>item.pass_count>=3);
  if(source)a.load(fs.readFileSync(source.paths.simulation_json,'utf8'));
  else a.files.load(p.layout);
  a.clock.playback.speed(8);a.click('next');a.click('next');a.click('play-pass');a.clock.finish();
  assert.equal(a.node('phase-label').textContent,'3차 왕복 완료 · X 원점 복귀 완료');
  assert.equal(a.node('view-status').textContent,'3차 왕복 완료');
  assert.equal(a.node('motor-title').textContent,'모터 펄스 · 3차 왕복');
  assert.equal(a.rendered.state.passIndex,2);
  const pass=a.files.getPlan().passes[2];
  a.node('motor-rows').children.forEach((row,i)=>{
    assert.equal(row.children[1].textContent,pass.motorMoves[i].lineId||'대기');
    for(const col of [2,3,4]) assert.equal(row.children[col].textContent,'0');
    assert.equal(row.children[5].textContent,Math.abs(pass.motorMoves[i].targetPulse).toLocaleString('ko-KR'));
    assert.equal(row.children[7].textContent,'원점 대기');
  });
});

controlTest('out-of-origin coordinates disable playback and motor CSV export; valid input restores them',()=>{
  const a=appHarness();a.load('line_id,x_start_mm,y_start_mm,x_end_mm,y_end_mm\nOUT,1.1,0,1.1,60');
  assert.equal(M.assessReachability(a.files.getPlan()).feasible,false);
  assert.equal(a.node('plan-error').hidden,false);
  for(const id of ['play','play-pass','motor-export'])assert.equal(a.node(id).disabled,true);
  a.click('play');assert.equal(a.clock.playback.snapshot().playing,false);
  a.load('line_id,x_start_mm,y_start_mm,x_end_mm,y_end_mm\nIN,60,0,60,60');
  for(const id of ['play','play-pass','motor-export'])assert.equal(a.node(id).disabled,false);
  assert.equal(a.node('plan-error').hidden,true);
  a.clock.playback.seek(a.files.getPlan().initializationEnd);
  // During slab rotation the X operation target is zero even though this pass
  // has a nonzero eventual drawing command.
  assert.equal(a.node('motor-rows').children[0].children[3].textContent,'0');
  assert.notEqual(a.node('motor-rows').children[0].children[5].textContent,'0');
});

test.after(()=>{
  report.status=report.designs.length===6 && report.playback_checks.length===7?'PASS':'INCOMPLETE';
  report.total_designs=report.designs.length;report.completed_at=new Date().toISOString();
  if (manifest) fs.writeFileSync(path.join(ROOT,'tmp/simulator_six_design_playback_report.json'),JSON.stringify(report,null,2));
});
