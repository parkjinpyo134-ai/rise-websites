const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const m=require('./model.js');
const fixture=()=>JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'examples/selected_design_001_simulation.json'),'utf8'));
test('all measured calibration revisions replay their saved pulses without substituting current defaults',()=>{
 for(const [calibration,ppm,gap] of [
  ['measured-2026-10-19',110200/270,11000],
  ['measured-2026-10-19-61rev',108600/270,11000],
  ['measured-2026-10-20-gap12000',109600/270,12000],
 ]) {
  const layout=m.generateLayout({w:60,h:60,theta:90});
  const saved=m.createPlan({layout,drive:{calibration,pulsesPerMm:ppm},homeX:[120-gap/ppm,120-gap/ppm,120,120]});
  saved.pythonMotorProgram=true;saved.homingPolicy='x-every-return-slab-before-angle-change';
  for(const op of saved.operations){
   if(op.kind.endsWith('home_seek'))Object.assign(op,{pulses:null,until:op.kind.startsWith('x_')?'x_limit_switches':'slab_zero_switch'});
   if(op.kind.endsWith('home_reference'))Object.assign(op,{resetPulse:0,requires:op.kind.startsWith('x_')?'x_limit_switches':'slab_zero_switch'});
  }
  const job={schema:'kaistone.motor-job.v2',coordinate_system:'slab-bottom-left-mm',slab:{width_mm:300,height_mm:60},design_id:1,
   cut_lines:layout.lines.map(l=>({line_id:l.id,x_start_mm:l.a.x,y_start_mm:l.a.y,x_end_mm:l.b.x,y_end_mm:l.b.y})),motor_plan:saved};
  const replay=m.createPlan({layout:m.parseInput(JSON.stringify(job)),drive:m.MEASURED_DRIVE,homeX:m.HOME_X});
  assert.deepEqual(replay.drive,saved.drive);assert.deepEqual(replay.homeX,saved.homeX);
  assert.deepEqual(replay.passes,saved.passes);assert.deepEqual(replay.operations,saved.operations);
  assert.equal(m.sample(replay,replay.duration).completedLines,4);
  const corrupt=structuredClone(job);corrupt.motor_plan.drive.pulsesPerMm+=1;
  assert.throws(()=>m.parseInput(JSON.stringify(corrupt)));
 }
});
test('Python motor job is replayed unchanged even with conflicting browser settings',()=>{
 const job=fixture(),p=m.createPlan({layout:m.parseInput(JSON.stringify(job)),enabledHeads:[4],homeX:[200,200,200,200],order:'slanted-first',edgeThreshold:1});
 assert.deepEqual(p.passes,job.motor_plan.passes);assert.deepEqual(p.operations,job.motor_plan.operations);
 assert.equal(job.motor_plan.edgeThreshold,0.1);assert.equal(p.edgeThreshold,0.1);
 const end=m.sample(p,p.duration);assert.equal(end.completedLines,p.cuts.length);
 for(const pass of p.passes){const s=m.sample(p,pass.positionEnd);pass.motorMoves.forEach((v,i)=>assert.equal(s.heads[i].motor.positionPulse,v.targetPulse));assert.equal(s.rotaryPulse,pass.rotaryMotor.targetPulse);}
 assert.ok(m.motorCSV(p).includes('ROTARY'));
});
test('Modified motor pulse/turn/timeline/coordinate plans are rejected',()=>{
 for(const change of [j=>j.motor_plan.passes[0].motorMoves[0].pulses++,j=>j.motor_plan.passes[0].rotaryMotor.pulses++,j=>j.motor_plan.operations[8].toX[0]++,j=>j.cut_lines.splice(0,1),j=>j.cut_lines[0].y_start_mm+=.01,j=>j.motor_plan.rotaryDrive.ratio=20]){
  const j=fixture();change(j);assert.throws(()=>m.parseInput(JSON.stringify(j)));
 }
});
test('coordinate input skips all four parallel boundaries inclusively at 1 mm, retaining just-inside and slanted lines',()=>{
 const csv='line_id,x_start_mm,y_start_mm,x_end_mm,y_end_mm\nBOTTOM,0,1,300,1\nTOP,0,59,300,59\nLEFT,1,0,1,60\nRIGHT,299,0,299,60\nIN_BOTTOM,0,1.00001,300,1.00001\nIN_TOP,0,58.99999,300,58.99999\nIN_LEFT,1.00001,0,1.00001,60\nIN_RIGHT,298.99999,0,298.99999,60\nD,0,0,300,0.09';
 const p=m.createPlan({layout:m.parseCSV(csv)});
 assert.equal(m.EDGE_THRESHOLD_MM,1);assert.equal(p.edgeThreshold,1);
 assert.deepEqual(p.skippedLines.map(l=>l.id),['BOTTOM','TOP','LEFT','RIGHT']);
 assert.deepEqual(p.cuts.map(l=>l.id).sort(),['D','IN_BOTTOM','IN_LEFT','IN_RIGHT','IN_TOP']);
 assert.ok(p.warnings.some(w=>w.includes('외곽 1 mm 이내')));
 const justOver=m.createPlan({layout:m.parseCSV('line_id,x_start_mm,y_start_mm,x_end_mm,y_end_mm\nI,0,1.000001,300,1.000001')});
 assert.equal(justOver.cuts.length,1);assert.equal(justOver.skippedLines.length,0);
 const empty=m.createPlan({layout:m.parseCSV('line_id,x_start_mm,y_start_mm,x_end_mm,y_end_mm\nE,0,59.9,300,59.9')});
 assert.equal(m.sample(empty,empty.duration).complete,true);assert.equal(empty.passes.length,0);
});

