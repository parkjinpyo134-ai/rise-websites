const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPlan, sample, report, rotate, parseCSV, HOME_Y, HOME_X, LIMIT_X } = require('./model.js');
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('Initialize seeks switches, backs off, relatches and establishes X references only', () => {
  const p = createPlan();
  assert.equal(sample(p, 0).initialized, false);
  assert.deepEqual(p.operations.filter(o => o.passIndex === -1).map(o => o.kind), ['slab_home_seek','slab_home_reference','init_lift', 'init_seek', 'init_contact', 'init_backoff', 'init_latch', 'init_reference', 'init_release']);
  for (const op of p.operations.filter(o => o.passIndex === -1)) {
    const s = sample(p, (op.start + op.end) / 2);
    near(s.y, HOME_Y); near(s.rotation, 0);
    assert.equal(s.initialized, false); assert.equal(s.completedLines, 0);
    assert.ok(s.heads.every(h => !h.active && h.referencedX === null));
    if (['init_contact', 'init_reference'].includes(op.kind)) s.heads.forEach((h, i) => { near(h.x, LIMIT_X[i]); assert.equal(h.limitActive, true); });
  }
  const ready = sample(p, p.initializationEnd);
  assert.equal(ready.initialized, true); assert.equal(ready.completedLines, 0);
  ready.heads.forEach((h, i) => { near(h.x, HOME_X[i]); near(h.referencedX, 0); assert.equal(h.limitActive, true); });
});

test('unselected blades stay at X reference throughout all passes while following gantry Y', () => {
  for (const enabledHeads of [[1], [2, 4], [1, 3, 4]]) {
    const p = createPlan({ enabledHeads }); let observedYMotion = false;
    for (let i = 0; i <= 1000; i++) {
      const s = sample(p, p.initializationEnd + (p.duration - p.initializationEnd) * i / 1000);
      for (const h of s.heads.filter(h => !enabledHeads.includes(h.head))) {
        near(h.x, HOME_X[h.head - 1]); near(h.referencedX, 0); near(h.y, s.y);
        assert.equal(h.active, false); assert.equal(h.state, '원점 대기 · 고정');
        if (Math.abs(h.y - HOME_Y) > 1) observedYMotion = true;
      }
    }
    assert.ok(observedYMotion);
  }
});

test('unused members of a partial batch park at their X references during cutting', () => {
  const p = createPlan();
  for (const pass of p.passes.filter(p => p.cutIds.length < 4)) {
    const s = sample(p, (pass.cutStart + pass.cutEnd) / 2);
    s.heads.filter(h => !h.cutId).forEach(h => { near(h.x, HOME_X[h.head - 1]); near(h.referencedX, 0); assert.equal(h.active, false); });
  }
  assert.equal(report(p, sample(p, 0)).initialization.complete, false);
  assert.equal(report(p, sample(p, p.initializationEnd)).initialization.complete, true);
});

