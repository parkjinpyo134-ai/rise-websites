(function (scope) {
  'use strict';
  const $ = id => document.getElementById(id);
  function render(plan, onSelect) {
    const model = scope.FactorySimulation;
    $('source-label').textContent = plan.layout.designId != null ? `설계 ${String(plan.layout.designId).padStart(2,'0')} · ${plan.pythonMotorProgram?'Python 모터 계획':plan.layout.source}` : plan.layout.source;
    const d = plan.layout.design;
    $('design-meta').textContent = d ? `${d.w.toFixed(2)} × ${d.h.toFixed(2)} mm · 형상 각도 ${d.theta.toFixed(2)}°` : '입력 절단 좌표 기준';
    $('schedule-summary').textContent = `${plan.passes.length} 왕복`;
    $('line-summary').textContent = `${plan.cuts.length} 절단선`;
    $('yield-summary').textContent = plan.layout.units == null ? '입력 좌표 적용' : `${plan.layout.units}개 유닛 · 수율 ${(plan.layout.yield*100).toFixed(1)}%`;
    $('drive-summary').textContent = `X ${model.pulsesPerMm(plan.drive).toFixed(6)} 펄스/mm · ${plan.drive.pulsesPerRev.toLocaleString()}펄스/회전 · ${plan.benchReference?'설계별 실측 명령':model.usesCurrentCalibration(plan)?'최신 실측 보정':'불러온 보정 기준'}`;
    $('calibration-detail').textContent = `원점 X (Orange·Red·Yellow·Pink): ${plan.homeX.map(n=>n.toFixed(6)).join(' / ')} mm. 작업각 0°는 실제180°=1220펄스. X 최소 ${plan.drive.minReleasePulses??0}펄스, 회전 최소 ${plan.rotaryDrive?.minReleasePulses??0}펄스. Y축 펄스 계산 제외.`;
    const warnings = [...plan.warnings];
    if (plan.pythonMotorProgram && !model.usesCurrentCalibration(plan)) warnings.push('이전 보정 JSON입니다. 파일에 기록된 원점·펄스로 재생합니다. 최신 기준을 사용하려면 8.5에서 다시 내보내세요.');
    $('plan-warning').textContent = warnings.join(' '); $('plan-warning').hidden = !warnings.length;
    $('coordinate-data').textContent = JSON.stringify({design_id:plan.layout.designId??null,coordinate_system:'slab-bottom-left-mm',cut_lines:plan.layout.lines},null,2);
    $('steps').replaceChildren();
    plan.passes.forEach(p => {
      const li = document.createElement('li'), button = document.createElement('button'); button.type='button';
      const title = document.createElement('strong'); title.textContent=`${p.index+1}차 왕복 · ${p.family==='horizontal'?'가로':Math.abs(p.angle-90)<1e-4?'세로':'사선'} 절단`;
      const detail = document.createElement('span'); detail.textContent=`작업각 ${(p.displayRotation??p.rotation).toFixed(2)}° · ${(p.rotaryMotor?.targetPulse??0).toLocaleString()}펄스`;
      const lines = document.createElement('small'); lines.textContent=`${p.cutIds.length}선 · ${p.heads.filter(h=>h.cutId).map(h=>model.MOTOR_NAMES[h.head-1]).join(' · ')}`;
      button.append(title,detail,lines); button.addEventListener('click',()=>onSelect(p.index)); li.append(button); $('steps').append(li);
    });
  }
  scope.RisePlanPanel = {render};
})(globalThis);
