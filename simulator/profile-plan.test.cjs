const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {spawnSync}=require('node:child_process');
const m=require('./model.js');
const root=path.resolve(__dirname,'..');
const profile=JSON.parse(fs.readFileSync(path.join(root,'calibration_profiles/center_priority_v2.json'),'utf8'));
let savedJob;
function fixture() {
  if (!savedJob) {
    const python=process.env.RISE_PYTHON || path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
    const source=`
import json
from pathlib import Path
from colab.motor_program import build_motor_plan, default_motor_settings
from colab.manufacturing_constraints import rounded_cut_records
profile=json.loads(Path('calibration_profiles/center_priority_v2.json').read_text(encoding='utf-8'))
lines=rounded_cut_records(43.77314430241518,7.4879041351355475,33.3430387813675)
plan=build_motor_plan(lines,pulse_profile=profile,**default_motor_settings())
print(json.dumps(dict(schema='kaistone.motor-job.v2',coordinate_system='slab-bottom-left-mm',slab=dict(width_mm=300,height_mm=60),design_id=6,cut_lines=lines,motor_plan=plan)))
`;
    const run=spawnSync(python,['-c',source],{cwd:root,encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'},maxBuffer:4*1024*1024});
    assert.equal(run.status,0,run.stderr || String(run.error));
    savedJob=JSON.parse(run.stdout);
  }
  return structuredClone(savedJob);
}
function importJob(job) { return m.createPlan({layout:m.parseInput(JSON.stringify(job)),drive:m.MEASURED_DRIVE,homeX:m.HOME_X}); }

test('actual Python provisional profile plan replays every saved command and leaves unused heads at zero',()=>{
  const job=fixture(), p=importJob(job);
  assert.deepEqual(p.pulseProfile,profile);
  assert.deepEqual(p.passes,job.motor_plan.passes);
  assert.deepEqual(p.operations,job.motor_plan.operations);
  assert.deepEqual(p.constraintHomeX,profile.baseline.home_x);
  assert.equal(p.drive.pulsesPerMm,profile.pulses_per_mm);
  assert.equal(p.drive.pulsesPerMm,m.MEASURED_DRIVE.pulsesPerMm);
  let inactive=0;
  for (const pass of p.passes) {
    const state=m.sample(p,pass.positionEnd);
    assert.equal(state.rotaryPulse,pass.rotaryMotor.targetPulse);
    pass.motorMoves.forEach((move,i)=>{
      assert.equal(move.fromPulse,0);
      assert.equal(state.heads[i].motor.positionPulse,move.targetPulse);
      assert.equal(state.heads[i].motor.remainingPulses,0);
      assert.ok(Math.abs(state.heads[i].x-(p.homeX[i]+move.targetPulse/p.drive.pulsesPerMm))<1e-9);
      if (!move.lineId) { inactive++; assert.equal(move.targetPulse,0); assert.equal(state.heads[i].x,p.homeX[i]); }
    });
  }
  assert.ok(inactive>0);
  assert.equal(m.sample(p,p.duration).completedLines,p.cuts.length);
  assert.equal(m.MEASURED_DRIVE.calibration,'center-priority-2026-11-02');
  assert.equal(m.MEASURED_DRIVE.pulsesPerMm,(96500-36424)/150);
});

test('profile metadata, coefficients, calibration samples and pulse-plan tampering are rejected',()=>{
  const changes=[
    j=>delete j.motor_plan.pulseProfile,
    j=>j.motor_plan.pulseProfile.schema='unknown',
    j=>j.motor_plan.pulseProfile.id='unknown',
    j=>{j.motor_plan.pulseProfile.id=j.motor_plan.drive.calibration='unsafe id';},
    j=>{j.motor_plan.pulseProfile.id=j.motor_plan.drive.calibration='measured-2026-10-20-gap12000';},
    j=>j.motor_plan.pulseProfile.status='confirmed',
    j=>j.motor_plan.pulseProfile.model='unknown',
    j=>j.motor_plan.pulseProfile.coordinate_system='slab-bottom-left-mm',
    j=>j.motor_plan.pulseProfile.pulses_per_mm+=1,
    j=>j.motor_plan.pulseProfile.pulses_per_mm=null,
    j=>j.motor_plan.pulseProfile.baseline.pulses_per_mm+=1,
    j=>j.motor_plan.pulseProfile.baseline.home_x[0]+=1,
    j=>j.motor_plan.constraintHomeX[2]+=1,
    j=>j.motor_plan.pulseProfile.heads.reverse(),
    j=>j.motor_plan.pulseProfile.heads[0].effective_home_x_mm+=1,
    j=>j.motor_plan.pulseProfile.heads[0].offset_pulses_from_baseline+=1,
    j=>j.motor_plan.pulseProfile.heads[0].calibration_points.pop(),
    j=>j.motor_plan.pulseProfile.heads[0].calibration_points[1]=structuredClone(j.motor_plan.pulseProfile.heads[0].calibration_points[0]),
    j=>j.motor_plan.pulseProfile.heads[0].calibration_points[0].high_pulses++,
    j=>j.motor_plan.pulseProfile.reference_rotation_deg=null,
    j=>j.motor_plan.drive.calibration='measured-2026-10-20-gap12000',
    j=>j.motor_plan.drive.pulsesPerMm+=1,
    j=>j.motor_plan.homeX[0]+=1,
    j=>j.motor_plan.homeCalibration.referenceX[0]+=1,
    j=>j.motor_plan.homeCalibration.effectiveHomeX[0]+=1,
    j=>j.motor_plan.homeCalibration.penInsetMm[0]=-1,
    j=>j.motor_plan.passes[0].motorMoves[0].homeReferenceMm+=1,
    j=>j.motor_plan.passes[0].motorMoves[0].penHomeMm+=1,
    j=>j.motor_plan.passes[0].motorMoves[0].constraintHomeMm+=1,
    j=>j.motor_plan.passes[0].motorMoves[0].targetPulse++,
    j=>j.motor_plan.passes[0].rotaryMotor.targetPulse++,
  ];
  for (const change of changes) { const job=fixture(); change(job); assert.throws(()=>importJob(job)); }
});

// Build an internally coherent plan without the Python feasibility guard, so the
// browser must independently reject targets outside either origin constraint.
function unconstrainedJob(head,targetX) {
  const layout={lines:[{id:'boundary',a:{x:150-targetX,y:0},b:{x:150-targetX,y:60}}]};
  const p=m.createPlan({layout,enabledHeads:[head],homeX:profile.heads.map(h=>h.effective_home_x_mm),drive:{calibration:profile.id,pulsesPerMm:profile.pulses_per_mm}});
  Object.assign(p,{pythonMotorProgram:true,homingPolicy:'x-every-return-slab-before-angle-change',pulseProfile:structuredClone(profile),constraintHomeX:[...profile.baseline.home_x]});
  for (const op of p.operations) {
    if (op.kind.endsWith('home_seek')) Object.assign(op,{pulses:null,until:op.kind.startsWith('x_')?'x_limit_switches':'slab_zero_switch'});
    if (op.kind.endsWith('home_reference')) Object.assign(op,{resetPulse:0,requires:op.kind.startsWith('x_')?'x_limit_switches':'slab_zero_switch'});
  }
  return {schema:'kaistone.motor-job.v2',coordinate_system:'slab-bottom-left-mm',slab:{width_mm:300,height_mm:60},cut_lines:layout.lines.map(l=>({line_id:l.id,x_start_mm:l.a.x,y_start_mm:l.a.y,x_end_mm:l.b.x,y_end_mm:l.b.y})),motor_plan:p};
}

test('profile cannot bypass original reachability or hide an out-of-origin target by pulse rounding',()=>{
  assert.doesNotThrow(()=>importJob(unconstrainedJob(3,130)));
  assert.throws(()=>importJob(unconstrainedJob(3,m.HOME_X[2]+0.00001)));
  const fittedHome=profile.heads[0].effective_home_x_mm;
  assert.doesNotThrow(()=>importJob(unconstrainedJob(1,fittedHome-1)));
  const outside=unconstrainedJob(1,fittedHome+0.1/profile.pulses_per_mm);
  assert.equal(outside.motor_plan.passes[0].motorMoves[0].targetPulse,0);
  assert.throws(()=>importJob(outside));
  const reach=m.assessReachability(outside.motor_plan);
  assert.equal(reach.feasible,false);
  assert.equal(reach.violations[0].head,1);
  assert.ok(reach.violations[0].outsideMm>0);
});

test('archived provisional fit retains its own pulse scale, homes and targets',()=>{
  const legacy=JSON.parse(fs.readFileSync(path.join(root,'calibration_profiles/design005_provisional_v1.json'),'utf8'));
  const layout=m.generateLayout({w:60,h:60,theta:90});
  const p=m.createPlan({layout,homeX:legacy.heads.map(h=>h.effective_home_x_mm),
    drive:{calibration:legacy.id,pulsesPerMm:legacy.pulses_per_mm}});
  Object.assign(p,{pythonMotorProgram:true,homingPolicy:'x-every-return-slab-before-angle-change',
    pulseProfile:legacy,constraintHomeX:legacy.baseline.home_x});
  for (const op of p.operations) {
    if (op.kind.endsWith('home_seek')) Object.assign(op,{pulses:null,until:op.kind.startsWith('x_')?'x_limit_switches':'slab_zero_switch'});
    if (op.kind.endsWith('home_reference')) Object.assign(op,{resetPulse:0,requires:op.kind.startsWith('x_')?'x_limit_switches':'slab_zero_switch'});
  }
  const job={schema:'kaistone.motor-job.v2',coordinate_system:'slab-bottom-left-mm',slab:{width_mm:300,height_mm:60},
    cut_lines:layout.lines.map(l=>({line_id:l.id,x_start_mm:l.a.x,y_start_mm:l.a.y,x_end_mm:l.b.x,y_end_mm:l.b.y})),motor_plan:p};
  const imported=importJob(job);
  assert.deepEqual(imported.passes,p.passes);
  assert.deepEqual(imported.operations,p.operations);
  assert.equal(m.usesCurrentCalibration(imported),false);
  assert.equal(m.usesCurrentCalibration(importJob(fixture())),true);
});
