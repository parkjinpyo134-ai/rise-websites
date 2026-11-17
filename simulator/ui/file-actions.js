(function(scope){
  'use strict';
  const $ = id=>document.getElementById(id);
  function download(value,type,name){const url=URL.createObjectURL(new Blob([value],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function connect({getPlan,getState,load,showError,notify,pause}){
    const resultSelect=$('result-design'), resultDownload=$('download-result-design');
    resultSelect.addEventListener('change',()=>{
      const item=scope.RiseResultDesigns[Number(resultSelect.value)];
      resultDownload.hidden=resultSelect.value==='';
      if(resultSelect.value!=='' && item){resultDownload.href=item.file;resultDownload.download=item.file.split('/').pop();}
    });
    $('load-result-design').addEventListener('click',()=>{
      if(resultSelect.value===''){notify('먼저 결과물 설계를 선택하세요.');return;}
      pause();
      try{const item=scope.RiseResultDesigns[Number(resultSelect.value)];load(scope.FactorySimulation.parseInput(JSON.stringify(item.job)));$('source-label').textContent=item.name;notify(`${item.name} 불러오기 완료`);}
      catch(error){showError(error);}
    });
    // A normal paste path also works when a browser cannot attach local files.
    $('open-json').addEventListener('click',()=>{pause();$('settings-dialog').close();$('json-dialog').showModal();});
    $('close-json').addEventListener('click',()=>$('json-dialog').close());
    $('json-form').addEventListener('submit',event=>{
      event.preventDefault();
      try{load(scope.FactorySimulation.parseInput($('json-source').value));$('json-dialog').close();$('json-source').value='';notify('Python 모터 계획 JSON 적용 완료');}
      catch(error){$('json-error').textContent=error.message;$('json-error').hidden=false;}
    });
    $('csv-file').addEventListener('change',async()=>{
      const file=$('csv-file').files[0]; if(!file)return; pause();
      try{if(file.size>2000000)throw new Error('설계 파일은 2MB 이하로 불러오세요.');load(scope.FactorySimulation.parseInput(await file.text()));notify(`${file.name} 불러오기 완료`);}
      catch(error){showError(error);} finally{$('csv-file').value='';}
    });
    $('motor-export').addEventListener('click',()=>download(scope.FactorySimulation.motorCSV(getPlan()),'text/csv;charset=utf-8','motor-program.csv'));
    $('export').addEventListener('click',()=>{const state=getState();download(JSON.stringify({...scope.FactorySimulation.report(getPlan(),state),simulation_y_traversal:state.traversalDirection},null,2),'application/json',`rise-simulation-${state.complete?'complete':'snapshot'}.json`);notify('작업 계획과 현재 시뮬레이션 상태를 저장했습니다.');});
  }
  scope.RiseFileActions={connect};
})(globalThis);
