(function (scope) {
  'use strict';
  const DEG = Math.PI / 180, EPS = 1e-9, HOME_Y = 170;
  const EDGE_THRESHOLD_MM = 1;
  const CALIBRATION = 'measured-2026-10-19';
  const X_CALIBRATION = 'center-priority-2026-11-02';
  const X_CALIBRATION_GAP12000 = 'measured-2026-10-20-gap12000';
  const X_CALIBRATION_61REV = 'measured-2026-10-19-61rev';
  const ROTARY_ZERO_POLICY = 'half-turn-for-zero-layout-angle';
  const MOTOR_NAMES = Object.freeze(['Orange', 'Red', 'Yellow', 'Pink']);
  // Mirrors colab.motor_program's selected centre/end fit. Trial commands for a
  // particular design never redefine these shared switch coordinates.
  const MEASURED_DRIVE = Object.freeze({ lead: 4, pulsesPerRev: 1600, pulsesPerMm: (96500 - 36424) / 150, minReleasePulses: 400, calibration: X_CALIBRATION });
  const ROTARY_DRIVE = Object.freeze({ motorTeeth: 32, tableTeeth: 48, ratio: 1.5, pulsesPerRev: 1600, pulsesPerSlabRev: 2440, anglePerPulse: 360 / 2440, pulsesPerDegree: 610 / 90, minReleasePulses: 10, calibration: CALIBRATION, initialAngleDeg: 0, zeroLayoutAnglePulses:1220 });
  // Order: Orange, Red, Yellow, Pink. HIGH moves toward negative machine X.
  const HOME_X = Object.freeze([96500,98100,114300,114300].map(pulse=>pulse/MEASURED_DRIVE.pulsesPerMm-150));
  const CALIBRATION_REVISIONS = Object.freeze({
    [X_CALIBRATION]: { ppm:MEASURED_DRIVE.pulsesPerMm, homeX:HOME_X },
    [X_CALIBRATION_GAP12000]: { ppm:109600/270, homeX:[120-12000/(109600/270),120-12000/(109600/270),120,120] },
    [X_CALIBRATION_61REV]: { ppm:108600/270, homeX:[120-11000/(108600/270),120-11000/(108600/270),120,120] },
    [CALIBRATION]: { ppm:110200/270, homeX:[120-11000/(110200/270),120-11000/(110200/270),120,120] },
  });
  const LIMIT_X = HOME_X;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = t => t * t * (3 - 2 * t);
  const roundPulse = n => Math.sign(n) * Math.floor(Math.abs(n) + .5 + 1e-9);
  const releasePulse = (pulse, minimum) => pulse === 0 ? 0 : Math.sign(pulse) * Math.max(Math.abs(pulse), minimum);
  const pulsesPerMm = drive => drive.pulsesPerMm ?? drive.pulsesPerRev / drive.lead;
  const usesCurrentCalibration = plan => !!plan &&
    Math.abs(pulsesPerMm(plan.drive)-MEASURED_DRIVE.pulsesPerMm)<1e-10 &&
    Array.isArray(plan.homeX) && plan.homeX.length===4 &&
    plan.homeX.every((x,i)=>Number.isFinite(x) && Math.abs(x-HOME_X[i])<1e-9);
  function assessReachability(plan) {
    const constraints=plan.constraintHomeX || plan.homeX, violations=[];
    for (const pass of plan.passes) for (const move of pass.motorMoves) {
      if (!move.lineId) continue;
      const i=move.head-1, targetX=move.targetMachineMm ?? plan.homeX[i]+move.targetMm;
      const boundaryX=Math.min(plan.homeX[i],constraints[i]), outsideMm=targetX-boundaryX;
      // Check the requested continuous coordinate before rounding a small move
      // to zero or applying a design-specific empirical command.
      if (outsideMm>1e-9) violations.push({passIndex:pass.index,head:move.head,
        motorName:MOTOR_NAMES[i],lineId:move.lineId,targetX,boundaryX,outsideMm});
    }
    return {feasible:violations.length===0,violations};
  }
  function motorMove(from, target, home, drive = MEASURED_DRIVE) {
    finite(drive.lead, .001, 1000, '스크류 리드'); finite(drive.pulsesPerRev, 1, 10000000, '회전당 펄스');
    if (!Number.isInteger(drive.pulsesPerRev)) throw new Error('회전당 펄스는 정수여야 합니다.');
    for (const v of [from, target, home]) finite(v, -100000, 100000, '모터 위치');
    const ppm = finite(pulsesPerMm(drive), .001, 10000000, '거리당 펄스');
    const minimum = drive.minReleasePulses ?? 0;
    if (!Number.isSafeInteger(minimum) || minimum < 0) throw new Error('최소 해제 펄스는 0 이상의 정수여야 합니다.');
    const fromPulse = roundPulse((from - home) * ppm), requestedPulse = roundPulse((target - home) * ppm);
    const targetPulse = releasePulse(requestedPulse, minimum);
    const pulses = targetPulse - fromPulse;
    return { fromMm: fromPulse / ppm, targetMm: target - home, fromPulse, targetPulse, pulses,
      requestedPulse, releaseAdjusted: targetPulse !== requestedPulse, releaseMinimumPulses: minimum,
      distanceMm: pulses / ppm, idealDistanceMm: target - from, turns: pulses / drive.pulsesPerRev,
      targetTurns: targetPulse / drive.pulsesPerRev, targetQuantizedMm: targetPulse / ppm,
      errorMm: targetPulse / ppm - (target - home), direction: pulses < 0 ? 'X−' : pulses > 0 ? 'X+' : '정지' };
  }
  function rotate(x, y, angle) {
    const c = Math.cos(angle * DEG), s = Math.sin(angle * DEG);
    return { x: x * c - y * s, y: x * s + y * c };
  }
  function finite(value, lo, hi, label) {
    if (!Number.isFinite(value) || value < lo || value > hi) throw new RangeError(`${label}: ${lo}~${hi} 범위의 숫자를 입력하세요.`);
    return value;
  }
  function clipSlanted(c, theta) {
    const q = Math.abs(Math.cos(theta * DEG)) <= 1e-15 ? 0 : 1 / Math.tan(theta * DEG);
    if (Math.abs(q) <= 1e-15) return c >= -EPS && c <= 300 + EPS ? [{ x: clamp(c, 0, 300), y: 0 }, { x: clamp(c, 0, 300), y: 60 }] : null;
    const points = [];
    for (let [x, y] of [[c, 0], [c + 60 * q, 60], [0, -c / q], [300, (300 - c) / q]]) {
      if (x < -EPS || x > 300 + EPS || y < -EPS || y > 60 + EPS) continue;
      const p = { x: clamp(x, 0, 300), y: clamp(y, 0, 60) };
      if (!points.some(v => Math.hypot(p.x - v.x, p.y - v.y) <= 1e-7)) points.push(p);
    }
    let pair = null, distance = EPS;
    for (const a of points) for (const b of points) {
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > distance) { pair = [a, b]; distance = d; }
    }
    return pair;
  }
  // Port of notebook step 5 calculate_layout_cut_lines. No optimizer is rerun here.
  function generateLayout({ w = 30, h = 20, theta = 90 } = {}) {
    finite(w, 1, 300, '유닛 폭 w'); finite(h, 1, 60, '유닛 높이 h'); finite(theta, .001, 90, '유닛 각도 θ');
    const q = Math.abs(Math.cos(theta * DEG)) <= 1e-15 ? 0 : 1 / Math.tan(theta * DEG);
    const horizontal = new Set(), boundaries = new Set();
    let units = 0;
    for (let row = 0; row < Math.floor((60 + EPS) / h); row++) {
      const bottom = row * h, top = (row + 1) * h;
      const min = Math.ceil((-EPS - bottom * q) / w), max = Math.floor((300 + EPS - w - top * q) / w);
      if (max < min) continue;
      units += max - min + 1;
      for (const y of [bottom, top]) if (y > EPS && y < 60 - EPS) horizontal.add(+y.toFixed(10));
      for (let k = min; k <= max + 1; k++) boundaries.add(k);
    }
    const lines = [...horizontal].sort((a, b) => a - b).map((y, i) => ({ id: `H${String(i + 1).padStart(3, '0')}`, family: 'horizontal', angle: 0, a: { x: 0, y }, b: { x: 300, y } }));
    let index = 0;
    for (const k of [...boundaries].sort((a, b) => a - b)) {
      const c = k * w;
      if (Math.abs(q) <= 1e-15 && (Math.abs(c) <= EPS || Math.abs(c - 300) <= EPS)) continue;
      const ends = clipSlanted(c, theta);
      if (ends) lines.push({ id: `S${String(++index).padStart(3, '0')}`, family: 'slanted', angle: theta, a: ends[0], b: ends[1] });
    }
    return { lines, design: { w, h, theta }, units, yield: clamp(units * w * h / 18000, 0, 1), source: '노트북 배치 규칙' };
  }
  function validateLines(lines) {
    if (!Array.isArray(lines) || !lines.length) throw new Error('가공할 절단선이 없습니다. 유닛 크기와 각도를 확인하세요.');
    if (lines.length > 1000) throw new Error('한 번에 불러올 수 있는 절단선은 1,000개입니다.');
    const ids = new Set(), geometry = new Set();
    return lines.map((line, i) => {
      const a = { ...line.a }, b = { ...line.b };
      for (const p of [a, b]) { finite(p.x, -1e-6, 300 + 1e-6, `${i + 1}행 X 좌표`); finite(p.y, -1e-6, 60 + 1e-6, `${i + 1}행 Y 좌표`); p.x = clamp(p.x, 0, 300); p.y = clamp(p.y, 0, 60); }
      if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) throw new Error(`${i + 1}행 절단선의 길이가 0입니다.`);
      const id = String(line.id || `L${i + 1}`);
      if (ids.has(id)) throw new Error(`중복 절단선 ID: ${id}`); ids.add(id);
      const key = [a, b].map(p => `${p.x.toFixed(5)},${p.y.toFixed(5)}`).sort().join(':');
      if (geometry.has(key)) throw new Error(`${id}: 동일한 경로가 중복되었습니다.`); geometry.add(key);
      let angle = ((Math.atan2(b.y - a.y, b.x - a.x) / DEG) % 180 + 180) % 180;
      if (angle < 1e-5 || 180 - angle < 1e-5) angle = 0;
      return { id, a, b, angle, family: angle === 0 ? 'horizontal' : 'slanted' };
    });
  }
  function assignHeads(cuts, enabled, homeX) {
    const assigned = new Map(cuts.map((cut, i) => [enabled[i], cut]));
    const xs = [...homeX];
    for (const [head, cut] of assigned) xs[head - 1] = cut.x;
    return xs.map((x, i) => ({ head: i + 1, x, cutId: assigned.get(i + 1)?.id || null }));
  }
  function nearEdge(l, margin = EDGE_THRESHOLD_MM) {
    return (Math.abs(l.a.y-l.b.y)<=1e-8 && (Math.max(Math.abs(l.a.y),Math.abs(l.b.y))<=margin+1e-9 || Math.max(Math.abs(60-l.a.y),Math.abs(60-l.b.y))<=margin+1e-9)) ||
      (Math.abs(l.a.x-l.b.x)<=1e-8 && (Math.max(Math.abs(l.a.x),Math.abs(l.b.x))<=margin+1e-9 || Math.max(Math.abs(300-l.a.x),Math.abs(300-l.b.x))<=margin+1e-9));
  }
  function importedMotorPlan(layout) {
    const p = layout.motorProgram;
    const check = (ok) => { if (!ok) throw new Error('Python 모터 계획이 손상되었거나 좌표·펄스가 일치하지 않습니다. 8 → 8.5단계를 다시 실행하세요.'); };
    const near = (a,b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b)<1e-6;
    check(p && p.pythonMotorProgram === true && p.drive?.lead === 4 && p.drive?.pulsesPerRev === 1600);
    const profile = p.pulseProfile, profiled = profile !== undefined;
    if (profiled) {
      check(profile && profile.schema==='kaistone.motor-calibration.v1' && typeof profile.id==='string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(profile.id) && !Object.hasOwn(CALIBRATION_REVISIONS,profile.id) && profile.status==='provisional' && profile.model==='shared-scale-per-head-home' && profile.coordinate_system==='machine-centre-x-mm');
      check(p.drive.calibration===profile.id && Number.isFinite(profile.pulses_per_mm) && profile.pulses_per_mm>0 && profile.pulses_per_mm<=10000000);
      check(profile.baseline && Number.isFinite(profile.baseline.pulses_per_mm));
      // Archived plans retain a recognized historical baseline; never replace
      // an imported pulse program with today's default or silently refit it.
      check(Object.values(CALIBRATION_REVISIONS).some(revision=>
        Math.abs(profile.baseline.pulses_per_mm-revision.ppm)<1e-10 &&
        Array.isArray(profile.baseline.home_x) && profile.baseline.home_x.length===4 &&
        profile.baseline.home_x.every((x,i)=>Number.isFinite(x) && Math.abs(x-revision.homeX[i])<1e-9)));
      check(Array.isArray(p.constraintHomeX) && p.constraintHomeX.length===4 && p.constraintHomeX.every((x,i)=>near(x,profile.baseline.home_x[i])));
      check(Array.isArray(profile.heads) && profile.heads.length===4 && Array.isArray(p.homeX) && p.homeX.length===4);
      profile.heads.forEach((head,i)=>{
        check(head && head.motor_name===MOTOR_NAMES[i] && Number.isFinite(head.effective_home_x_mm) && head.effective_home_x_mm>=-150 && head.effective_home_x_mm<=500 && near(head.effective_home_x_mm,p.homeX[i]));
        if (head.offset_pulses_from_baseline!==undefined) check(near(head.offset_pulses_from_baseline,(head.effective_home_x_mm-profile.baseline.home_x[i])*profile.pulses_per_mm));
        const points=head.calibration_points;
        check(Array.isArray(points) && points.length>=2 && points.length<=1000);
        points.forEach(point=>{
          check(point && Number.isFinite(point.machine_x_mm) && Math.abs(point.machine_x_mm)<=500 && Number.isSafeInteger(point.high_pulses) && point.high_pulses>=0);
          check(roundPulse((head.effective_home_x_mm-point.machine_x_mm)*profile.pulses_per_mm)===point.high_pulses);
        });
        check(Math.max(...points.map(point=>point.machine_x_mm))-Math.min(...points.map(point=>point.machine_x_mm))>1e-9);
      });
      if (profile.reference_rotation_deg!==undefined) check(Number.isFinite(profile.reference_rotation_deg));
    }
    const measured = profiled || Object.hasOwn(CALIBRATION_REVISIONS,p.drive.calibration);
    const halfTurnPolicy = p.rotaryZeroPolicy===ROTARY_ZERO_POLICY;
    check(measured || p.drive.calibration === undefined);
    check(p.rotaryZeroPolicy===undefined || (measured && halfTurnPolicy));
    // Historical JSON keeps the calibration and pulse plan saved at export time.
    const ppm = profiled ? profile.pulses_per_mm : CALIBRATION_REVISIONS[p.drive.calibration]?.ppm ?? 400;
    if (measured) check(near(p.drive.pulsesPerMm,ppm) && p.drive.minReleasePulses===400 && p.releasePolicy==='clamp-nonzero-from-home');
    check(Array.isArray(p.homeX) && p.homeX.length === 4 && p.homeX.every(x=>Number.isFinite(x)&&x>=(measured?-500:137)&&x<=500));
    if (p.homeCalibration!==undefined) {
      const c=p.homeCalibration;
      check(c && ['referenceX','penInsetMm','effectiveHomeX'].every(key=>Array.isArray(c[key]) && c[key].length===4 && c[key].every(Number.isFinite)));
      check(c.penInsetMm.every(x=>x>=0) && c.effectiveHomeX.every((x,i)=>near(x,p.homeX[i]) && near(x,c.referenceX[i]-c.penInsetMm[i])));
    }
    check(Array.isArray(p.limitX) && p.limitX.length===4 && p.limitX.every((x,i)=>near(x,p.homeX[i]+(measured?0:4))));
    check(Array.isArray(p.enabledHeads) && p.enabledHeads.length && new Set(p.enabledHeads).size===p.enabledHeads.length && p.enabledHeads.every(h=>[1,2,3,4].includes(h)));
    check(Array.isArray(p.passes) && p.passes.length<=1000 && Array.isArray(p.cuts) && Array.isArray(p.operations) && p.operations.length>=7);
    finite(p.feed,5,50,'이송 속도'); finite(p.edgeThreshold,0,1,'생략 거리');
    const r=p.rotaryDrive;
    check(r && Number.isInteger(r.motorTeeth) && r.motorTeeth>0 && Number.isInteger(r.tableTeeth) && r.tableTeeth>0 && r.pulsesPerRev===1600 && r.initialAngleDeg===0);
    check(near(r.ratio,r.tableTeeth/r.motorTeeth) && near(r.anglePerPulse,360/r.pulsesPerSlabRev));
    if (measured) check(r.calibration===CALIBRATION && r.minReleasePulses===10 && near(r.pulsesPerSlabRev,2440) && near(r.pulsesPerDegree,610/90));
    else check(near(r.pulsesPerSlabRev,1600*r.ratio));
    if (halfTurnPolicy) check(r.zeroLayoutAnglePulses===1220);
    const skipped = layout.lines.filter(l=>nearEdge(l,p.edgeThreshold)), active=layout.lines.filter(l=>!nearEdge(l,p.edgeThreshold));
    check(new Set(p.cuts.map(c=>c.id)).size===active.length && p.cuts.length===active.length && active.every(l=>p.cuts.some(c=>c.id===l.id)));
    // A bench command is tied to its complete drawing and head assignment. The
    // original coordinate target stays available separately from the actual
    // pulse-derived position, so a correction cannot hide an unreachable cut.
    const bench=p.benchReference, benchBound=bench!==undefined;
    const slantedCorrection=p.slantedHighCorrectionPulses ?? 0;
    check(Number.isSafeInteger(slantedCorrection) && slantedCorrection>-2147483648 && slantedCorrection<=0);
    const corrected=benchBound || slantedCorrection!==0;
    if (corrected) check(profiled);
    if (benchBound) {
      check(bench && bench.schema==='kaistone.bench-reference.v1' &&
        typeof bench.id==='string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(bench.id) &&
        ['user_selected_current_reference','user_accepted_qualitative'].includes(bench.status) &&
        typeof bench.source==='string' && bench.source.length>0 && bench.profileId===profile.id);
      check(bench.profilePulsesPerMm===profile.pulses_per_mm &&
        Array.isArray(bench.profileHomeX) && bench.profileHomeX.length===4 &&
        bench.profileHomeX.every((x,i)=>x===profile.heads[i].effective_home_x_mm));
      check(bench.settings && Array.isArray(bench.settings.enabledHeads) &&
        bench.settings.enabledHeads.length===p.enabledHeads.length &&
        bench.settings.enabledHeads.every((head,i)=>head===p.enabledHeads[i]) &&
        bench.settings.order===p.order && near(bench.settings.edgeThreshold,p.edgeThreshold) &&
        near(bench.settings.rotaryPulsesPer90,r.pulsesPerDegree*90) &&
        bench.settings.minXReleasePulses===p.drive.minReleasePulses &&
        bench.settings.minRotaryReleasePulses===r.minReleasePulses);
      check(bench.design && p.designGeometry && layout.design);
      for (const [saved,input] of [['w_mm','w'],['h_mm','h'],['theta_deg','theta']]) {
        const value=bench.design[saved];
        check(Number.isFinite(value) && Number.isFinite(p.designGeometry[saved]) &&
          Math.abs(value-p.designGeometry[saved])<=1e-8 && Math.abs(value-layout.design[input])<=1e-8);
      }
      check(Array.isArray(bench.lines) && bench.lines.length===layout.lines.length &&
        new Set(bench.lines.map(l=>l.line_id)).size===bench.lines.length);
      for (const l of bench.lines) {
        const source=layout.lines.find(v=>v.id===l.line_id);
        check(source);
        for (const [key,value] of [['x_start_mm',source.a.x],['y_start_mm',source.a.y],
          ['x_end_mm',source.b.x],['y_end_mm',source.b.y]]) {
          check(Number.isFinite(l[key]) && Math.abs(l[key]-value)<=1e-6);
        }
      }
      check(Array.isArray(bench.passes) && bench.passes.length===p.passes.length);
    }
    let xPulses=[0,0,0,0], rotaryPulse=0;
    const repeatedHome=p.homingPolicy==='x-every-return-slab-before-angle-change';
    p.passes.forEach((pass,index)=>{
      if(repeatedHome) {
        xPulses=[0,0,0,0];
        const needsHome=index===0 || !near(pass.rotation,p.passes[index-1].rotation);
        check(pass.rotaryHomedBeforeMove===needsHome);
        if(needsHome) rotaryPulse=0;
        const ops=p.operations.filter(o=>o.passIndex===index);
        check(ops.at(-2)?.kind==='x_home_seek' && ops.at(-1)?.kind==='x_home_reference' && near(ops.at(-1).end,pass.end));
        if(needsHome && index>0) check(ops[0]?.kind==='slab_home_seek' && ops[1]?.kind==='slab_home_reference');
      }
      check(pass.index===index && pass.heads?.length===4 && pass.motorMoves?.length===4);
      const benchPass=benchBound?bench.passes[index]:null;
      if (benchBound) check(benchPass && benchPass.family===pass.family &&
        benchPass.rotaryTargetPulse===pass.rotaryMotor?.targetPulse &&
        Array.isArray(benchPass.heads) && benchPass.heads.length===4);
      const m=pass.rotaryMotor;
      check(m && Number.isSafeInteger(m.targetPulse) && m.fromPulse===rotaryPulse && m.pulses===m.targetPulse-m.fromPulse);
      check((m.turns === undefined || near(m.turns,m.pulses/1600)) && (m.targetTurns === undefined || near(m.targetTurns,m.targetPulse/1600)) && near(pass.rotation,m.targetPulse*r.anglePerPulse) && near(m.targetAngleDeg,pass.rotation));
      if (measured) check(m.requestedPulse===roundPulse(m.requestedAngleDeg*r.pulsesPerDegree) && m.targetPulse===releasePulse(m.requestedPulse,10) && m.releaseAdjusted===(m.targetPulse!==m.requestedPulse) && m.releaseMinimumPulses===10);
      if (halfTurnPolicy) {
        const layoutAngle=90-pass.angle, zeroAngle=Math.abs(layoutAngle)<1e-8;
        check(m.zeroAngleHalfTurn===zeroAngle && near(m.requestedLayoutAngleDeg,layoutAngle) && near(pass.requestedRotation,layoutAngle));
        check(near(m.requestedAngleDeg,zeroAngle?180:layoutAngle) && near(pass.displayRotation,zeroAngle?0:pass.rotation) && near(m.targetLayoutAngleDeg,pass.displayRotation));
        if (zeroAngle) check(m.targetPulse===1220);
      }
      rotaryPulse=m.targetPulse;
      pass.motorMoves.forEach((m,i)=>{
        const h=pass.heads[i];
        check(m.head===i+1 && h.head===i+1 && Number.isSafeInteger(m.targetPulse) && m.fromPulse===xPulses[i] && m.pulses===m.targetPulse-m.fromPulse);
        check((m.turns === undefined || near(m.turns,m.pulses/1600)) && (m.targetTurns === undefined || near(m.targetTurns,m.targetPulse/1600)) && near(h.x,p.homeX[i]+m.targetPulse/ppm));
        check(near(m.distanceMm,m.pulses/ppm) && near(m.fromMm,m.fromPulse/ppm) && near(m.targetQuantizedMm,m.targetPulse/ppm) && near(m.errorMm,m.targetQuantizedMm-m.targetMm));
        if (p.homeCalibration) {
          const c=p.homeCalibration;
          check(near(m.homeReferenceMm,c.referenceX[i]) && near(m.penInsetMm,c.penInsetMm[i]) && near(m.penHomeMm,p.homeX[i]));
          check(near(m.targetMachineMm,p.homeX[i]+m.targetMm));
          if (profiled) check(near(m.constraintHomeMm,p.constraintHomeX[i]));
        }
        if (measured) {
          const nominal=roundPulse(m.targetMm*ppm);
          if (corrected) {
            let requested=nominal, source='coordinate-profile';
            if (benchBound) {
              const command=benchPass.heads[i];
              check(command && command.motorName===MOTOR_NAMES[i] && command.lineId===h.cutId &&
                Number.isSafeInteger(command.highPulses) &&
                command.highPulses<=2147483647 &&
                (h.cutId?command.highPulses>=400:command.highPulses===0));
              requested=-command.highPulses;
              source='bench-reference';
            } else if (h.cutId && pass.family==='slanted' && nominal<0) {
              requested=nominal-slantedCorrection;
              check(requested<0);
              source='slanted-trial';
            }
            check(m.nominalRequestedPulse===nominal && m.computedTargetPulse===releasePulse(nominal,400) &&
              m.requestedPulse===requested && m.commandCorrectionPulses===requested-nominal &&
              m.calibrationSource===source && m.benchReferenceId===(benchBound?bench.id:null));
          } else check(m.requestedPulse===nominal);
          check(Number.isSafeInteger(m.requestedPulse) && m.targetPulse===releasePulse(m.requestedPulse,400) &&
            m.releaseAdjusted===(m.targetPulse!==m.requestedPulse) && m.releaseMinimumPulses===400 &&
            m.motorName===MOTOR_NAMES[i]);
        }
        check(m.lineId===h.cutId && (h.cutId ? p.enabledHeads.includes(i+1) && active.some(l=>l.id===h.cutId) : m.targetPulse===0));
        if (h.cutId) {
          const l=active.find(l=>l.id===h.cutId), ends=[l.a,l.b].map(v=>rotate(v.x-150,v.y-30,pass.rotation));
          const targetX=(ends[0].x+ends[1].x)/2;
          check(near(m.targetMm,targetX-p.homeX[i]) && Math.abs(l.angle-pass.angle)<1e-4);
          if (corrected) check(near(m.targetMachineMm,targetX) && pass.family===l.family);
          // A fitted zero is an effective coordinate, never permission to draw beyond the measured switch boundary.
          if (profiled) check(targetX<=Math.min(p.homeX[i],p.constraintHomeX[i])+1e-9);
          else if (p.drive.calibration===X_CALIBRATION) check(targetX<=p.homeX[i]+1e-9);
          check(near(pass.rotaryMotor.requestedAngleDeg,halfTurnPolicy && Math.abs(90-pass.angle)<1e-8?180:90-pass.angle));
        }
        xPulses[i]=m.targetPulse;
      });
      const position=p.operations.find(o=>o.passIndex===index&&o.kind==='position');
      check(position && position.toX.every((x,i)=>near(x,pass.heads[i].x)) && near(position.toAngle,pass.rotation));
      check(pass.cutIds.length===pass.heads.filter(h=>h.cutId).length && pass.cutIds.every(id=>pass.heads.some(h=>h.cutId===id)));
    });
    let end=0, previous=null;
    const kinds=['init_lift','init_seek','init_contact','init_backoff','init_latch','init_reference','init_release','rotate','position','approach','cut','lift','return','slab_home_seek','slab_home_reference','x_home_seek','x_home_reference'];
    p.operations.forEach(o=>{
      check(kinds.includes(o.kind) && Number.isInteger(o.passIndex) && o.passIndex>=-1 && o.passIndex<p.passes.length && near(o.start,end) && o.duration>0 && near(o.end,o.start+o.duration));
      for (const key of ['fromY','toY','fromAngle','toAngle']) finite(o[key],-1000,1000,key);
      for (const key of ['fromX','toX']) check(Array.isArray(o[key])&&o[key].length===4&&o[key].every(v=>Number.isFinite(v)&&Math.abs(v)<=1000));
      if(previous) check(near(previous.toY,o.fromY)&&near(previous.toAngle,o.fromAngle)&&previous.toX.every((x,i)=>near(x,o.fromX[i])));
      if(o.passIndex>=0) {
        const pass=p.passes[o.passIndex];
        if(o.kind.startsWith('slab_home')) {
          check(repeatedHome && near(o.toAngle,0) && o.toX.every((x,i)=>near(x,p.homeX[i])));
        } else check(near(o.toAngle,pass.rotation));
        if(o.kind==='rotate')check(o.fromX.every((x,i)=>near(x,o.toX[i])));
        if(o.kind.startsWith('x_home')) check(repeatedHome && o.toX.every((x,i)=>near(x,p.homeX[i])));
        else if(!o.kind.startsWith('slab_home') && o.kind!=='rotate')check(o.toX.every((x,i)=>near(x,pass.heads[i].x)));
      }
      if(o.kind.endsWith('home_seek'))check(o.pulses===null && o.until===(o.kind.startsWith('x_')?'x_limit_switches':'slab_zero_switch'));
      if(o.kind.endsWith('home_reference'))check(o.resetPulse===0 && o.requires===(o.kind.startsWith('x_')?'x_limit_switches':'slab_zero_switch'));
      end=o.end; previous=o;
    });
    const initialOffset=repeatedHome?2:0;
    if(repeatedHome)check(p.operations[0].kind==='slab_home_seek' && p.operations[1].kind==='slab_home_reference');
    check(near(end,p.duration) && near(p.operations[initialOffset+6].end,p.initializationEnd) && p.operations.slice(initialOffset,initialOffset+7).every((o,i)=>o.kind===kinds[i]&&o.passIndex===-1));
    p.cuts.forEach(c=>{
      const pass=p.passes[c.passIndex]; check(pass && pass.cutIds.includes(c.id) && Number.isInteger(c.head) && pass.heads[c.head-1]?.cutId===c.id);
      check(near(c.x,pass.heads[c.head-1].x)&&near(c.cutStart,pass.cutStart)&&near(c.strokeStartY,pass.startY)&&near(c.length,c.high-c.low)&&c.length>0);
      const source=active.find(l=>l.id===c.id), ends=[source.a,source.b].map(v=>rotate(v.x-150,v.y-30,pass.rotation));
      check(near(c.high,Math.max(...ends.map(v=>v.y)))&&near(c.low,Math.min(...ends.map(v=>v.y))));
      for (const [point,y] of [[c.localStart,c.high],[c.localEnd,c.low]]) { const expected=rotate(c.x,y,-pass.rotation); check(point&&near(point.x,expected.x)&&near(point.y,expected.y)); }
    });
    // Input is a Python-authored execution plan. Browser validates, never replans it.
    const { motorProgram, ...metadata } = layout;
    return { ...p, layout:metadata, skippedLines:skipped, calibrationCurrent:usesCurrentCalibration(p) };
  }
  function createPlan(options = {}) {
    if (options.layout?.motorProgram) return importedMotorPlan(options.layout);
    const { feed = 20, enabledHeads = [1, 2, 3, 4], order = 'horizontal-first', edgeThreshold = EDGE_THRESHOLD_MM } = options;
    finite(feed, 5, 50, '절단 이송 속도');
    finite(edgeThreshold, 0, 1, '생략 거리');
    const drive = { ...MEASURED_DRIVE, ...options.drive };
    motorMove(0, 0, 0, drive);
    const homeX = [...(options.homeX || HOME_X)];
    if (homeX.length !== 4) throw new Error('칼날 원점 위치는 4개가 필요합니다.');
    homeX.forEach(x => finite(x, -500, 500, '펜 끝 X 원점 위치'));
    const limitX = [...homeX], backoffX = homeX.map(x=>x-drive.minReleasePulses/pulsesPerMm(drive));
    if (!Array.isArray(enabledHeads) || !enabledHeads.length || enabledHeads.some(n => !Number.isInteger(n) || n < 1 || n > 4) || new Set(enabledHeads).size !== enabledHeads.length) throw new Error('사용할 칼날을 1개 이상 선택하세요.');
    if (!['horizontal-first', 'slanted-first'].includes(order)) throw new Error('절단 순서를 확인하세요.');
    const enabled = [...enabledHeads].sort((a, b) => a - b);
    const layout = options.layout || generateLayout(options);
    const inputLines = validateLines(layout.lines);
    const skippedLines = inputLines.filter(l => nearEdge(l, edgeThreshold));
    const lines = inputLines.filter(l => !nearEdge(l, edgeThreshold)), groups = [];
    for (const l of lines) {
      let group = groups.find(g => Math.abs(g.angle - l.angle) < 1e-4);
      if (!group) { group = { angle: l.angle, family: l.family, lines: [] }; groups.push(group); }
      group.lines.push(l);
    }
    groups.sort((a, b) => order === 'horizontal-first' ? a.angle - b.angle : b.angle - a.angle);
    const passes = [], cuts = [], operations = [];
    let currentY = HOME_Y, currentAngle = 0, currentX = [-90, -30, 30, 90], time = 0;
    function op(kind, duration, passIndex, y, rotation, xs) {
      if (duration < 1e-8) return;
      operations.push({ kind, duration, start: time, end: time + duration, passIndex, fromY: currentY, toY: y, fromAngle: currentAngle, toAngle: rotation, fromX: [...currentX], toX: [...xs] });
      time += duration; currentY = y; currentAngle = rotation; currentX = [...xs];
    }
    // Homing is a distinct pre-production sequence, not a cutting pass.
    op('slab_home_seek', .5, -1, HOME_Y, 0, currentX);
    op('slab_home_reference', .35, -1, HOME_Y, 0, currentX);
    op('init_lift', .5, -1, HOME_Y, 0, currentX);
    op('init_seek', Math.max(...limitX.map((x, i) => (x - currentX[i]) / 80)), -1, HOME_Y, 0, limitX);
    op('init_contact', .35, -1, HOME_Y, 0, limitX);
    op('init_backoff', .4, -1, HOME_Y, 0, backoffX);
    op('init_latch', .8, -1, HOME_Y, 0, limitX);
    op('init_reference', .35, -1, HOME_Y, 0, limitX);
    op('init_release', .4, -1, HOME_Y, 0, homeX);
    const initializationEnd = time;
    const rotaryDrive = { ...ROTARY_DRIVE };
    let previousRotaryPulse = 0;
    for (const group of groups) {
      const requestedRotation = 90 - group.angle;
      const zeroAngleHalfTurn = Math.abs(requestedRotation)<1e-8;
      const requestedMotorAngle = zeroAngleHalfTurn?180:requestedRotation;
      const requestedRotaryPulse = roundPulse(requestedMotorAngle*rotaryDrive.pulsesPerDegree);
      const targetRotaryPulse = releasePulse(requestedRotaryPulse,rotaryDrive.minReleasePulses);
      const rotation = targetRotaryPulse*rotaryDrive.anglePerPulse;
      const displayRotation = zeroAngleHalfTurn?0:rotation;
      const transformed = group.lines.map(l => {
        const a = rotate(l.a.x - 150, l.a.y - 30, rotation), b = rotate(l.b.x - 150, l.b.y - 30, rotation);
        return { ...l, rotation, x: (a.x + b.x) / 2, high: Math.max(a.y, b.y), low: Math.min(a.y, b.y), length: Math.abs(a.y-b.y), alignmentErrorMm: Math.abs(a.x-b.x)/2 };
      }).sort((a, b) => a.x - b.x);
      for (let offset = 0; offset < transformed.length; offset += enabled.length) {
        const batch = transformed.slice(offset, offset + enabled.length), passIndex = passes.length;
        const heads = assignHeads(batch, enabled, homeX);
        const moves = heads.map((h,i)=>({head:i+1,motorName:MOTOR_NAMES[i],lineId:h.cutId,...motorMove(currentX[i],h.x,homeX[i],drive)}));
        heads.forEach((h,i)=>{h.x=homeX[i]+moves[i].targetQuantizedMm;});
        const xs = heads.map(h => h.x);
        const startY = Math.max(...batch.map(c => c.high)) + 12, endY = Math.min(...batch.map(c => c.low)) - 12;
        const rehome = passIndex===0 || Math.abs(currentAngle-rotation)>1e-8;
        const pass = { index: passIndex, family: group.family, angle: group.angle, rotation, displayRotation, requestedRotation, heads, start: time, cutIds: batch.map(c => c.id), startY, endY, rotaryHomedBeforeMove: rehome };
        if(rehome) previousRotaryPulse=0;
        if(passIndex>0 && rehome) {
          op('slab_home_seek',Math.max(.5,Math.abs(currentAngle)/30),passIndex,HOME_Y,0,currentX);
          op('slab_home_reference',.35,passIndex,HOME_Y,0,currentX);
        }
        op('rotate', Math.abs(currentAngle - rotation) / 45, passIndex, HOME_Y, rotation, currentX);
        pass.motorMoves = moves;
        pass.rotaryMotor={fromPulse:previousRotaryPulse,targetPulse:targetRotaryPulse,pulses:targetRotaryPulse-previousRotaryPulse,requestedPulse:requestedRotaryPulse,releaseAdjusted:targetRotaryPulse!==requestedRotaryPulse,releaseMinimumPulses:10,requestedAngleDeg:requestedMotorAngle,targetAngleDeg:rotation,fromAngleDeg:previousRotaryPulse*rotaryDrive.anglePerPulse,errorDeg:rotation-requestedMotorAngle,requestedLayoutAngleDeg:requestedRotation,targetLayoutAngleDeg:displayRotation,zeroAngleHalfTurn};
        previousRotaryPulse=targetRotaryPulse;
        pass.positionStart = time;
        op('position', Math.max(.5, ...xs.map((x, i) => Math.abs(x - currentX[i]) / 60)), passIndex, HOME_Y, rotation, xs);
        pass.positionEnd = time;
        op('approach', Math.max(.1, Math.abs(HOME_Y - startY) / 80), passIndex, startY, rotation, xs);
        pass.cutStart = time;
        op('cut', (startY - endY) / feed, passIndex, endY, rotation, xs);
        pass.cutEnd = time;
        op('lift', .45, passIndex, endY, rotation, xs);
        op('return', Math.abs(HOME_Y - endY) / 100, passIndex, HOME_Y, rotation, xs);
        op('x_home_seek',Math.max(.5,...xs.map((x,i)=>Math.abs(homeX[i]-x)/60)),passIndex,HOME_Y,rotation,homeX);
        op('x_home_reference',.35,passIndex,HOME_Y,rotation,homeX);
        pass.end = time;
        for (const c of batch) {
          const h = heads.find(h => h.cutId === c.id), head=h.head;
          const localStart = rotate(h.x, c.high, -rotation), localEnd = rotate(h.x, c.low, -rotation);
          cuts.push({ ...c, x:h.x, head, passIndex, cutStart: pass.cutStart, strokeStartY: startY, localStart, localEnd });
        }
        passes.push(pass);
      }
    }
    const horizontalCount = lines.filter(l => l.family === 'horizontal').length, slantedCount = lines.length - horizontalCount;
    const notebookPasses = groups.reduce((sum, g) => sum + Math.ceil(g.lines.length / 4), 0);
    const warnings = [];
    if (passes.length > 6) warnings.push(`선택 칼날 기준 ${passes.length}회: 노트북의 슬랩당 6회 제약을 초과합니다.`);
    if (layout.units !== undefined && layout.units < 5) warnings.push(`완전한 유닛 ${layout.units}개: 노트북의 최소 5개 제약을 만족하지 않습니다.`);
    if (skippedLines.length) warnings.push(`외곽 ${edgeThreshold} mm 이내 수평·수직선 ${skippedLines.length}개 그리기 생략`);
    if (passes.some(p=>p.motorMoves.some(m=>m.lineId && m.targetPulse>0))) warnings.push('일부 목표가 리미트 원점보다 컨트롤러 쪽에 있습니다. 실제 장비의 도달 범위를 확인하세요.');
    return { feed, drive, rotaryDrive, rotaryZeroPolicy:ROTARY_ZERO_POLICY, releasePolicy:'clamp-nonzero-from-home', homeX, limitX, enabledHeads: enabled, order, edgeThreshold, layout, passes, cuts, operations, initializationEnd, duration: time, horizontalCount, slantedCount, notebookPasses, warnings, skippedLines };
  }
  function sample(plan, elapsed) {
    if (!Number.isFinite(elapsed)) throw new Error('시뮬레이션 시간이 유효하지 않습니다.');
    const t = clamp(elapsed, 0, plan.duration), complete = t >= plan.duration;
    const operation = plan.operations.find(o => t < o.end - 1e-9) || plan.operations.at(-1);
    const u = clamp((t - operation.start) / operation.duration, 0, 1), eased = operation.kind === 'cut' ? u : smooth(u);
    const y = lerp(operation.fromY, operation.toY, eased);
    let rotation = lerp(operation.fromAngle, operation.toAngle, eased);
    const rotaryPulse = plan.rotaryDrive ? roundPulse(rotation / plan.rotaryDrive.anglePerPulse) : null;
    if (plan.rotaryDrive) rotation = rotaryPulse * plan.rotaryDrive.anglePerPulse;
    const initialized = t >= plan.initializationEnd;
    const initializing = !initialized;
    const pass = initializing || !plan.passes.length ? { index: -1, heads: plan.homeX.map((x, i) => ({ head: i + 1, x, cutId: null })), cutIds: [] } : plan.passes[operation.passIndex];
    const cuts = plan.cuts.map(c => {
      const cuttingY = c.strokeStartY - Math.max(0, t - c.cutStart) * plan.feed;
      const completedLength = t <= c.cutStart ? 0 : clamp(c.high - cuttingY, 0, c.length);
      const fraction = completedLength / c.length;
      return { ...c, completedLength, localEndDone: { x: lerp(c.localStart.x, c.localEnd.x, fraction), y: lerp(c.localStart.y, c.localEnd.y, fraction) } };
    });
    const heads = pass.heads.map((h, i) => {
      const cut = cuts.find(c => c.id === h.cutId);
      const active = !complete && operation.kind === 'cut' && !!cut && y <= cut.high && y >= cut.low;
      const idealX = lerp(operation.fromX[i], operation.toX[i], eased);
      const ppm = pulsesPerMm(plan.drive);
      const positionPulse = initialized ? roundPulse((idealX - plan.homeX[i]) * ppm) : null;
      const x = initialized ? plan.homeX[i] + positionPulse / ppm : idealX;
      const parking = !cut && Math.abs(x - plan.homeX[i]) > 1e-6;
      const move = initialized && pass.motorMoves ? pass.motorMoves[i] : null;
      const motor = move ? { ...move, positionPulse, positionTurns: positionPulse / plan.drive.pulsesPerRev, movedPulses: positionPulse - move.fromPulse, remainingPulses: move.targetPulse - positionPulse, remainingTurns: (move.targetPulse - positionPulse) / plan.drive.pulsesPerRev } : null;
      if(motor && operation.kind.startsWith('x_home'))motor.remainingPulses=null;
      const limitActive = plan.drive.minReleasePulses ? (plan.homeX[i]-x)*ppm < plan.drive.minReleasePulses-1e-6 : x >= plan.limitX[i]-1e-6;
      return { ...h, x, y, motor, motorName:MOTOR_NAMES[i], homeX: plan.homeX[i], referencedX: initialized ? x - plan.homeX[i] : null, limitActive: operation.kind==='x_home_reference' || limitActive, active, state: initializing || (operation.kind.startsWith('x_home') && !!cut) ? '원점 탐색 · 상승' : !cut ? parking ? '원점 복귀 · 상승' : '원점 대기 · 고정' : active ? '절단 중' : cut.completedLength >= cut.length - 1e-7 ? '완료 · 상승' : operation.kind === 'position' ? '재배치' : '대기 · 상승' };
    });
    return { elapsed: t, complete, initializing, initialized, operation, passIndex: pass.index, pass, progress: t / plan.duration, y, rotation, rotaryPulse, heads, cuts, completedPasses: plan.passes.filter(p => t >= p.end - 1e-9).length, completedLines: cuts.filter(c => c.completedLength >= c.length - 1e-7).length };
  }
  function report(plan, state) {
    const pulseOnly = m => Object.fromEntries(Object.entries(m || {}).filter(([key]) => !["turns","targetTurns","positionTurns","remainingTurns"].includes(key)));
    const point = p => ({ x_mm: +(p.x+150).toFixed(6), y_mm: +(p.y+30).toFixed(6) });
    return { schema_version: 5, source: plan.layout.source, design_id: plan.layout.designId ?? null, design: plan.layout.design || null, slab_mm: { width: 300, height: 60 }, coordinate_system: 'Slab bottom-left origin, x right, y up',
      motor_calculation_source: plan.pythonMotorProgram ? 'Python step 8.5' : 'browser calibrated preview',
      pulse_profile: plan.pulseProfile ?? null, bench_reference: plan.benchReference ?? null,
      slanted_high_correction_pulses: plan.slantedHighCorrectionPulses ?? 0,
      skipped_lines: plan.skippedLines || [], rotary_drive: plan.rotaryDrive || null, rotary_zero_policy:plan.rotaryZeroPolicy??null,
      rotary_program: plan.passes.map(p=>p.rotaryMotor ? pulseOnly(p.rotaryMotor) : null),
      current_rotary_pulse: state.rotaryPulse ?? null,
      original_cut_lines: plan.layout.lines,
      drive: { x_lead_mm_per_rev: plan.drive.lead, pulses_per_rev: plan.drive.pulsesPerRev, pulses_per_mm: pulsesPerMm(plan.drive), min_release_pulses:plan.drive.minReleasePulses??0, calibration:plan.drive.calibration??'nominal', transmission_ratio: 1, y_lead_mm_per_rev: 10, y_motor_calculated: false, rotary_motor_ratio: plan.rotaryDrive?.ratio ?? null },
      motor_program: plan.passes.flatMap(p => p.motorMoves.map(m => ({ pass: p.index + 1, rotation_deg: p.rotation, ...pulseOnly(m) }))),
      current_motor_state: state.heads.map(h => ({ head: h.head, ...pulseOnly(h.motor) })),
      initialization: { complete: state.initialized, duration_s: plan.initializationEnd, axes: 'X1-X4 (simulated)', home_x_mm: plan.homeX, switch_x_mm: plan.limitX, live_switches: state.heads.map(h => ({ head: h.head, active: h.limitActive })) },
      head_positions: state.heads.map(h => ({ head: h.head, machine_x_mm: h.x, machine_y_mm: h.y, referenced_x_mm: h.referencedX, state: h.state })),
      assumptions: ['노트북의 절단선 생성과 방향별 묶음 규칙을 반영. NSGA-II를 재실행하지 않음.', '각 패스 사이 X 헤드 재배치와 개별 승강 가능, 가공 중 판재 고정 유지 가정.', '절단 폭·충돌·헤드 최소 간격·가감속 한계·재료 물성은 미검증. 실제 장비 제어 없음.'],
      enabled_heads: plan.enabledHeads, feed_mm_s: plan.feed, planned_cycle_s: plan.duration, elapsed_simulation_s: state.elapsed, complete: state.complete,
      planned_passes: plan.passes.length, notebook_four_head_passes: plan.notebookPasses, completed_passes: state.completedPasses, completed_lines: state.completedLines,
      units_per_slab: plan.layout.units ?? null, material_yield: plan.layout.yield ?? null, warnings: plan.warnings,
      passes: plan.passes.map(p => ({ pass: p.index + 1, family: p.family, table_rotation_deg: p.rotation, layout_rotation_deg:p.displayRotation??p.rotation, heads: p.heads, cut_ids: p.cutIds, start_s: p.start, cut_start_s: p.cutStart, cut_end_s: p.cutEnd, end_s: p.end })),
      total_completed_cut_length_mm: state.cuts.reduce((sum, c) => sum + c.completedLength, 0),
      cuts: state.cuts.map(c => ({ line_id: c.id, pass: c.passIndex + 1, head: c.head, planned_start: point(c.localStart), planned_end: point(c.localEnd), planned_length_mm: c.length, completed_length_mm: c.completedLength, completed_end: c.completedLength > 0 ? point(c.localEndDone) : null })) };
  }
  function parseCSV(text) {
    if (text.length > 2000000) throw new Error('CSV는 2 MB 이하로 불러오세요.');
    const rows = []; let row = [], cell = '', quoted = false;
    text = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
      else if (!quoted && (ch === ',' || ch === '\n' || ch === '\r')) {
        row.push(cell.trim()); cell = '';
        if (ch !== ',') { if (row.some(Boolean)) rows.push(row); row = []; if (ch === '\r' && text[i + 1] === '\n') i++; }
      } else cell += ch;
    }
    if (quoted) throw new Error('CSV의 따옴표가 닫히지 않았습니다.');
    row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
    if (rows.length < 2) throw new Error('CSV에 데이터 행이 없습니다.');
    const number = value => value === undefined || value.trim() === '' ? NaN : Number(value);
    const headers = rows[0], field = (r, name) => r[headers.indexOf(name)];
    if (['x_start_mm', 'y_start_mm', 'x_end_mm', 'y_end_mm'].every(h => headers.includes(h))) {
      const designIds = new Set(rows.slice(1).map(r => field(r, 'design_id')).filter(v => v !== undefined && v !== ''));
      if (designIds.size > 1) throw new Error('선택 설계 1개의 좌표만 불러오세요. 여러 design_id가 섞여 있습니다.');
      const lines = rows.slice(1).map((r, i) => ({ id: field(r, 'line_id') || `L${i + 1}`, a: { x: number(field(r, 'x_start_mm')), y: number(field(r, 'y_start_mm')) }, b: { x: number(field(r, 'x_end_mm')), y: number(field(r, 'y_end_mm')) } }));
      return { lines: validateLines(lines), designId: [...designIds][0] ?? null, exactCoordinates: true, source: '노트북 절단 좌표 CSV' };
    }
    let design;
    if (['w_mm', 'h_mm', 'theta_deg'].every(h => headers.includes(h))) {
      if (rows.length !== 2) throw new Error('설계 CSV는 선택한 설계 1개만 포함해야 합니다.');
      design = { w: number(field(rows[1], 'w_mm')), h: number(field(rows[1], 'h_mm')), theta: number(field(rows[1], 'theta_deg')) };
    } else {
      const columns = Object.fromEntries(rows.slice(1).map(r => [r[0], r[1]]));
      if (['w_mm', 'h_mm', 'theta_deg'].every(h => h in columns)) design = { w: number(columns.w_mm), h: number(columns.h_mm), theta: number(columns.theta_deg) };
    }
    if (!design) throw new Error('노트북의 selected_design.csv 또는 selected_cut_line_coordinates.csv 형식이 필요합니다.');
    return { ...generateLayout(design), source: '노트북 선택 설계 CSV' };
  }
  function parseInput(text) {
    if (typeof text !== 'string' || text.length > 2000000) throw new Error('입력 파일은 2 MB 이하로 불러오세요.');
    text = text.replace(/^\uFEFF/, '').trim();
    if (!text.startsWith('{')) return parseCSV(text);
    let job; try { job = JSON.parse(text); } catch { throw new Error('JSON 형식이 올바르지 않습니다.'); }
    if (!['kaistone.cut-job.v1','kaistone.motor-job.v2'].includes(job.schema)) throw new Error('8.5단계에서 내보낸 JSON이 필요합니다.');
    if (job.slab?.width_mm !== 300 || job.slab?.height_mm !== 60 || job.coordinate_system !== 'slab-bottom-left-mm') throw new Error('소재 300×60 mm, 좌하단 원점 좌표만 지원합니다.');
    if (!Array.isArray(job.cut_lines)) throw new Error('JSON에 cut_lines 배열이 없습니다.');
    const lines = validateLines(job.cut_lines.map(l => ({ id: l.line_id, a: { x: l.x_start_mm, y: l.y_start_mm }, b: { x: l.x_end_mm, y: l.y_end_mm } })));
    const design = job.design ? { w: job.design.w_mm, h: job.design.h_mm, theta: job.design.theta_deg } : undefined;
    if (design) { finite(design.w, 1, 300, '유닛 폭'); finite(design.h, 1, 60, '유닛 높이'); finite(design.theta, .001, 90, '유닛 각도'); }
    const inputPpm = job.drive?.x_pulses_per_mm ?? job.drive?.pulses_per_mm;
    const drives = job.drive ? { lead: job.drive.x_lead_mm_per_rev, pulsesPerRev: job.drive.pulses_per_rev, ...(inputPpm ? {pulsesPerMm:inputPpm} : {}) } : undefined;
    if (drives) motorMove(0, 0, 0, drives);
    const layout = { lines, design, designId: job.design_id ?? null, exactCoordinates: true, recommendedDrive: drives, source: job.schema === 'kaistone.motor-job.v2' ? 'Python 모터 펄스 입력' : '코랩 선택 설계 JSON' };
    if (job.schema === 'kaistone.motor-job.v2') { layout.motorProgram = job.motor_plan; importedMotorPlan(layout); }
    return layout;
  }
  function motorCSV(plan) {
    const rows = [['pass','line_id','head','table_rotation_deg','from_x_home_mm','target_x_home_mm','command_target_x_home_mm','move_mm','from_pulses_from_home','signed_pulses','target_pulses_from_home','quantization_error_mm','axis','requested_slab_deg','slab_angle_error_deg','motor_name','requested_pulses','release_adjusted','release_minimum_pulses','layout_rotation_deg','requested_layout_deg','zero_angle_half_turn','nominal_requested_pulses','computed_target_pulses','command_correction_pulses','calibration_source','bench_reference_id']];
    for (const p of plan.passes) {
      if (p.rotaryMotor) { const m=p.rotaryMotor; rows.push([p.index+1,'','SLAB',p.rotation,'','','','',m.fromPulse,m.pulses,m.targetPulse,'','ROTARY',m.requestedAngleDeg,m.errorDeg,'SLAB',m.requestedPulse??'',m.releaseAdjusted??false,m.releaseMinimumPulses??0,p.displayRotation??p.rotation,m.requestedLayoutAngleDeg??m.requestedAngleDeg,m.zeroAngleHalfTurn??false,'','','','','']); }
      for (const m of p.motorMoves) rows.push([p.index + 1, m.lineId || '', `H${m.head}`, p.rotation, m.fromMm, m.targetMm, m.targetQuantizedMm, m.distanceMm, m.fromPulse, m.pulses, m.targetPulse, m.errorMm,'X','','',m.motorName??MOTOR_NAMES[m.head-1],m.requestedPulse??'',m.releaseAdjusted??false,m.releaseMinimumPulses??0,p.displayRotation??p.rotation,p.requestedRotation,p.rotaryMotor?.zeroAngleHalfTurn??false,m.nominalRequestedPulse??m.requestedPulse??'',m.computedTargetPulse??m.targetPulse,m.commandCorrectionPulses??0,m.calibrationSource??'coordinate',m.benchReferenceId??'']);
    }
    return '\uFEFF' + rows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  }
  const api = { generateLayout, createPlan, sample, report, rotate, parseCSV, parseInput, motorMove, motorCSV, HOME_Y, HOME_X, LIMIT_X, MOTOR_NAMES, MEASURED_DRIVE, ROTARY_DRIVE, EDGE_THRESHOLD_MM, pulsesPerMm, releasePulse, usesCurrentCalibration, assessReachability };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  scope.FactorySimulation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
