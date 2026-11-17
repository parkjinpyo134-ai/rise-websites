/* Pure SVG presentation for FactorySimulation plans and sampled states.
   Screen Y points down. Only this projection changes; no motor values do. */
(function (global) {
  'use strict';
  const VIEW = Object.freeze({
    width: 620, height: 430, centerX: 306, centerY: 214,
    materialScale: 0.72, penScale: 0.8, frameWidthMm: 500,
    frameTop: 38, frameBottom: 390, turntableRadius: 27
  });
  const COLORS = Object.freeze(['#fd7e14', '#fa5252', '#ffd43b', '#e64980']);
  const NAMES = Object.freeze(['Orange', 'Red', 'Yellow', 'Pink']);
  const mounted = new WeakMap();
  const number = value => Math.round(value * 1000000) / 1000000;
  const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const safeUid = value => String(value || 'machine').replace(/[^a-zA-Z0-9_-]/g, '') || 'machine';
  const pointOK = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
  const rawToLocal = p => ({x:p.x - 150, y:p.y - 30});
  const screenPoint = p => ({x:VIEW.centerX + p.x * VIEW.materialScale, y:VIEW.centerY + p.y * VIEW.materialScale});
  const slabTransform = angle => `translate(${VIEW.centerX} ${VIEW.centerY}) rotate(${number(angle)}) scale(${VIEW.materialScale})`;
  const gantryY = state => VIEW.centerY + state.y * VIEW.materialScale - 12 * VIEW.penScale;

  function line(a, b, color, width, attributes = '') {
    if (!pointOK(a) || !pointOK(b)) return '';
    return `<line x1="${number(a.x)}" y1="${number(a.y)}" x2="${number(b.x)}" y2="${number(b.y)}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" vector-effect="non-scaling-stroke" ${attributes}/>`;
  }

  function inputs(options) {
    const {plan, state} = options;
    if (!plan || !state || !Array.isArray(state.heads) || !Array.isArray(state.cuts) || !Number.isFinite(state.rotation) || !Number.isFinite(state.y)) {
      throw new TypeError('RiseMachineView requires a real simulation plan and sampled state.');
    }
    if (!global.RiseMachineSkin || !global.RiseSlabSurface) throw new Error('Load machine-skin.js and slab-surface.js before machine-view.js.');
    return {...options, plan, state, layout:options.layout || plan.layout || {},
      uid:safeUid(options.uid || options.svg?.id), showPaths:options.showPaths !== false, showGrid:options.showGrid !== false};
  }

  function plannedLines({plan, layout, state, showPaths}) {
    if (!showPaths) return '';
    const skipped = new Set((plan.skippedLines || []).map(c => c.id));
    const active = new Set(state.pass?.cutIds || []);
    return (layout.lines || []).map(c => {
      if (!pointOK(c.a) || !pointOK(c.b)) return '';
      const isSkipped = skipped.has(c.id), isActive = active.has(c.id) && !state.initializing;
      return line(rawToLocal(c.a), rawToLocal(c.b), isSkipped ? '#fd7e14' : isActive ? '#228be6' : '#74c0fc',
        isActive ? 1.3 : 0.9, `data-planned-line="${escape(c.id)}" stroke-dasharray="${isSkipped ? '2 4' : '4 3'}" opacity="${isSkipped ? 0.65 : isActive ? 1 : 0.8}"`);
    }).join('');
  }

  function cutTraces(state) {
    // These points include quantization and imported per-motor corrections.
    // Never replace them with the ideal layout's endpoints or inferred pulses.
    return state.cuts.filter(c => c.completedLength > 1e-9).map(c => {
      const current = c.passIndex === state.passIndex && state.operation?.kind === 'cut' && !state.complete;
      return line(c.localStart, c.localEndDone, current ? '#12b886' : '#228be6', current ? 2 : 1.6,
        `data-completed-cut="${escape(c.id)}" data-completed-mm="${number(c.completedLength)}"`);
    }).join('');
  }

  function penPose(head, state) {
    const point = screenPoint({x:head.x, y:head.y ?? state.y});
    // A small raised-body stagger makes coincident parked pens visible. Their
    // X positions and the active pen's tip remain at the sampled coordinates.
    const overlaps = head.active ? 0 : state.heads.filter(other => other.head < head.head && !other.active && Math.abs(other.x - head.x) * VIEW.materialScale < 7).length;
    const lift = head.active ? 0 : 4 + overlaps * 13;
    return {point, x:point.x, y:point.y - 12 * VIEW.penScale - lift, lift};
  }

  function headsMarkup({uid, state}) {
    return state.heads.map((head, index) => {
      if (!Number.isFinite(head.x) || !Number.isFinite(head.y ?? state.y)) return '';
      const i = Math.max(0, Math.min(3, head.head - 1)), pose = penPose(head, state);
      const name = head.motorName || NAMES[i];
      return `<g data-live-head="${index}" data-head="${head.head}" data-machine-x="${number(head.x)}" data-machine-y="${number(head.y ?? state.y)}" data-display-lift="${pose.lift}" transform="translate(${number(pose.x)} ${number(pose.y)})" opacity="${head.active ? 1 : 0.92}">
        ${global.RiseMachineSkin.pen({uid,x:0,y:0,color:COLORS[i],name,scale:VIEW.penScale})}</g>
        <circle data-live-contact="${index}" cx="${number(pose.point.x)}" cy="${number(pose.point.y)}" r="3.1" fill="#12b886" fill-opacity="0.16" stroke="#12b886" stroke-width="0.7" visibility="${head.active ? 'visible' : 'hidden'}"/>`;
    }).join('');
  }

  function switchesMarkup({plan, state}) {
    return state.heads.map((head, index) => {
      const homeX = plan.limitX?.[index] ?? plan.homeX?.[index] ?? head.homeX;
      if (!Number.isFinite(homeX)) return '';
      const x = VIEW.centerX + homeX * VIEW.materialScale;
      const overlaps = state.heads.slice(0, index).filter((_, i) => Math.abs((plan.limitX?.[i] ?? plan.homeX?.[i]) - homeX) * VIEW.materialScale < 6).length;
      const y = -35 - overlaps * 8;
      return `<g data-limit-switch="${index}" data-home-x="${number(homeX)}">
        <line x1="${number(x)}" y1="${y + 5}" x2="${number(x)}" y2="-22" stroke="#adb5bd" stroke-width="0.65"/>
        <rect x="${number(x - 2.3)}" y="${y}" width="4.6" height="5" rx="0.65" fill="#dee2e6" stroke="#868e96" stroke-width="0.6"/>
        <rect data-live-limit="${index}" x="${number(x - 1.3)}" y="${y + 1}" width="2.6" height="3" rx="0.3" fill="${head.limitActive ? '#40c057' : '#868e96'}"/>
      </g>`;
    }).join('');
  }

  function content(options) {
    const o = inputs(options), {uid, state, showGrid, showPaths} = o;
    const skin = global.RiseMachineSkin, surface = global.RiseSlabSurface;
    const frameWidth = VIEW.frameWidthMm * VIEW.materialScale;
    const titleId = `rise-machine-title-${uid}`, descId = `rise-machine-description-${uid}`;
    return `<title id="${titleId}">4개 붓펜 스마트 팩토리 평면도</title>
      <desc id="${descId}">불러온 설계의 절단선, 실제 모터 계획의 펜 위치와 완료 경로입니다. 색 띠로 네 펜을 구분합니다.</desc>
      <defs>${skin.defs(uid)}${surface.defs(uid)}
        <pattern id="rise-machine-grid-${uid}" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="10" cy="10" r="0.7" fill="#dee2e6"/></pattern>
      </defs>
      <rect width="${VIEW.width}" height="${VIEW.height}" fill="#f8f9fa"/>
      <rect width="${VIEW.width}" height="${VIEW.height}" fill="#f4fce3" opacity="0.24"/>
      ${showGrid ? `<rect data-machine-grid x="20" y="8" width="580" height="420" fill="url(#rise-machine-grid-${uid})"/>` : ''}
      ${skin.frame({uid,cx:VIEW.centerX,width:frameWidth,top:VIEW.frameTop,bottom:VIEW.frameBottom})}
      ${skin.table({uid,cx:VIEW.centerX,cy:VIEW.centerY,radius:VIEW.turntableRadius})}
      <g data-live-slab data-rotation-deg="${number(state.rotation)}" transform="${slabTransform(state.rotation)}">
        ${surface.render({uid,cx:0,cy:0,scale:1,angle:0,tiles:surface.products(o.layout),outlines:showPaths})}
        <g data-live-planned>${plannedLines(o)}</g>
        <g data-live-traces>${cutTraces(state)}</g>
      </g>
      <g data-live-gantry data-machine-y="${number(state.y)}" transform="translate(0 ${number(gantryY(state))})">
        ${skin.gantry({uid,left:VIEW.centerX - frameWidth / 2 + 19,width:frameWidth - 38,y:0})}
        ${switchesMarkup(o)}
      </g>
      <g data-live-heads>${headsMarkup(o)}</g>
      ${skin.controller({uid,cx:VIEW.centerX,top:398,width:86,height:26})}`;
  }

  function render(options) {
    const o = inputs(options), {svg, plan, layout, state, uid, showPaths, showGrid} = o;
    if (!svg || typeof svg.setAttribute !== 'function' || typeof svg.querySelector !== 'function') throw new TypeError('render requires an SVG element.');
    let cache = mounted.get(svg);
    const rebuild = !cache || cache.plan !== plan || cache.layout !== layout || cache.uid !== uid || cache.showPaths !== showPaths || cache.showGrid !== showGrid || cache.headCount !== state.heads.length;
    if (rebuild) {
      svg.setAttribute('viewBox', `0 0 ${VIEW.width} ${VIEW.height}`);
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-labelledby', `rise-machine-title-${uid} rise-machine-description-${uid}`);
      svg.innerHTML = content(o);
      cache = {plan,layout,uid,showPaths,showGrid,headCount:state.heads.length,
        slab:svg.querySelector('[data-live-slab]'),gantry:svg.querySelector('[data-live-gantry]'),
        planned:svg.querySelector('[data-live-planned]'),traces:svg.querySelector('[data-live-traces]'),
        heads:state.heads.map((_, i) => svg.querySelector(`[data-live-head="${i}"]`)),
        contacts:state.heads.map((_, i) => svg.querySelector(`[data-live-contact="${i}"]`)),
        limits:state.heads.map((_, i) => svg.querySelector(`[data-live-limit="${i}"]`)),
        passIndex:state.passIndex,initializing:state.initializing,traceMarkup:cutTraces(state)};
      mounted.set(svg, cache);
    } else {
      // Retain the detailed frame/material DOM; animation touches only live
      // transforms and completed segments rather than rebuilding all hardware.
      cache.slab.setAttribute('transform', slabTransform(state.rotation));
      cache.slab.setAttribute('data-rotation-deg', number(state.rotation));
      cache.gantry.setAttribute('transform', `translate(0 ${number(gantryY(state))})`);
      cache.gantry.setAttribute('data-machine-y', number(state.y));
      if (cache.passIndex !== state.passIndex || cache.initializing !== state.initializing) {
        cache.planned.innerHTML = plannedLines(o);
        cache.passIndex = state.passIndex; cache.initializing = state.initializing;
      }
      const traceMarkup = cutTraces(state);
      if (cache.traceMarkup !== traceMarkup) { cache.traces.innerHTML = traceMarkup; cache.traceMarkup = traceMarkup; }
      state.heads.forEach((head, index) => {
        const node = cache.heads[index], contact = cache.contacts[index], limit = cache.limits[index];
        if (!node) return;
        const pose = penPose(head, state);
        node.setAttribute('transform', `translate(${number(pose.x)} ${number(pose.y)})`);
        node.setAttribute('data-machine-x', number(head.x));
        node.setAttribute('data-machine-y', number(head.y ?? state.y));
        node.setAttribute('data-display-lift', pose.lift);
        node.setAttribute('opacity', head.active ? '1' : '0.92');
        if (contact) {
          contact.setAttribute('cx', number(pose.point.x)); contact.setAttribute('cy', number(pose.point.y));
          contact.setAttribute('visibility', head.active ? 'visible' : 'hidden');
        }
        if (limit) limit.setAttribute('fill', head.limitActive ? '#40c057' : '#868e96');
      });
    }
    return svg;
  }

  // markup is useful for deterministic previews/tests without constructing DOM.
  global.RiseMachineView = {render, markup:content, view:VIEW};
})(typeof globalThis !== 'undefined' ? globalThis : this);
