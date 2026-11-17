const test=require('node:test'), assert=require('node:assert/strict'), path=require('node:path');
const {spawnSync}=require('node:child_process');
const m=require('./model.js'), root=path.resolve(__dirname,'..');
let fixtures;
function jobs() {
  if (!fixtures) {
    const python=process.env.RISE_PYTHON || path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
    const source=`
import json
from pathlib import Path
from colab.bench_calibration import load_bench_references
from colab.motor_program import build_motor_plan
from colab.manufacturing_constraints import rounded_cut_records
profile=json.loads(Path('calibration_profiles/center_priority_v2.json').read_text(encoding='utf-8'))
jobs={}
for ref in load_bench_references(Path.cwd()):
    geometry=ref['design']
    base=build_motor_plan(ref['lines'],pulse_profile=profile)
    plan=build_motor_plan(ref['lines'],pulse_profile=profile,bench_reference=ref,
        design_geometry=geometry,slanted_high_correction_pulses=0)
    jobs[str(ref['sourceDesignId'])]=dict(schema='kaistone.motor-job.v2',
        coordinate_system='slab-bottom-left-mm',slab=dict(width_mm=300,height_mm=60),
        design_id=ref['sourceDesignId'],design=geometry,cut_lines=ref['lines'],motor_plan=plan,
        unadjusted_motor_plan=base)
geometry=dict(w_mm=43.77314430241518,h_mm=7.4879041351355475,theta_deg=33.3430387813675)
lines=rounded_cut_records(geometry['w_mm'],geometry['h_mm'],geometry['theta_deg'])
jobs['6']=dict(schema='kaistone.motor-job.v2',coordinate_system='slab-bottom-left-mm',
    slab=dict(width_mm=300,height_mm=60),design_id=6,design=geometry,cut_lines=lines,
    motor_plan=build_motor_plan(lines,pulse_profile=profile,design_geometry=geometry,
        slanted_high_correction_pulses=-2149))
geometry=dict(w_mm=28.69576312787865,h_mm=19.896893141477797,theta_deg=43.8977791356642)
lines=rounded_cut_records(geometry['w_mm'],geometry['h_mm'],geometry['theta_deg'])
jobs['41']=dict(schema='kaistone.motor-job.v2',coordinate_system='slab-bottom-left-mm',
    slab=dict(width_mm=300,height_mm=60),design_id=41,design=geometry,cut_lines=lines,
    motor_plan=build_motor_plan(lines,pulse_profile=profile,design_geometry=geometry))
geometry=dict(w_mm=60,h_mm=60,theta_deg=90)
lines=rounded_cut_records(60,60,90)
jobs['rectangle']=dict(schema='kaistone.motor-job.v2',coordinate_system='slab-bottom-left-mm',
    slab=dict(width_mm=300,height_mm=60),design_id=1,design=geometry,cut_lines=lines,
    motor_plan=build_motor_plan(lines))
print(json.dumps(jobs))
`;
    const run=spawnSync(python,['-c',source],{cwd:root,encoding:'utf8',
      env:{...process.env,PYTHONIOENCODING:'utf-8'},maxBuffer:8*1024*1024});
    assert.equal(run.status,0,run.stderr || String(run.error));
    fixtures=JSON.parse(run.stdout);
  }
  return structuredClone(fixtures);
}
function imported(job) { return m.createPlan({layout:m.parseInput(JSON.stringify(job))}); }
const expected={
  5:[[37567,0,0,0],[78295,70960,67928,58993],[30426,24291,20058,12324]],
  6:[[45401,57204,44003,54205],[33406,45208,32007,0],[66895,65423,58859,55786],[28350,26877,20313,17241]],
};

