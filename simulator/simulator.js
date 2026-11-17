/* App composition. Physical calculations live in model.js; UI modules only present them. */
(function () {
  'use strict';
  const M = globalThis.FactorySimulation, $ = id => document.getElementById(id);
  const PHASES = {rotate:'슬랩 회전',position:'펜 위치 이동',approach:'그리기 시작점 이동',cut:'그리기',lift:'펜 상승',return:'Y축 복귀',slab_home_seek:'슬랩 원점 탐색',slab_home_reference:'슬랩 0° 확정',x_home_seek:'X 리미트 탐색',x_home_reference:'X 원점 확정',init_lift:'펜 상승',init_seek:'X 리미트 탐색',init_contact:'리미트 감지',init_backoff:'스위치 이탈',init_latch:'저속 재접근',init_reference:'X 원점 검출',init_release:'X 원점 확정'};
  const clock = t => `${String(Math.floor(t/60)).padStart(2,'0')}:${(t%60).toFixed(1).padStart(4,'0')}`;
  let plan = M.createPlan({w:60,h:60,theta:90}), imported = null, currentState, noticeTimer;
  let reach = M.assessReachability(plan);
  M.HOME_X.forEach((v,i)=>$(`home-${i+1}`).value=v);
  RiseMotorMonitor.mount();
  const playback = RisePlayback.create({onChange:render});
  function notify(message){$('notice').textContent=message;$('notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('notice').hidden=true,3800);}
  function showError(error){$('plan-error').textContent=error.message;$('plan-error').hidden=false;}
  function render(ui){
    const state=RiseTopDownMotion.project(plan,M.sample(plan,ui.elapsed)); currentState=state;
    const passComplete=ui.mode==='pass'&&!ui.playing&&Math.abs(ui.elapsed-(plan.passes[ui.selected]?.end??-1))<1e-8;
    const phase=PHASES[state.operation.kind]??state.operation.kind;
    const passIndex=state.initialized&&!state.complete&&!passComplete?state.passIndex:ui.selected;
    const prefix=state.initializing?'Initialize':state.complete?'완료':`${state.passIndex+1}차 왕복`;
    const label=ui.elapsed===0?'슬랩·X Initialize부터 시작합니다.':passComplete?`${ui.selected+1}차 왕복 완료 · X 원점 복귀 완료`:state.complete?'전체 생산 완료 · X 원점 복귀 완료':`${prefix} · ${phase}${ui.playing?'':' · 정지'}`;
    $('phase-label').textContent=label;
    $('view-status').textContent=passComplete?`${ui.selected+1}차 왕복 완료`:state.complete?'전체 생산 완료':`${state.initializing?'원점 복귀':`${state.passIndex+1}차 왕복`} · ${phase}`;
    $('play').textContent=ui.playing&&ui.mode==='full'?'일시 정지':ui.mode==='full'&&ui.elapsed>0&&!state.complete?'이어서 재생':'전체 생산 재생';
    $('play-pass').textContent=ui.playing&&ui.mode==='pass'?'선택 왕복 일시 정지':'선택 왕복 재생';
    $('play').disabled=!reach.feasible||!plan.passes.length;
    $('play-pass').disabled=!reach.feasible||!plan.passes.length;
    $('motor-export').disabled=!reach.feasible;
    $('initialize').textContent=ui.playing&&ui.mode==='initialize'?'Initialize 일시 정지':'슬랩 · X Initialize';
    $('init-status').textContent=state.initialized?'X 원점 확정 · 매 왕복 후 재복귀':ui.elapsed===0?'슬랩 0° → X 리미트 확인':phase;
    $('init-progress').value=Math.min(100,ui.elapsed/plan.initializationEnd*100);
    $('seek').disabled=!state.initialized||(ui.playing&&ui.mode==='full');
    $('percent').textContent=`${Math.floor(state.progress*100)}%`;
    $('progress').value=state.progress*100;$('seek').value=state.progress*100;
    $('elapsed').textContent=clock(state.elapsed);$('duration').textContent=clock(plan.duration);
    $('cut-count').textContent=`${state.completedLines} / ${plan.cuts.length}선`;
    $('pass-count').textContent=`${state.completedPasses} / ${plan.passes.length}회`;
    $('selected-pass-label').textContent=`${ui.selected+1}차 선택`;
    $('previous').disabled=ui.selected<=0;$('next').disabled=ui.selected>=plan.passes.length-1;
    document.querySelectorAll('#steps li').forEach((li,i)=>{li.classList.toggle('current',state.initialized&&!state.complete&&i===passIndex);li.classList.toggle('selected',i===ui.selected);li.classList.toggle('complete',state.elapsed>=plan.passes[i].end);li.firstChild.setAttribute('aria-current',i===ui.selected?'step':'false');});
    RiseMotorMonitor.render(plan,state,ui.selected,passComplete);
    RiseMachineView.render({svg:$('machine'),plan,state:passComplete?{...state,pass:plan.passes[ui.selected],passIndex:ui.selected}:state,layout:plan.layout,showPaths:$('paths').checked,showGrid:$('grid').checked,uid:'rise-live'});
  }
  function options(){return {drive:{...M.MEASURED_DRIVE},homeX:[1,2,3,4].map(n=>Number($(`home-${n}`).value)),w:Number($('unit-w').value),h:Number($('unit-h').value),theta:Number($('angle').value),feed:Number($('feed').value),enabledHeads:[1,2,3,4].filter(n=>$(`enable-${n}`).checked),order:$('order').value,...(imported?{layout:imported}:{})};}
  function setPlan(next){
    plan=next;reach=M.assessReachability(plan);$('plan-error').hidden=true;
    if(!reach.feasible)showError(new Error(`원점 밖 절단선이 있어 재생할 수 없습니다: ${reach.violations.map(v=>`${v.passIndex+1}차 ${v.motorName}:${v.lineId} (${v.outsideMm.toFixed(3)}mm)`).join(', ')}`));
    RisePlanPanel.render(plan,index=>playback.select(index));
    for(const id of ['lead','ppr','home-1','home-2','home-3','home-4','enable-1','enable-2','enable-3','enable-4','order','feed'])$(id).disabled=!!plan.pythonMotorProgram;
    plan.homeX.forEach((x,i)=>$(`home-${i+1}`).value=x);[1,2,3,4].forEach(h=>$(`enable-${h}`).checked=plan.enabledHeads.includes(h));$('order').value=plan.order;$('feed').value=plan.feed;
    $('lead').value=plan.drive.lead;$('ppr').value=plan.drive.pulsesPerRev;
    playback.setPlan(plan);
  }
  function load(layout){
    const currentDefaults = !layout.motorProgram && plan.pythonMotorProgram ? {homeX:[...M.HOME_X],drive:{...M.MEASURED_DRIVE}} : {};
    const next=M.createPlan({...options(),...currentDefaults,...(layout.recommendedDrive?{drive:layout.recommendedDrive}:{}),layout});
    imported=layout;$('preset').value='custom';
    for(const id of ['unit-w','unit-h','angle'])$(id).disabled=layout.exactCoordinates||!layout.design;
    if(layout.design){$('unit-w').value=layout.design.w;$('unit-h').value=layout.design.h;$('angle').value=layout.design.theta;if(!layout.exactCoordinates)imported=null;}
    else for(const id of ['unit-w','unit-h','angle']){$(id).value='';$(id).placeholder='좌표 기준';}
    setPlan(next);
  }
  $('play').addEventListener('click',()=>playback.full());
  $('play-pass').addEventListener('click',()=>playback.pass());
  $('initialize').addEventListener('click',()=>playback.initialize());
  $('reset').addEventListener('click',()=>playback.reset());
  $('speed').addEventListener('change',()=>playback.speed(Number($('speed').value)));
  $('seek').addEventListener('input',()=>playback.seek(plan.duration*Number($('seek').value)/100));
  $('previous').addEventListener('click',()=>playback.select(playback.snapshot().selected-1));
  $('next').addEventListener('click',()=>playback.select(playback.snapshot().selected+1));
  for(const id of ['grid','paths'])$(id).addEventListener('change',()=>render(playback.snapshot()));
  $('open-settings').addEventListener('click',()=>{playback.pause();$('settings-dialog').showModal();});
  $('close-settings').addEventListener('click',()=>$('settings-dialog').close());
  $('settings').addEventListener('submit',event=>{event.preventDefault();try{setPlan(M.createPlan(options()));$('settings-dialog').close();}catch(error){showError(error);$('settings-dialog').close();}});
  const presets={rectangle:{w:60,h:60,theta:90},slanted:{w:60,h:60,theta:70},dense:{w:30,h:15,theta:90}};
  $('preset').addEventListener('change',()=>{const p=presets[$('preset').value];if(!p)return;imported=null;$('unit-w').value=p.w;$('unit-h').value=p.h;$('angle').value=p.theta;for(const id of ['unit-w','unit-h','angle','home-1','home-2','home-3','home-4','feed','order','enable-1','enable-2','enable-3','enable-4'])$(id).disabled=false;M.HOME_X.forEach((v,i)=>$(`home-${i+1}`).value=v);});
  for(const id of ['unit-w','unit-h','angle'])$(id).addEventListener('input',()=>{imported=null;$('preset').value='custom';});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&playback.snapshot().playing)playback.pause();});
  RiseFileActions.connect({getPlan:()=>plan,getState:()=>currentState,load,showError,notify,pause:()=>playback.pause()});
  setPlan(plan);
})();
