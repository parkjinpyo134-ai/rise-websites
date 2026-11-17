/* Playback of the real model timeline; no geometry or motor calculation here. */
(function (scope) {
  'use strict';
  function create({onChange, requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame}) {
    let plan, elapsed = 0, playing = false, speed = 1, mode = 'full', selected = 0;
    let frame = null, previous = null, pendingPass = false;
    const snapshot = () => ({elapsed, playing, speed, mode, selected});
    const emit = () => onChange(snapshot());
    function cancel() { if (frame !== null) cancelFrame(frame); frame = null; previous = null; }
    function tick(now) {
      frame = null;
      if (!playing) return;
      if (previous !== null) {
        const end = mode === 'initialize' || pendingPass ? plan.initializationEnd : mode === 'pass' ? plan.passes[selected].end : plan.duration;
        elapsed = Math.min(end, elapsed + Math.min((now - previous) / 1000, .1) * speed);
        if (elapsed >= end) {
          if (pendingPass) { pendingPass = false; elapsed = plan.passes[selected].start; }
          else playing = false;
        }
      }
      previous = now; emit();
      if (playing) frame = requestFrame(tick);
    }
    function start() { cancel(); playing = true; emit(); frame = requestFrame(tick); }
    const api = {
      snapshot,
      setPlan(value) { cancel(); plan = value; elapsed = 0; playing = false; selected = 0; mode = 'full'; pendingPass = false; emit(); },
      full() {
        if (playing && mode === 'full') { api.pause(); return; }
        if (mode !== 'full' || elapsed >= plan.duration) elapsed = 0;
        mode = 'full'; pendingPass = false; start();
      },
      pass() {
        if (!plan.passes.length) return;
        if (playing && mode === 'pass') { api.pause(); return; }
        if (mode !== 'pass' || elapsed >= plan.passes[selected].end) {
          pendingPass = elapsed < plan.initializationEnd;
          elapsed = pendingPass ? 0 : plan.passes[selected].start;
        }
        mode = 'pass'; start();
      },
      initialize() {
        if (playing && mode === 'initialize') { api.pause(); return; }
        if (mode !== 'initialize' || elapsed >= plan.initializationEnd) elapsed = 0;
        mode = 'initialize'; pendingPass = false; start();
      },
      pause() { cancel(); playing = false; emit(); },
      reset() { cancel(); playing = false; elapsed = 0; mode = 'full'; pendingPass = false; emit(); },
      select(index) {
        cancel(); playing = false; pendingPass = false; mode = 'preview';
        selected = Math.max(0, Math.min(plan.passes.length - 1, index));
        if (elapsed >= plan.initializationEnd) elapsed = plan.passes[selected]?.start ?? plan.initializationEnd;
        emit();
      },
      seek(time) { cancel(); playing = false; mode = 'preview'; pendingPass = false; elapsed = Math.max(plan.initializationEnd, Math.min(plan.duration, time)); emit(); },
      speed(value) { if (Number.isFinite(value) && value > 0) speed = value; previous = null; emit(); }
    };
    return api;
  }
  scope.RisePlayback = {create};
  if (typeof module !== 'undefined') module.exports = scope.RisePlayback;
})(globalThis);
