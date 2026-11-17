const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {motorMove,createPlan,sample,parseInput,motorCSV,report,HOME_X,MEASURED_DRIVE,ROTARY_DRIVE} = require('./model.js');
test('centre-priority X calibration reproduces centre, all four endpoints and measured offsets',()=>{
  assert.equal(MEASURED_DRIVE.calibration,'center-priority-2026-11-02');
  assert.equal(MEASURED_DRIVE.pulsesPerMm,(96500-36424)/150);
  assert.equal(motorMove(HOME_X[0],0,HOME_X[0]).pulses,-36424);
  for(const [head,pulses] of [96500,98100,114300,114300].entries()) {
    assert.equal(motorMove(HOME_X[head],-150,HOME_X[head]).pulses,-pulses);
  }
  assert.ok(Math.abs((HOME_X[1]-HOME_X[0])*MEASURED_DRIVE.pulsesPerMm-1600)<1e-8);
  assert.ok(Math.abs((HOME_X[2]-HOME_X[1])*MEASURED_DRIVE.pulsesPerMm-16200)<1e-8);
  assert.equal(ROTARY_DRIVE.calibration,'measured-2026-10-19');
  const nominal={lead:4,pulsesPerRev:1600};
  assert.equal(motorMove(0,40,0,nominal).pulses,16000);
  assert.equal(motorMove(0,-.00125,0,nominal).pulses,-1);
});
test('successive passes start from X home after each return',()=>{
  const p=createPlan();const a=p.passes[0].motorMoves[0],b=p.passes[1].motorMoves[0];
  assert.equal(a.pulses,-40429);assert.equal(b.pulses,-84485);
  assert.equal(b.turns,b.targetTurns);
  for(let i=0;i<4;i++) {for(const pass of p.passes){const m=pass.motorMoves[i];assert.equal(m.fromPulse,0);assert.equal(m.pulses,m.targetPulse);}}
});
test('pulse quantization, remaining turns, unused motors and calibration',()=>{
  const p=createPlan({w:37.125,h:17.75,theta:43.123,enabledHeads:[1,3]});
  for(const pass of p.passes){
    const s=sample(p,pass.positionEnd);
    pass.motorMoves.forEach((m,i)=>{assert.ok(Math.abs(m.errorMm)<=(m.releaseAdjusted?400:.5)/MEASURED_DRIVE.pulsesPerMm+1e-8);assert.ok(Number.isInteger(m.pulses));assert.equal(s.heads[i].motor.remainingPulses,0);});
    for(const i of [1,3])assert.equal(pass.motorMoves[i].pulses,0);
  }
  const shifted=[...HOME_X]; shifted[0]+=1600/MEASURED_DRIVE.pulsesPerMm;
  assert.equal(createPlan({homeX:shifted}).passes[0].motorMoves[0].pulses,createPlan().passes[0].motorMoves[0].pulses-1600);
  assert.equal(sample(p,0).heads[0].motor,null);
  assert.equal(report(p,sample(p,p.duration)).drive.y_motor_calculated,false);
  assert.ok(motorCSV(p).includes('signed_pulses'));
});
test('Colab coordinate input preserves ideal lines and reports pulse-based paths',()=>{
  const job=JSON.parse(fs.readFileSync('prototype/examples/selected_design_001_simulation.json','utf8'));
  job.schema='kaistone.cut-job.v1'; // Regression: legacy coordinate-only import.
  const layout=parseInput(JSON.stringify(job));const p=createPlan({layout});
  assert.equal(layout.exactCoordinates,true);assert.equal(layout.designId,1);
  assert.equal(p.cuts.length,job.cut_lines.length);
  for(const line of job.cut_lines){const source=p.layout.lines.find(c=>c.id===line.line_id);assert.deepEqual(source.a,{x:line.x_start_mm,y:line.y_start_mm});const cut=p.cuts.find(c=>c.id===line.line_id),pass=p.passes[cut.passIndex],move=pass.motorMoves[cut.head-1];assert.ok(Math.abs(cut.x-(HOME_X[cut.head-1]+move.targetPulse/MEASURED_DRIVE.pulsesPerMm))<1e-8);}
  const sparse={...job,cut_lines:job.cut_lines.slice(0,1)};
  assert.equal(createPlan({layout:parseInput(JSON.stringify(sparse))}).cuts.length,1);
  assert.throws(()=>parseInput(JSON.stringify({...job,slab:{width_mm:400,height_mm:60}})));
  assert.throws(()=>parseInput('design_id,line_id,x_start_mm,y_start_mm,x_end_mm,y_end_mm\n1,A,0,20,300,20\n2,B,0,40,300,40'));
});
test('minimum release clamps 1..399 signed X pulses while retaining zero and unused heads',()=>{
  for(const requested of [-401,-400,-399,-1,0,1,399,400,401]){
    const v=motorMove(0,requested/MEASURED_DRIVE.pulsesPerMm,0);
    assert.equal(v.requestedPulse,requested);
    assert.equal(v.targetPulse,requested===0?0:Math.sign(requested)*Math.max(400,Math.abs(requested)));
    assert.equal(v.releaseAdjusted,requested!==0 && Math.abs(requested)<400);
  }
  const home=HOME_X[0],target=home-1/MEASURED_DRIVE.pulsesPerMm;
  // A vertical cut is physically rotated 180 degrees, so its machine X is negated.
  const p=createPlan({enabledHeads:[1],layout:{lines:[{id:'tiny',a:{x:150-target,y:0},b:{x:150-target,y:60}}]}});
  const pass=p.passes[0],s=sample(p,pass.positionEnd);
  assert.equal(pass.motorMoves[0].targetPulse,-400);assert.equal(s.heads[0].limitActive,false);
  for(const i of [1,2,3]){assert.equal(pass.motorMoves[i].targetPulse,0);assert.equal(s.heads[i].limitActive,true);}
  assert.equal(p.cuts[0].x,home-400/MEASURED_DRIVE.pulsesPerMm);
});
test('rotary minimum command sets the actual angle and does not add repeated departure pulses',()=>{
  const theta=89.5,q=1/Math.tan(theta*Math.PI/180);
  const lines=[10,30,50,70,90].map((x,i)=>({id:`T${i}`,a:{x,y:0},b:{x:x+60*q,y:60}}));
  const p=createPlan({layout:{lines}}),a=p.passes[0],b=p.passes[1];
  assert.equal(a.rotaryMotor.requestedPulse,3);assert.equal(a.rotaryMotor.targetPulse,10);
  assert.equal(a.rotation,10*ROTARY_DRIVE.anglePerPulse);assert.equal(b.rotaryMotor.pulses,0);
  assert.equal(createPlan().passes[0].rotaryMotor.targetPulse,610);
});
test('zero layout angle is a physical half turn, including a first pass after Initialize',()=>{
  const p=createPlan({order:'slanted-first'}),first=p.passes[0];
  assert.equal(p.rotaryZeroPolicy,'half-turn-for-zero-layout-angle');
  assert.equal(first.displayRotation,0);assert.equal(first.rotation,180);
  assert.equal(first.rotaryMotor.requestedLayoutAngleDeg,0);
  assert.equal(first.rotaryMotor.targetLayoutAngleDeg,0);
  assert.equal(first.rotaryMotor.requestedAngleDeg,180);
  assert.equal(first.rotaryMotor.targetPulse,1220);assert.equal(first.rotaryMotor.pulses,1220);
  assert.equal(first.rotaryMotor.zeroAngleHalfTurn,true);
  const rotate=p.operations.find(o=>o.passIndex===0 && o.kind==='rotate');
  assert.equal(rotate.fromAngle,0);assert.equal(rotate.toAngle,180);
  for(const pass of p.passes.slice(1,3)){assert.equal(pass.rotaryMotor.targetPulse,1220);assert.equal(pass.rotaryMotor.pulses,0);}
  const horizontal=p.passes.at(-1);
  assert.equal(horizontal.displayRotation,90);assert.equal(horizontal.rotation,90);
  assert.equal(horizontal.rotaryMotor.targetPulse,610);assert.equal(horizontal.rotaryMotor.fromPulse,0);
  assert.deepEqual(p.operations.filter(o=>o.passIndex===horizontal.index).slice(0,2).map(o=>o.kind),['slab_home_seek','slab_home_reference']);
  for(const cut of p.cuts.filter(c=>c.rotation===180)){
    const source=p.layout.lines.find(l=>l.id===cut.id);
    const move=p.passes[cut.passIndex].motorMoves[cut.head-1];
    assert.ok(Math.abs(cut.x-(150-source.a.x))<=Math.abs(move.errorMm)+1e-8);
  }
});