test('default layout: 2 horizontal + 9 vertical lines, display 90° then 0°, physical 90° then 180°', () => {
  const p = createPlan();
  assert.equal(p.horizontalCount, 2); assert.equal(p.slantedCount, 9);
  assert.deepEqual(p.passes.map(p => p.cutIds.length), [2, 4, 4, 1]);
  assert.deepEqual(p.passes.map(p => p.rotation), [90, 180, 180, 180]);
  assert.deepEqual(p.passes.map(p => p.displayRotation), [90, 0, 0, 0]);
  assert.equal(p.layout.units, 30); near(p.layout.yield, 1); assert.equal(p.notebookPasses, 4);
  assert.equal(new Set(p.passes.flatMap(p => p.cutIds)).size, 11);
});
test('masked heads produce additional passes and no disabled head ever cuts', () => {
  for (const enabledHeads of [[1], [2, 4], [1, 3, 4]]) {
    const p = createPlan({ enabledHeads });
    assert.equal(p.passes.length, Math.ceil(2 / enabledHeads.length) + Math.ceil(9 / enabledHeads.length));
    for (let i = 0; i <= 400; i++) for (const head of sample(p, p.duration * i / 400).heads) {
      if (!enabledHeads.includes(head.head)) { assert.equal(head.active, false); assert.equal(head.cutId, null); }
    }
  }
});
test('presets obey direction-specific grouping and six-pass warning', () => {
  const slanted = createPlan({ w: 40, h: 20, theta: 70 });
  assert.equal(slanted.passes.length, 3); assert.deepEqual(slanted.passes.map(p => p.requestedRotation), [90, 20, 20]);
  assert.deepEqual(slanted.passes.map(p => p.rotaryMotor.targetPulse),[610,136,136]);
  const dense = createPlan({ w: 20, h: 10, theta: 90 });
  assert.equal(dense.passes.length, 6); assert.ok(!dense.warnings.some(w=>w.includes('6회')));
  const reduced = createPlan({ w: 20, h: 10, theta: 90, enabledHeads: [1, 2] });
  assert.equal(reduced.passes.length, 10); assert.ok(reduced.warnings.some(w => w.includes('6회')));
});
test('actual rotated paths align with machine Y; deviation includes pulse rounding and release clamp', () => {
  for (const theta of [15, 33.1, 45, 70, 89.999, 90]) {
    const p = createPlan({ w: 25, h: 10, theta });
    for (const c of p.cuts) {
      const a = rotate(c.localStart.x, c.localStart.y, c.rotation), b = rotate(c.localEnd.x, c.localEnd.y, c.rotation);
      near(a.x, c.x); near(b.x, c.x); near(a.y, c.high); near(b.y, c.low);
      const move=p.passes[c.passIndex].motorMoves[c.head-1],bound=c.alignmentErrorMm+Math.abs(move.errorMm)+1e-6;
      for (const v of [c.localStart, c.localEnd]) { assert.ok(Math.abs(v.x) <= 150 + bound); assert.ok(Math.abs(v.y) <= 30 + bound); }
    }
  }
});
test('cuts accumulate across rotations and passes; only in-material heads engage', () => {
  const p = createPlan({ w: 40, h: 20, theta: 70 }); let previous = p.cuts.map(() => 0);
  for (let i = 0; i <= 1500; i++) {
    const s = sample(p, p.duration * i / 1500);
    s.cuts.forEach((c, j) => { assert.ok(c.completedLength >= previous[j] - 1e-8); assert.ok(c.completedLength <= c.length + 1e-8); previous[j] = c.completedLength; });
    for (const h of s.heads) if (h.active) { const c = s.cuts.find(c => c.id === h.cutId); assert.equal(s.operation.kind, 'cut'); assert.ok(s.y >= c.low && s.y <= c.high); }
    // Paired pens now share their home X coordinate; retain left-to-right order.
    for (let j = 1; j < 4; j++) assert.ok(s.heads[j].x >= s.heads[j - 1].x - 1e-8);
    if (s.operation.kind === 'rotate') { near(s.y, HOME_Y); assert.ok(s.heads.every(h => !h.active)); }
  }
  const rotation = sample(p, p.passes[1].start + .1);
  assert.equal(rotation.completedLines, 2);
  near(rotation.cuts.filter(c => c.family === 'horizontal').reduce((sum, c) => sum + c.completedLength, 0), 600);
});
test('operation boundaries preserve carriage, gantry and table continuity', () => {
  const p = createPlan({ w: 20, h: 10, theta: 70, enabledHeads: [2, 4] });
  for (const op of p.operations) {
    const a = sample(p, op.end - 1e-8), b = sample(p, op.end + 1e-8);
    near(a.y, b.y, 1e-4); near(a.rotation, b.rotation, 1e-4);
    a.heads.forEach((h, i) => near(h.x, b.heads[i].x, 1e-4));
  }
});
test('reverse order preserves all original cuts', () => {
  const p = createPlan({ order: 'slanted-first' });
  assert.deepEqual(p.passes.map(p => p.rotation), [180, 180, 180, 90]);
  assert.deepEqual(p.passes.map(p => p.displayRotation), [0, 0, 0, 90]);
  assert.deepEqual(p.cuts.map(c => c.id).sort(), createPlan().cuts.map(c => c.id).sort());
});
test('CSV supports notebook coordinates and both selected-design export shapes', () => {
  const csv = '\uFEFFline_id,x_start_mm,y_start_mm,x_end_mm,y_end_mm\r\n"H001",0,20,300,20\r\nS001,60,60,60,0\r\n';
  const p = createPlan({ layout: parseCSV(csv) }); assert.equal(p.passes.length, 2); assert.equal(p.cuts.length, 2);
  for (const design of ['w_mm,h_mm,theta_deg\n30,20,90\n', ',0\nw_mm,30\nh_mm,20\ntheta_deg,90\n']) assert.equal(createPlan({ layout: parseCSV(design) }).cuts.length, 11);
});
test('invalid, ambiguous and duplicate CSV/settings are rejected', () => {
  for (const csv of ['x_start_mm,y_start_mm,x_end_mm,y_end_mm\n,0,10,10', 'x_start_mm,y_start_mm,x_end_mm,y_end_mm\n0,0,301,60', 'w_mm,h_mm,theta_deg\n30,20,90\n40,20,70', 'foo,bar\n1,2', 'x_start_mm,y_start_mm,x_end_mm,y_end_mm\n0,20,300,20\n300,20,0,20']) assert.throws(() => parseCSV(csv));
  for (const options of [{ enabledHeads: [] }, { enabledHeads: [1, 1] }, { w: NaN }, { theta: 0 }, { feed: Infinity }, { order: 'unknown' }]) assert.throws(() => createPlan(options));
  assert.throws(() => sample(createPlan(), NaN));
});
test('seek/export distinguish planned, partially cut and completed work', () => {
  const p = createPlan(), initial = report(p, sample(p, 0));
  assert.equal(initial.total_completed_cut_length_mm, 0); assert.equal(initial.completed_passes, 0);
  const midway = sample(p, (p.passes[0].cutStart + p.passes[0].cutEnd) / 2);
  near(midway.cuts.filter(c => c.passIndex === 0).reduce((sum, c) => sum + c.completedLength, 0), 300);
  assert.equal(midway.cuts.filter(c => c.passIndex > 0).reduce((sum, c) => sum + c.completedLength, 0), 0);
  const final = report(p, sample(p, p.duration + 100));
  assert.equal(final.complete, true); assert.equal(final.completed_passes, 4); assert.equal(final.completed_lines, 11);
  near(final.total_completed_cut_length_mm, 1140);
  final.cuts.forEach(c => { near(c.completed_length_mm, c.planned_length_mm); assert.deepEqual(c.completed_end, c.planned_end); });
  near(sample(p, p.duration).y, HOME_Y); assert.equal(sample(p, 0).completedLines, 0);
});