test('Python reference replays latest centre-priority design 5 commands and actual timeline',()=>{
  const fixture=jobs();
  for (const id of [5]) {
    const job=fixture[id], plan=imported(job);
    assert.deepEqual(plan.passes.map(pass=>[0,2,1,3].map(i=>-pass.motorMoves[i].targetPulse || 0)),expected[id]);
    assert.deepEqual(plan.operations,job.motor_plan.operations);
    for (const [index,pass] of plan.passes.entries()) {
      const state=m.sample(plan,pass.positionEnd), baseline=job.unadjusted_motor_plan.passes[index];
      assert.equal(state.rotaryPulse,pass.rotaryMotor.targetPulse);
      for (const [i,move] of pass.motorMoves.entries()) {
        assert.equal(move.targetMachineMm,baseline.motorMoves[i].targetMachineMm);
        assert.equal(move.targetMm,baseline.motorMoves[i].targetMm);
        assert.equal(move.computedTargetPulse,baseline.motorMoves[i].targetPulse);
        assert.equal(move.calibrationSource,'bench-reference');
        assert.equal(state.heads[i].motor.positionPulse,move.targetPulse);
        assert.equal(state.heads[i].motor.remainingPulses,0);
        assert.ok(Math.abs(state.heads[i].x-(plan.homeX[i]+move.targetPulse/plan.drive.pulsesPerMm))<1e-9);
        if (!move.lineId) assert.equal(move.targetPulse,0);
      }
    }
    const end=m.sample(plan,plan.duration);
    assert.equal(end.completedLines,plan.cuts.length);
    assert.deepEqual(m.report(plan,end).bench_reference,plan.benchReference);
    const csv=m.motorCSV(plan).trim().split(/\r?\n/);
    assert.ok(csv[0].includes('command_correction_pulses'));
    assert.ok(csv.every(row=>row.split(',').length===27));
  }
});

test('design 41 uses current coordinate calibration without replaying its historical bench profile',()=>{
  const plan=imported(jobs()[41]);
  assert.equal(plan.benchReference,undefined);
  assert.equal(plan.slantedHighCorrectionPulses,undefined);
  assert.equal(m.usesCurrentCalibration(plan),true);
  assert.equal(m.assessReachability(plan).feasible,true);
  assert.deepEqual(plan.passes.map(pass=>[0,2,1,3].map(i=>-pass.motorMoves[i].targetPulse || 0)),
    [[40346,0,33978,0],[77432,79284,71063,71305],[45526,47368,39147,39390],[13611,15460,7232,0]]);
});

test('Python current calibration without an optional profile agrees with browser coordinates',()=>{
  const job=jobs().rectangle, plan=imported(job);
  assert.equal(plan.pulseProfile,undefined);
  assert.equal(m.usesCurrentCalibration(plan),true);
  assert.equal(m.assessReachability(plan).feasible,true);
  assert.deepEqual(plan.passes,job.motor_plan.passes);
  const preview=m.createPlan({w:60,h:60,theta:90});
  assert.deepEqual(plan.passes.map(p=>p.motorMoves.map(m=>m.targetPulse)),preview.passes.map(p=>p.motorMoves.map(m=>m.targetPulse)));
  const done=m.sample(plan,plan.duration);
  assert.equal(done.completedLines,4);
  assert.ok(done.heads.every(h=>h.motor.positionPulse===0 && h.limitActive));
});

test('opt-in generic slanted correction changes only active slanted commands with current calibration',()=>{
  const job=jobs()[6], plan=imported(job);
  assert.equal(plan.benchReference,undefined);
  assert.deepEqual(plan.passes.map(pass=>[0,2,1,3].map(i=>-pass.motorMoves[i].targetPulse || 0)),expected[6]);
  for (const pass of plan.passes) {
    const state=m.sample(plan,pass.positionEnd);
    pass.motorMoves.forEach((move,i)=>{
      const adjusted=!!move.lineId && pass.family==='slanted';
      assert.equal(move.commandCorrectionPulses,adjusted?2149:0);
      assert.equal(move.calibrationSource,adjusted?'slanted-trial':'coordinate-profile');
      assert.equal(move.benchReferenceId,null);
      assert.equal(state.heads[i].motor.positionPulse,move.targetPulse);
    });
  }
});