test('design 5 omits the upper 0.284634 mm border cut and keeps nine lines in three passes',()=>{
 const layout=m.generateLayout({w:36.729230190866176,h:29.857683175474662,theta:54.381562442136776});
 for(const line of layout.lines)for(const point of [line.a,line.b])for(const axis of ['x','y'])point[axis]=+point[axis].toFixed(6);
 const p=m.createPlan({layout});
 assert.deepEqual(p.skippedLines.map(l=>l.id),['H002']);
 assert.equal(p.skippedLines[0].a.y,59.715366);
 assert.equal(layout.lines.find(l=>l.id==='H001').a.y,29.857683);
 assert.deepEqual(p.passes.map(pass=>pass.cutIds.length),[1,4,4]);
 assert.deepEqual(p.passes[0].cutIds,['H001']);
 assert.equal(p.passes[0].heads[0].cutId,'H001');
 assert.ok(p.passes[0].motorMoves.slice(1).every(move=>move.targetPulse===0));
 const end=m.sample(p,p.duration);assert.equal(end.complete,true);assert.equal(end.completedLines,9);
 // Explicit old threshold retains both horizontal cuts; stored v2 plans use their own saved threshold.
 const old=m.createPlan({layout,edgeThreshold:0.1});
 assert.equal(old.cuts.length,10);assert.equal(old.skippedLines.length,0);
});

test('X rehomes after every return; changed slab angles home before moving',()=>{
 const p=m.createPlan({layout:m.parseInput(JSON.stringify(fixture()))});
 assert.equal(p.homingPolicy,'x-every-return-slab-before-angle-change');
 for(const pass of p.passes){
  const ops=p.operations.filter(o=>o.passIndex===pass.index);
  assert.deepEqual(ops.slice(-3).map(o=>o.kind),['return','x_home_seek','x_home_reference']);
  assert.deepEqual(ops.at(-1).toX,p.homeX);
  pass.motorMoves.forEach(v=>{assert.equal(v.fromPulse,0);assert.equal(v.pulses,v.targetPulse);});
  if(pass.rotaryHomedBeforeMove){
   assert.equal(pass.rotaryMotor.fromPulse,0);
   if(pass.index>0)assert.deepEqual(ops.slice(0,2).map(o=>o.kind),['slab_home_seek','slab_home_reference']);
  }else assert.equal(pass.rotaryMotor.pulses,0);
  for(const op of ops.filter(o=>o.kind.includes('_home_'))){
   const state=m.sample(p,(op.start+op.end)/2);
   assert.ok(state.heads.every(h=>!h.active));
   assert.equal(state.y,m.HOME_Y);
  }
 }
 for(const kind of ['x_home_seek','slab_home_seek']){
  const j=fixture();j.motor_plan.operations.find(o=>o.kind===kind).pulses=0;
  assert.throws(()=>m.parseInput(JSON.stringify(j)));
 }
});
