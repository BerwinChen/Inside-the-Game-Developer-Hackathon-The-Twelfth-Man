import {clock} from './model.js';
import {replayScore} from './replay-score.js';
import {teamIdentity} from './team-identity.js';

export function mountFloatingPitch({canvas,getState,getGeometry,onTogglePlay}){
  const panel=document.createElement('section');panel.className='floating-match';panel.hidden=true;panel.setAttribute('aria-label','Floating live match');
  panel.innerHTML=`<div class="floating-match-heading"><span class="floating-match-drag" title="Drag to move">⠿ LIVE MATCH</span><button type="button" class="floating-match-close" aria-label="Hide floating match">×</button></div><div class="floating-match-score"><span class="mini-home"></span><strong class="mini-score"></strong><span class="mini-away"></span></div><canvas class="floating-match-canvas" aria-label="Miniature live pitch"></canvas><div class="floating-match-controls"><button type="button" class="floating-match-play" aria-label="Play floating match">▶</button><span class="floating-match-clock"></span><button type="button" class="floating-match-return">Back to pitch ↗</button></div>`;
  const restore=document.createElement('button');restore.type='button';restore.className='floating-match-restore';restore.textContent='Show match ↗';restore.hidden=true;
  document.body.append(panel,restore);
  const target=panel.querySelector('canvas'),ctx=target.getContext('2d'),chat=document.getElementById('chatMount');
  let pitchVisible=true,chatVisible=false,dismissed=false,drag=null;
  function render(){
    if(panel.hidden)return;
    const {match,time,playing}=getState(),score=replayScore(match,time),green=teamIdentity(match,'left'),blue=teamIdentity(match,'right');
    const a=panel.querySelector('.mini-home'),b=panel.querySelector('.mini-away');a.textContent=green.name;b.textContent=blue.name;a.style.color=green.color;b.style.color=blue.color;
    panel.querySelector('.mini-score').textContent=`${score?.home??'—'} : ${score?.away??'—'}`;
    panel.querySelector('.floating-match-clock').textContent=`H${match.half} · ${clock(time)}`;
    const play=panel.querySelector('.floating-match-play');play.textContent=playing?'Ⅱ':'▶';play.setAttribute('aria-label',playing?'Pause floating match':'Play floating match');
    const dpr=window.devicePixelRatio||1,w=Math.round(target.clientWidth*dpr),h=Math.round(target.clientHeight*dpr);if(!w||!h)return;
    if(target.width!==w||target.height!==h){target.width=w;target.height=h;}
    const g=getGeometry();if(!g||!canvas.width)return;
    const ratio=canvas.width/canvas.getBoundingClientRect().width;
    ctx.clearRect(0,0,w,h);ctx.drawImage(canvas,(g.x0-3)*ratio,(g.y0-3)*ratio,(g.pw+6)*ratio,(g.ph+6)*ratio,0,0,w,h);
  }
  function visibility(){const wanted=chatVisible&&!pitchVisible;if(!wanted)dismissed=false;panel.hidden=!wanted||dismissed;restore.hidden=!wanted||!dismissed;if(!panel.hidden)render();}
  const observer=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.target===canvas)pitchVisible=entry.isIntersecting;else chatVisible=entry.isIntersecting;}visibility();});observer.observe(canvas);observer.observe(chat);
  panel.querySelector('.floating-match-close').onclick=()=>{dismissed=true;visibility();};restore.onclick=()=>{dismissed=false;visibility();};
  panel.querySelector('.floating-match-play').onclick=()=>{onTogglePlay();render();};panel.querySelector('.floating-match-return').onclick=()=>canvas.scrollIntoView({behavior:'smooth',block:'center'});
  const handle=panel.querySelector('.floating-match-drag');
  handle.onpointerdown=e=>{if(e.button!==0)return;const rect=panel.getBoundingClientRect();drag={x:e.clientX,y:e.clientY,left:rect.left,top:rect.top};handle.setPointerCapture(e.pointerId);e.preventDefault();};
  handle.onpointermove=e=>{if(!drag)return;panel.style.left=`${Math.max(8,Math.min(innerWidth-panel.offsetWidth-8,drag.left+e.clientX-drag.x))}px`;panel.style.top=`${Math.max(8,Math.min(innerHeight-panel.offsetHeight-8,drag.top+e.clientY-drag.y))}px`;panel.style.right='auto';panel.style.bottom='auto';};
  handle.onpointerup=handle.onpointercancel=()=>{drag=null;};
  const resize=new ResizeObserver(render);resize.observe(target);window.addEventListener('resize',()=>{if(panel.style.left){const rect=panel.getBoundingClientRect();panel.style.left=`${Math.max(8,Math.min(innerWidth-panel.offsetWidth-8,rect.left))}px`;panel.style.top=`${Math.max(8,Math.min(innerHeight-panel.offsetHeight-8,rect.top))}px`;}render();});
  return {render};
}