test('reference geometry, omitted source lines, assignment, profile, settings and commands cannot silently drift',()=>{
  const changes=[
    j=>delete j.motor_plan.benchReference,
    j=>delete j.design,
    j=>delete j.motor_plan.designGeometry,
    j=>j.design.w_mm+=0.01,
    j=>j.motor_plan.designGeometry.theta_deg+=0.01,
    j=>j.motor_plan.benchReference.design.h_mm+=0.01,
    j=>j.motor_plan.benchReference.schema='unknown',
    j=>j.motor_plan.benchReference.id='unsafe id',
    j=>j.motor_plan.benchReference.status='unverified',
    j=>j.motor_plan.benchReference.source='',
    j=>j.motor_plan.benchReference.profileId='different-profile',
    j=>j.motor_plan.benchReference.profilePulsesPerMm+=0.01,
    j=>j.motor_plan.benchReference.profileHomeX[0]+=0.01,
    j=>j.motor_plan.benchReference.settings.enabledHeads.reverse(),
    j=>j.motor_plan.benchReference.settings.order='slanted-first',
    j=>j.motor_plan.benchReference.settings.edgeThreshold=0.1,
    j=>j.motor_plan.benchReference.settings.rotaryPulsesPer90=609,
    j=>j.motor_plan.benchReference.settings.minXReleasePulses=399,
    j=>j.motor_plan.benchReference.settings.minRotaryReleasePulses=9,
    j=>j.motor_plan.benchReference.lines.pop(),
    j=>j.motor_plan.benchReference.lines.find(l=>l.line_id==='H002').y_start_mm+=0.01,
    j=>j.motor_plan.benchReference.passes.pop(),
    j=>j.motor_plan.benchReference.passes[0].rotaryTargetPulse=609,
    j=>j.motor_plan.benchReference.passes[0].family='slanted',
    j=>j.motor_plan.benchReference.passes[1].heads.reverse(),
    j=>j.motor_plan.benchReference.passes[0].heads[0].highPulses++,
    j=>j.motor_plan.benchReference.passes[0].heads[0].highPulses=399,
    j=>j.motor_plan.benchReference.passes[0].heads[1].highPulses=400,
    j=>j.motor_plan.benchReference.passes[1].heads[0].lineId='S002',
    j=>j.motor_plan.passes[0].motorMoves[0].nominalRequestedPulse++,
    j=>j.motor_plan.passes[0].motorMoves[0].computedTargetPulse++,
    j=>j.motor_plan.passes[0].motorMoves[0].commandCorrectionPulses++,
    j=>j.motor_plan.passes[0].motorMoves[0].calibrationSource='coordinate-profile',
    j=>j.motor_plan.passes[0].motorMoves[0].benchReferenceId='different-reference',
    j=>j.motor_plan.passes[0].motorMoves[0].targetMachineMm++,
    j=>j.motor_plan.passes[0].motorMoves[0].targetPulse++,
    j=>j.motor_plan.slantedHighCorrectionPulses=2149,
  ];
  for (const [index,change] of changes.entries()) {
    const job=jobs()[5]; change(job);
    assert.throws(()=>imported(job),`mutation ${index}`);
  }
});

test('generic correction metadata, source family and actual pulse edits are checked independently',()=>{
  const changes=[
    j=>delete j.motor_plan.slantedHighCorrectionPulses,
    j=>j.motor_plan.slantedHighCorrectionPulses=-2148,
    j=>j.motor_plan.slantedHighCorrectionPulses=-2147483648,
    j=>j.motor_plan.slantedHighCorrectionPulses='-2149',
    j=>j.motor_plan.passes[2].motorMoves[0].commandCorrectionPulses++,
    j=>j.motor_plan.passes[2].motorMoves[0].computedTargetPulse++,
    j=>j.motor_plan.passes[2].motorMoves[0].benchReferenceId='design005-current',
    j=>j.motor_plan.passes[2].family='horizontal',
    j=>j.motor_plan.passes[2].motorMoves[0].requestedPulse++,
    j=>j.motor_plan.operations.find(o=>o.kind==='position').toX[0]+=1,
  ];
  for (const [index,change] of changes.entries()) {
    const job=jobs()[6]; change(job);
    assert.throws(()=>imported(job),`mutation ${index}`);
  }
});
