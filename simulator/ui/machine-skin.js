/* Reusable mechanical drawing layer for the production SVG renderer.
   Every pigment below is from Open Color. Geometry/timing live elsewhere. */
(function (global) {
  'use strict';
  const P = {
    white:'#ffffff', black:'#000000', g0:'#f8f9fa', g1:'#f1f3f5',
    g2:'#e9ecef', g3:'#dee2e6', g4:'#ced4da', g5:'#adb5bd',
    g6:'#868e96', g7:'#495057', g8:'#343a40', g9:'#212529',
    green0:'#ebfbee', green2:'#b2f2bb', green7:'#37b24d', green9:'#2b8a3e',
    lime0:'#f4fce3', lime2:'#d8f5a2', lime7:'#74b816', teal7:'#0ca678'
  };
  const n = v => Math.round(Number(v) * 100) / 100;
  const safe = v => String(v).replace(/[^a-zA-Z0-9_-]/g, '');
  const id = (uid, suffix) => 'rm-skin-' + safe(uid) + '-' + suffix;
  const fill = (uid, suffix) => 'url(#' + id(uid, suffix) + ')';
  const rect = (x,y,w,h,color,stroke,radius,extra) =>
    '<rect x="'+n(x)+'" y="'+n(y)+'" width="'+n(w)+'" height="'+n(h)+'" rx="'+(radius||0)+'" fill="'+color+'" stroke="'+(stroke||'none')+'" '+(extra||'')+'/>';
  const line = (x1,y1,x2,y2,color,width,extra) =>
    '<line x1="'+n(x1)+'" y1="'+n(y1)+'" x2="'+n(x2)+'" y2="'+n(y2)+'" stroke="'+color+'" stroke-width="'+(width||1)+'" stroke-linecap="round" '+(extra||'')+'/>';
  const circle = (x,y,r,color,stroke,extra) =>
    '<circle cx="'+n(x)+'" cy="'+n(y)+'" r="'+n(r)+'" fill="'+color+'" stroke="'+(stroke||'none')+'" '+(extra||'')+'/>';

  function bolt(x,y,r) {
    r = r || 2.1;
    return circle(x+.35,y+.5,r+.45,P.g6,'none','opacity=".20"')
      + circle(x,y,r,P.g2,P.g6,'stroke-width=".65"')
      + circle(x-.35,y-.35,r*.54,P.g0)
      + line(x-r*.4,y,x+r*.4,y,P.g6,.65);
  }

  function extrusion(uid,x,y,w,h,vertical) {
    let out = rect(x+.9,y+1.3,w,h,P.g6,'none',1,'opacity=".14"')
      + rect(x,y,w,h,fill(uid,vertical?'metal-v':'metal-h'),P.g5,1,'stroke-width=".65"');
    if (vertical) {
      out += line(x+w*.25,y+1,x+w*.25,y+h-1,P.g0,.9)
        + line(x+w*.5,y+1,x+w*.5,y+h-1,P.g6,.75,'opacity=".65"')
        + line(x+w*.65,y+1,x+w*.65,y+h-1,P.white,.8);
    } else {
      out += line(x+1,y+h*.25,x+w-1,y+h*.25,P.g0,.9)
        + line(x+1,y+h*.5,x+w-1,y+h*.5,P.g6,.75,'opacity=".65"')
        + line(x+1,y+h*.65,x+w-1,y+h*.65,P.white,.8);
    }
    return out;
  }

  function screw(uid,x,y,length,vertical) {
    const w=vertical?4:length, h=vertical?length:4;
    return rect(x,y,w,h,P.g4,P.g6,.5,'stroke-width=".45"')
      + rect(x,y,w,h,fill(uid,vertical?'thread-v':'thread-h'))
      + (vertical?line(x+1,y,x+1,y+length,P.white,.65):line(x,y+1,x+length,y+1,P.white,.65));
  }

  function stepper(x,y,w,h) {
    let out=rect(x+.8,y+1,w,h,P.g9,'none',2,'opacity=".18"')
      + rect(x,y,w,h,P.g8,P.g7,1.5,'stroke-width=".6"');
    for(let i=3;i<h-1;i+=3) out+=line(x+1,y+i,x+w-1,y+i,P.g6,.45,'opacity=".7"');
    return out+rect(x+3,y+h-3,w-6,3,P.g5,P.g6,.5,'stroke-width=".45"');
  }

  function defs(uid) {
    const stops='<stop offset="0" stop-color="'+P.g5+'"/><stop offset=".18" stop-color="'+P.g2+'"/><stop offset=".33" stop-color="'+P.white+'"/><stop offset=".48" stop-color="'+P.g4+'"/><stop offset=".66" stop-color="'+P.g0+'"/><stop offset=".83" stop-color="'+P.g3+'"/><stop offset="1" stop-color="'+P.g6+'"/>';
    return '<linearGradient id="'+id(uid,'metal-v')+'" x1="0" y1="0" x2="1" y2="0">'+stops+'</linearGradient>'
      + '<linearGradient id="'+id(uid,'metal-h')+'" x1="0" y1="0" x2="0" y2="1">'+stops+'</linearGradient>'
      + '<linearGradient id="'+id(uid,'plate')+'" x1="0" y1="0" x2="1" y2="1"><stop stop-color="'+P.g1+'"/><stop offset=".55" stop-color="'+P.g3+'"/><stop offset="1" stop-color="'+P.g4+'"/></linearGradient>'
      + '<pattern id="'+id(uid,'thread-v')+'" width="4" height="4" patternUnits="userSpaceOnUse">'+line(0,3,4,0,P.g6,.6)+line(0,4,4,1,P.g0,.55)+'</pattern>'
      + '<pattern id="'+id(uid,'thread-h')+'" width="4" height="4" patternUnits="userSpaceOnUse">'+line(0,4,3,0,P.g6,.6)+line(1,4,4,0,P.g0,.55)+'</pattern>';
  }

  function frame(opts) {
    const uid=opts.uid, left=opts.cx-opts.width/2, right=left+opts.width;
    const top=opts.top, bottom=opts.bottom, height=bottom-top;
    let out='<g data-machine-frame role="img" aria-label="알루미늄 프레임과 리드 스크류">'
      + rect(left,top,opts.width,height,P.g2,P.g4,11,'stroke-width=".65"')
      + rect(left+3,top+3,opts.width-6,height-6,P.lime0,'none',9,'opacity=".35"')
      + rect(left+23,top+23,opts.width-46,height-46,P.g1,P.g4,3,'stroke-width=".65"')
      + rect(left+24,top+24,opts.width-48,height-48,P.green0,'none',3,'opacity=".18"');
    // Under-table cross members and centre drive support.
    out+=extrusion(uid,opts.cx-5.5,top+18,11,height-36,true)
      + extrusion(uid,left+18,(top+bottom)/2-4,opts.width-36,8,false);
    for(const x of [left+10,right-20]) {
      out+=extrusion(uid,x,top+7,10,height-14,true);
      const sx=x+(x<opts.cx?13:-7);
      out+=screw(uid,sx,top+22,height-43,true);
      out+=rect(sx-2,top+16,8,8,P.g3,P.g6,1,'stroke-width=".55"')
        + rect(sx-2,bottom-25,8,9,P.g3,P.g6,1,'stroke-width=".55"');
    }
    for(const y of [top+9,bottom-16])out+=extrusion(uid,left+11,y,opts.width-22,10,false);
    for(const x of [left+13,right-13])for(const y of [top+13,bottom-12]) {
      out+=rect(x-8.5,y-8,17,16,fill(uid,'plate'),P.g5,2,'stroke-width=".7"')
        + line(x-6,y-5,x+5,y-5,P.g0,.8)
        + bolt(x-4,y-3,1.7)+bolt(x+4,y+3,1.7);
    }
    out+=stepper(left+24,top-10,20,16)+stepper(right-44,top-10,20,16);
    return out+'</g>';
  }

  function table(opts) {
    const x=opts.cx,y=opts.cy,r=opts.radius;
    let out='<g role="img" aria-label="소형 회전판">'
      + circle(x,y+.9,r,P.g6,'none','opacity=".14"')
      + circle(x,y,r,fill(opts.uid,'plate'),P.g5,'data-turntable stroke-width=".8"')
      + circle(x,y,r-3.4,P.g2,P.g5,'stroke-width=".65"')
      + circle(x,y,r-4.2,P.lime0,'none','opacity=".35"')
      + circle(x,y,7,P.g4,P.g6,'stroke-width=".7"')
      + circle(x,y,3,P.g2,P.g5,'stroke-width=".7"');
    for(let a=0;a<360;a+=60) {
      const rad=a*Math.PI/180;
      out+=bolt(x+(r-6)*Math.cos(rad),y+(r-6)*Math.sin(rad),1.2);
    }
    return out+'</g>';
  }

  function gantry(opts) {
    const x=opts.left,y=opts.y,w=opts.width,uid=opts.uid;
    let out='<g role="img" aria-label="4헤드 갠트리">'
      + rect(x-1,y-24,w+2,28,P.g6,'none',2,'opacity=".10"')
      + extrusion(uid,x,y-22,w,7,false)
      + extrusion(uid,x,y-9,w,7,false)
      + screw(uid,x+3,y-13,w-6,false);
    for(const end of [x-6,x+w-6]) {
      out+=rect(end+1,y-26,13,32,P.g6,'none',2,'opacity=".15"')
        + rect(end,y-27,13,32,fill(uid,'plate'),P.g5,2,'stroke-width=".75"')
        + rect(end+3,y-19,7,16,P.g4,P.g5,1,'stroke-width=".5"')
        + rect(end+4,y-18,3,14,P.lime2,'none',.5,'opacity=".3"')
        + bolt(end+3,y-23,1.25)+bolt(end+10,y+1,1.25);
    }
    return out+'</g>';
  }

  function pen(opts) {
    const x=n(opts.x),y=n(opts.y),scale=opts.scale||.8;
    const name=String(opts.name).replace(/[&<>"']/g,'');
    return '<g transform="translate('+x+' '+y+') scale('+scale+')" role="img" aria-label="'+name+' 붓펜">'
      + rect(-5.5,-25,11,29,P.g6,'none',1.5,'opacity=".13"')
      + rect(-5.5,-25,11,17,fill(opts.uid,'plate'),P.g5,1.4,'stroke-width=".65"')
      + line(-4,-23,4,-23,P.g0,.7)
      + rect(-4,-20,8,7,opts.color,P.g6,.8,'stroke-width=".45"')
      + bolt(-3,-22,1)+bolt(3,-10,1)
      + rect(-3.5,-10,7,16,fill(opts.uid,'metal-v'),P.g6,.8,'stroke-width=".55"')
      + rect(-2.1,-8,4.2,9,opts.color,'none',.5)
      + rect(-3.5,2,7,2,P.g4,P.g6,.3,'stroke-width=".35"')
      + '<path d="M -2.4 6 L 0 12 L 2.4 6 Z" fill="'+P.g8+'"/>'
      + line(-.6,6,0,10,P.g5,.5)
      + '</g>';
  }

  function controller(opts) {
    const x=opts.cx-opts.width/2,y=opts.top,w=opts.width,h=opts.height;
    let out='<g role="img" aria-label="컨트롤러">'
      + '<path d="M '+n(opts.cx)+' '+n(y-8)+' V '+n(y)+'" fill="none" stroke="'+P.g7+'" stroke-width="1.4"/>'
      + rect(x+1,y+1,w,h,P.g6,'none',2,'opacity=".16"')
      + rect(x,y,w,h,fill(opts.uid,'plate'),P.g5,2,'stroke-width=".7"')
      + rect(x+4,y+4,42,h-8,P.green9,P.g7,1,'stroke-width=".5"')
      + rect(x+7,y+7,10,9,P.g8,P.g9,.5,'stroke-width=".4"')
      + rect(x+20,y+7,7,11,P.lime7,P.green9,.4,'stroke-width=".4"')
      + rect(x+30,y+7,7,11,P.lime7,P.green9,.4,'stroke-width=".4"');
    for(let k=0;k<5;k++) {
      out+=line(x+20.7,y+8+k*2,x+26.3,y+8+k*2,P.lime2,.45)
        + line(x+30.7,y+8+k*2,x+36.3,y+8+k*2,P.lime2,.45);
    }
    for(let k=0;k<4;k++)out+=rect(x+7+k*2.5,y+18,1.2,2.6,P.g3);
    out+=circle(x+40,y+7,1.3,P.lime2)
      + bolt(x+2,y+2,1)+bolt(x+w-2,y+h-2,1)
      + '<text x="'+n(x+w-5)+'" y="'+n(y+h/2+3)+'" text-anchor="end" fill="'+P.black+'" font-family="Pretendard Variable, Pretendard, sans-serif" font-size="8.5">컨트롤러</text>';
    return out+'</g>';
  }

  global.RiseMachineSkin={defs,frame,table,gantry,pen,controller};
})(typeof globalThis !== 'undefined' ? globalThis : this);
