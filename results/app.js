(() => {
  'use strict';
  const data = window.RISE_MEDIA;
  const $ = id => document.getElementById(id);
  const kindNames = {layout:'배치도 · 수치',simulation:'시뮬레이션',video:'구동 영상',photo:'결과 사진'};
  const icons = {layout:'📐',simulation:'🔄',video:'🎬',photo:'📷'};
  let design = 1, kind = 'layout', index = 0;
  let renderVersion = 0;
  const items = () => data[design][kind];
  function choose(nextDesign, nextKind, nextIndex = 0) {
    design = nextDesign; kind = nextKind; index = nextIndex; render();
  }
  function disposeVideo() {
    const video = $('media-stage').querySelector('video');
    if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
  }
  function render() {
    const version = ++renderVersion;
    disposeVideo();
    const entry = items()[index];
    $('design-title').textContent = `${design}번 설계`;
    document.querySelectorAll('[data-design]').forEach(b => b.setAttribute('aria-pressed', Number(b.dataset.design) === design));
    document.querySelectorAll('[data-kind]').forEach(b => {
      const selected = b.dataset.kind === kind;
      b.setAttribute('aria-selected', selected); b.tabIndex = selected ? 0 : -1;
    });
    $('media-panel').setAttribute('aria-labelledby', `tab-${kind}`);
    $('media-stage').replaceChildren();
    $('media-status').textContent = kind === 'video' ? '재생 버튼을 눌러 영상을 시작하세요.' : '';
    let media;
    if (kind === 'video') {
      media = document.createElement('video');
      media.controls = true; media.playsInline = true; media.preload = 'metadata';
      if (entry.poster) media.poster = entry.poster;
      media.setAttribute('aria-label', `${design}번 설계 ${entry.title}`);
      media.addEventListener('playing', () => { if(version === renderVersion) $('media-status').textContent = ''; });
      media.addEventListener('error', () => {
        if(version === renderVersion) $('media-status').textContent = '영상을 열 수 없습니다. ZIP을 모두 풀었는지 확인하고 Chrome 또는 Edge에서 다시 열어 주세요.';
      });
      media.src = entry.src;
    } else {
      media = document.createElement('img');
      media.alt = `${design}번 설계 ${entry.title}`;
      media.addEventListener('error', () => { if(version === renderVersion) $('media-status').textContent = '이미지를 열 수 없습니다. media 폴더가 index.html과 함께 있는지 확인해 주세요.'; });
      media.src = entry.src;
    }
    $('media-stage').append(media);
    $('zoom-open').hidden = kind === 'video';
    $('media-caption').textContent = `${design}번 설계 / ${entry.title}`;
    $('media-count').textContent = `${index + 1} / ${items().length}`;
    $('list-heading').textContent = `${kindNames[kind]} · ${items().length}`;
    $('media-list').replaceChildren();
    items().forEach((item, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'media-item'; b.setAttribute('aria-pressed', i === index);
      if (item.poster || kind === 'photo') {
        const img = document.createElement('img'); img.className = 'thumb'; img.alt = ''; img.src = item.poster || item.src; b.append(img);
      } else {
        const icon = document.createElement('span'); icon.className = 'emoji'; icon.setAttribute('aria-hidden','true'); icon.textContent = icons[kind]; b.append(icon);
      }
      const text = document.createElement('span'), title = document.createElement('strong'), sub = document.createElement('small');
      title.textContent = item.title;
      sub.textContent = item.durationLabel || `${design}번 설계`;
      text.append(title, sub); b.append(text);
      b.addEventListener('click', () => { choose(design, kind, i); $('media-list').children[i].focus({preventScroll:true}); });
      $('media-list').append(b);
    });
    $('photo-row').replaceChildren();
    data[design].photo.forEach((item, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', `결과 사진 ${i+1} 보기`); b.setAttribute('aria-pressed',kind === 'photo' && index === i);
      const img = document.createElement('img'); img.src = item.src; img.alt = `결과 사진 ${i+1}`; b.append(img);
      b.addEventListener('click', () => { choose(design, 'photo', i); $('photo-row').children[i].focus({preventScroll:true}); });
      $('photo-row').append(b);
    });
  }
  function zoom() {
    const entry = items()[index];
    $('zoom-title').textContent = `${design}번 설계 · ${entry.title}`;
    const img = document.createElement('img'); img.src = entry.src; img.alt = entry.title;
    $('zoom-content').replaceChildren(img);
    document.querySelector('.dialog-navigation').hidden = kind !== 'photo';
    $('zoom-position').textContent = `${index+1} / ${items().length}`;
    $('zoom-prev').disabled = index === 0;
    $('zoom-next').disabled = index === items().length-1;
    if (!$('image-dialog').open) $('image-dialog').showModal();
  }
  document.querySelectorAll('[data-design]').forEach(b => b.addEventListener('click', () => choose(Number(b.dataset.design), kind)));
  const tabs = [...document.querySelectorAll('[data-kind]')];
  tabs.forEach((b,i) => {
    b.addEventListener('click', () => choose(design, b.dataset.kind));
    b.addEventListener('keydown', e => {
      let next;
      if(e.key==='ArrowRight') next = (i+1)%tabs.length;
      if(e.key==='ArrowLeft') next = (i+tabs.length-1)%tabs.length;
      if(e.key==='Home') next=0;
      if(e.key==='End') next=tabs.length-1;
      if(next!==undefined){e.preventDefault();tabs[next].click();tabs[next].focus();}
    });
  });
  $('zoom-open').addEventListener('click',zoom);
  $('zoom-close').addEventListener('click',()=>$('image-dialog').close());
  $('image-dialog').addEventListener('close',()=>$('zoom-content').replaceChildren());
  function movePhoto(offset){
    const next=index+offset;
    if(kind==='photo'&&next>=0&&next<items().length){
      choose(design,kind,next);zoom();
      const target = offset > 0 && !$('zoom-next').disabled ? $('zoom-next') : !$('zoom-prev').disabled ? $('zoom-prev') : $('zoom-next');
      target.focus({preventScroll:true});
    }
  }
  $('zoom-prev').addEventListener('click',()=>movePhoto(-1));
  $('zoom-next').addEventListener('click',()=>movePhoto(1));
  $('image-dialog').addEventListener('keydown',e=>{if(e.key==='ArrowLeft'){e.preventDefault();movePhoto(-1);}if(e.key==='ArrowRight'){e.preventDefault();movePhoto(1);}});
  $('help-open').addEventListener('click',()=>$('help-dialog').showModal());
  $('help-close').addEventListener('click',()=>$('help-dialog').close());
  window.addEventListener('pagehide',disposeVideo);
  render();
})();
