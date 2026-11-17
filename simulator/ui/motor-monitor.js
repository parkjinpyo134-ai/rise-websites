/* Presentation only: internal X− pulses become positive motor4 HIGH counts. */
(function (scope) {
  'use strict';
  const $ = id => document.getElementById(id);
  const names = ['Orange','Red','Yellow','Pink'];
  const colors = ['#fd7e14','#fa5252','#ffd43b','#e64980'];
  const number = value => value == null ? '—' : (value === 0 ? 0 : value).toLocaleString('ko-KR');
  let rows;
  function mount() {
    rows = names.map((name, i) => {
      const row = document.createElement('tr');
      const cells = Array.from({length:8}, () => row.appendChild(document.createElement('td')));
      const dot = document.createElement('i'); dot.style.background = colors[i];
      cells[0].append(dot, name); $('motor-rows').append(row); return {row,cells};
    });
  }
  function render(plan, state, selected, passComplete = false) {
    const pass = passComplete || !state.initialized ? plan.passes[selected] : state.pass;
    const homing = state.operation.kind.startsWith('x_home') || state.initializing;
    const reference = state.operation.kind === 'x_home_reference' || state.operation.kind === 'init_reference' || state.complete || passComplete;
    $('motor-title').textContent = `모터 펄스 · ${pass?.index >= 0 ? pass.index + 1 : selected + 1}차 왕복`;
    rows.forEach(({row,cells}, i) => {
      const head = state.heads[i], move = pass?.motorMoves?.[i];
      const position = reference ? 0 : homing ? null : head.motor ? -head.motor.positionPulse : null;
      const target = reference || homing ? 0 : Math.round((plan.homeX[i] - state.operation.toX[i]) * scope.FactorySimulation.pulsesPerMm(plan.drive));
      const values = [move?.lineId || '대기', number(position), number(target), homing && !reference ? '리미트 감지까지' : number(position == null ? null : Math.abs(target-position)), number(-(move?.targetPulse ?? 0)), (head.referencedX ?? 0).toFixed(3), state.complete || passComplete ? '원점 대기' : head.state];
      values.forEach((v,j) => { if(cells[j+1].textContent !== String(v)) cells[j+1].textContent = v; });
      row.classList.toggle('engaged', head.active);
      const sw = $(`switch-${i}`); sw.classList.toggle('on',head.limitActive); sw.textContent = `${names[i]} · ${head.limitActive?'ON':'OFF'}`;
    });
    const rotary = pass?.rotaryMotor;
    const slabHoming = state.operation.kind.startsWith('slab_home');
    const currentPulse = slabHoming ? '탐색 중' : `${number(state.rotaryPulse ?? 0)}펄스`;
    $('table-angle').textContent = `${state.rotation.toFixed(2)}° · ${currentPulse}`;
    $('rotary-readout').textContent = slabHoming ? '역방향 복귀 → 실제 0° 리미트 감지' : rotary ? `작업 목표 ${(rotary.targetLayoutAngleDeg ?? pass.displayRotation ?? pass.rotation).toFixed(2)}° · 실제 목표 ${rotary.targetAngleDeg.toFixed(2)}° / ${number(rotary.targetPulse)}펄스${pass.rotaryHomedBeforeMove?' · 회전 전 Initialize':' · 각도 유지'}` : '실제 0° 원점에서 대기';
    $('gantry-y').textContent = `갠트리 Y ${state.y.toFixed(1)} mm`;
    $('active-count').textContent = `${state.heads.filter(h=>h.active).length}개 펜 접촉`;
  }
  scope.RiseMotorMonitor = {mount,render};
})(globalThis);
