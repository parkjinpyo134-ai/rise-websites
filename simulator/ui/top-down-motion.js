/* Y traversal policy for the screen-down top view. X/rotary commands and the
   slab geometry stay untouched; every stroke starts above and returns above. */
(function (scope) {
  'use strict';
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const lerp = (a,b,t) => a+(b-a)*t;
  function project(plan, source) {
    const homeY = -Math.abs(plan.operations[0].fromY);
    const op = source.operation, pass = plan.passes[op.passIndex];
    let fromY = homeY, toY = homeY;
    if (pass) {
      if (op.kind === 'approach') toY = pass.endY;
      else if (op.kind === 'cut') { fromY = pass.endY; toY = pass.startY; }
      else if (op.kind === 'lift') fromY = toY = pass.startY;
      else if (op.kind === 'return') fromY = pass.startY;
    }
    const t = clamp((source.elapsed-op.start)/op.duration,0,1);
    const u = op.kind === 'cut' ? t : t*t*(3-2*t);
    const y = lerp(fromY,toY,u);
    const cuts = source.cuts.map(c => {
      const p = plan.passes[c.passIndex];
      const cuttingY = p.endY + Math.max(0,source.elapsed-c.cutStart)*plan.feed;
      const completedLength = source.elapsed <= c.cutStart ? 0 : clamp(cuttingY-c.low,0,c.length);
      const fraction = completedLength/c.length;
      const localStart = c.localEnd, localEnd = c.localStart;
      return {...c, strokeStartY:p.endY, localStart, localEnd, completedLength,
        localEndDone:{x:lerp(localStart.x,localEnd.x,fraction),y:lerp(localStart.y,localEnd.y,fraction)}};
    });
    const heads = source.heads.map(h => {
      const cut = cuts.find(c=>c.id===h.cutId);
      const active = !source.complete && op.kind === 'cut' && !!cut && y>=cut.low && y<=cut.high;
      let state = h.state;
      if (!source.initializing && cut && !op.kind.startsWith('x_home')) {
        state = active ? '절단 중' : cut.completedLength>=cut.length-1e-7 ? '완료 · 상승' : op.kind==='position' ? '재배치' : '대기 · 상승';
      }
      return {...h,y,active,state};
    });
    return {...source,y,heads,cuts,operation:{...op,fromY,toY},
      completedLines:cuts.filter(c=>c.completedLength>=c.length-1e-7).length,
      traversalDirection:'top-to-bottom-and-back'};
  }
  scope.RiseTopDownMotion = {project};
  if(typeof module!=='undefined')module.exports=scope.RiseTopDownMotion;
})(globalThis);
