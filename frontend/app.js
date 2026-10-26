import {mountFloatingPitch} from './floating-pitch.js';
import {teamIdentity,colorTeamNames} from './team-identity.js';
import {replayScore} from './replay-score.js';
import {createBallIllustration,illustrativeBallAt} from './ball-illustration.js';
import {fetchRealReplay} from './real-replay.js';
import {mountMoveForecast} from './forecast-ui.js';
import {buildReplaySnapshot} from './chat-context.js';
import {mountChat} from './chat-ui.js';
import {createDemo,normalizeBAS,normalizeGSR,classify,atTime,clock,labels} from './model.js';
import {demoProfiles,playerStats,historyStats,normalizeProfiles} from './analytics.js';
const $=id=>document.getElementById(id);
let match=createDemo(),time=0,playing=false,last=0,filter='all',activeId=null,loaded={gsr:null,bas:null,half:1,matchId:null};
let profiles=demoProfiles(),selectedPlayer=null,geometry=null,profileKey='',directions={left:1,right:-1};
const canvas=$('pitch'),ctx=canvas.getContext('2d');
let renderedEventKey=undefined,illustrativeBallPoints=[],miniPitch=null;
const icons={Pass:'↗',Drive:'↝',Header:'↑','High Pass':'⌁',Cross:'↪',Shot:'◎',Goal:'⚑','Player Successful Tackle':'⇄','Ball Player Block':'⊣',Out:'↗','Throw In':'↩','Free Kick':'◉'};
function teamName(team){return team==='left'?match.home:team==='right'?match.away:'Unknown team';}
function setPlaying(value){playing=value;$('playBtn').textContent=value?'Ⅱ':'▶';$('playBtn').setAttribute('aria-label',value?'Pause':'Play');$('replayState').textContent=value?'Playing':'Paused';miniPitch?.render();}
function seek(t){time=Math.max(0,Math.min(match.duration,t));if(time>=match.duration)setPlaying(false);update();}
function buildList(){
  renderedEventKey=undefined;
  const list=$('events');list.replaceChildren();const events=match.events.filter(e=>filter==='all'||e.label===filter);
  $('listCount').textContent=events.length;
  if(!events.length){const p=document.createElement('p');p.className='empty';p.textContent='No matching events. Import BAS JSON to add a timeline.';list.append(p);}
  for(const e of events){const row=document.createElement('button');row.className='event-row';row.dataset.id=e.id;row.dataset.t=e.t;row.dataset.team=e.team??'';row.dataset.color=teamIdentity(match,e.team).key;row.setAttribute('aria-label',`${clock(e.t)} ${labels[e.label]??e.label}`);
    const stamp=document.createElement('time');stamp.textContent=clock(e.t);
    const icon=document.createElement('span');icon.className='event-icon';icon.textContent=icons[e.label]??'·';
    const copy=document.createElement('span');copy.className='event-copy';const title=document.createElement('strong');title.textContent=labels[e.label]??e.label;
    const detail=document.createElement('small');detail.textContent=`${teamName(e.team)}${e.number!=null?` · #${e.number}`:e.playerId?` · ID ${e.playerId}`:''}`;copy.append(title,detail);
    const arrow=document.createElement('span');arrow.className='event-arrow';arrow.textContent='↗';row.append(stamp,icon,copy,arrow);row.onclick=()=>seek(e.t);list.append(row);
  }
}
function loadMatch(){colorTeamNames(match);illustrativeBallPoints=createBallIllustration(match);profiles=match.synthetic?demoProfiles():(match.profiles??{});selectedPlayer=null;profileKey='';showPanel('events');buildRoster();time=0;activeId=null;setPlaying(false);$('homeName').textContent=match.home;$('awayName').textContent=match.away;$('matchTitle').textContent=match.title;$('sourceTag').textContent=match.synthetic?'SYNTHETIC DEMO':match.realSource?'REAL MATCH · 1 Hz':match.sourceSynthetic?'IMPORTED SYNTHETIC':'IMPORTED DATA';
  if(match.realSource)directions={...match.directions};else directions={left:1,right:-1};
  $('homeSideLabel').textContent='TEAM';$('awaySideLabel').textContent='TEAM';
  for(const [side,prefix] of [['left','home'],['right','away']]){const team=teamIdentity(match,side);$(prefix+'Crest').textContent=team.initial;$(prefix+'Crest').style.background=team.color;$(prefix+'Legend').textContent=team.name;document.querySelector('.'+(side==='left'?'home':'away')+'-dot').style.background=team.color;}document.querySelector('.ref-dot').parentElement.hidden=match.realSource&&!match.frames.some(f=>f.players.some(p=>p.role==='referee'));
  $('dataSummary').textContent=match.synthetic?'22 players + 1 referee · Simulated match':`${match.frames.length.toLocaleString()} frames · ${match.events.length} events`;
  $('timeline').max=match.duration;$('totalTime').textContent=clock(match.duration);$('halfTime').textContent=clock(match.duration/2);$('endTime').textContent=clock(match.duration);
  const markers=$('timelineMarkers');markers.replaceChildren();for(const e of match.events){const b=document.createElement('button');b.style.left=`${e.t/match.duration*100}%`;b.className=e.label==='Goal'?'goal':'';b.title=`${clock(e.t)} ${labels[e.label]??e.label}`;b.setAttribute('aria-label',b.title);b.onclick=()=>seek(e.t);markers.append(b);}
  buildList();update();window.dispatchEvent(new Event('touchline:matchchange'));
}
function update(){
  $('timeline').value=time;$('currentTime').textContent=clock(time);$('matchClock').textContent=`${match.half===2?'2ND':'1ST'} HALF · ${clock(time)}`;
  const past=match.events.filter(e=>e.t<=time),current=past.at(-1);activeId=current?.id??null;
  $('eventCount').replaceChildren(document.createTextNode(past.length),unit());$('passCount').replaceChildren(document.createTextNode(past.filter(e=>['Pass','High Pass','Cross'].includes(e.label)).length),unit());$('shotCount').replaceChildren(document.createTextNode(past.filter(e=>e.label==='Shot').length),unit());
  $('possession').textContent=match.synthetic?(current?teamName(current.team):match.home):'Not provided';
  const score=replayScore(match,time);$('homeScore').textContent=score?.home??'—';$('awayScore').textContent=score?.away??'—';document.querySelector('.score').title=match.realSource?'Score from recorded goal events; left/right sides switch at halftime.':'';
  if(renderedEventKey!==activeId){for(const row of $('events').children){row.classList.toggle('current',row.dataset.id===activeId);row.classList.toggle('future',Number(row.dataset.t)>time);if(row.dataset.id===activeId)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current');}renderedEventKey=activeId;}
  const toast=$('eventToast');toast.hidden=!current||time-current.t>3;if(current)toast.textContent=`${labels[current.label]??current.label} · ${teamName(current.team)}`;
  renderProfile();draw();window.dispatchEvent(new Event('touchline:contextchange'));
}
function unit(){const e=document.createElement('small');e.textContent='';return e;}
function draw(){
  const rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;const w=rect.width,h=rect.height;if(!w||!h)return;
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const headerInset=60,scale=Math.min((w-54)/105,(h-headerInset-26)/68),pw=105*scale,ph=68*scale,x0=(w-pw)/2,y0=headerInset+(h-headerInset-ph)/2;
  const point=(x,y)=>[x0+(x+52.5)*scale,y0+(y+34)*scale];
  ctx.fillStyle='#203d2d';ctx.fillRect(0,0,w,h);for(let i=0;i<10;i++){ctx.fillStyle=i%2?'#264632':'#24422f';ctx.fillRect(x0+i*pw/10,y0,pw/10,ph);}
  geometry={x0,y0,pw,ph,scale};
  ctx.strokeStyle='#b2c7a999';ctx.lineWidth=1;ctx.strokeRect(x0,y0,pw,ph);
  const line=(x1,y1,x2,y2)=>{ctx.beginPath();ctx.moveTo(...point(x1,y1));ctx.lineTo(...point(x2,y2));ctx.stroke();};
  const box=(x,y,bw,bh)=>ctx.strokeRect(...point(x,y),bw*scale,bh*scale);
  const circle=(x,y,r)=>{ctx.beginPath();ctx.arc(...point(x,y),r*scale,0,Math.PI*2);ctx.stroke();};
  line(0,-34,0,34);circle(0,0,9.15);ctx.fillStyle='#92ab85';ctx.beginPath();ctx.arc(...point(0,0),1.5,0,7);ctx.fill();
  for(const sign of [-1,1]){box(sign===-1?-52.5:36,-20.16,16.5,40.32);box(sign===-1?-52.5:47,-9.16,5.5,18.32);box(sign===-1?-54.3:52.5,-3.66,1.8,7.32);ctx.beginPath();ctx.arc(...point(sign*41.5,0),9.15*scale,sign===-1?-.925:Math.PI-.925,sign===-1?.925:Math.PI+.925);ctx.stroke();ctx.beginPath();ctx.arc(...point(sign*41.5,0),1.5,0,7);ctx.fill();}
  for(const [x,y,start]of[[-52.5,-34,0],[52.5,-34,Math.PI/2],[52.5,34,Math.PI],[-52.5,34,-Math.PI/2]]){ctx.beginPath();ctx.arc(...point(x,y),scale,start,start+Math.PI/2);ctx.stroke();}
  const players=atTime(match.frames,time),current=match.events.find(e=>e.id===activeId);
  if($('showTrails').checked){for(const p of players){if(p.role==='referee')continue;ctx.beginPath();let started=false;for(let dt=2.4;dt>=0;dt-=.4){const old=atTime(match.frames,Math.max(0,time-dt)).find(q=>q.id===p.id);if(old){const xy=point(old.x,old.y);if(!started){ctx.moveTo(...xy);started=true;}else ctx.lineTo(...xy);}}ctx.strokeStyle=teamIdentity(match,p.team).color+'33';ctx.lineWidth=2;ctx.stroke();}}
  const r=Math.max(5,Math.min(10,scale*1.25));
  for(const p of players){const [x,y]=point(p.x,p.y);if(Math.abs(p.x)>58||Math.abs(p.y)>40)continue;const active=(current&&String(current.playerId)===p.id)||selectedPlayer===p.id;
    if(active){ctx.beginPath();ctx.arc(x,y,r+5+Math.sin(time*5)*1,0,7);ctx.strokeStyle=selectedPlayer===p.id?'#ffffff':'#e6f7be88';ctx.lineWidth=1;ctx.stroke();}
    ctx.shadowColor='#0005';ctx.shadowBlur=5;ctx.shadowOffsetY=2;ctx.beginPath();ctx.arc(x,y,p.role==='referee'?r*.7:r,0,7);ctx.fillStyle=p.role==='referee'?'#eab578':teamIdentity(match,p.team).color;ctx.fill();ctx.shadowBlur=0;ctx.shadowOffsetY=0;
    if($('showNumbers').checked&&p.number!=null){ctx.fillStyle='#1b2b22';ctx.font=`600 ${Math.max(7,r)}px -apple-system,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(p.number,x,y+.5);}}
  if($('showBall').checked){const ball=illustrativeBallAt(illustrativeBallPoints,time,players);if(ball){const [x,y]=point(ball.x,ball.y);ctx.save();ctx.shadowColor='#0009';ctx.shadowBlur=5;ctx.beginPath();ctx.arc(x,y,4.5,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle='#24382d';ctx.lineWidth=1.5;ctx.stroke();ctx.restore();}}
  if(!players.length){ctx.fillStyle='#c8d7c3';ctx.font='13px -apple-system,sans-serif';ctx.textAlign='center';ctx.fillText('Import GSR to display player positions',w/2,h/2+35);}
  miniPitch?.render();
}
$('playBtn').onclick=()=>{if(time>=match.duration)seek(0);setPlaying(!playing);};$('backBtn').onclick=()=>seek(time-10);$('timeline').oninput=e=>seek(Number(e.target.value));$('showTrails').onchange=draw;$('showNumbers').onchange=draw;$('showBall').onchange=draw;
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));buildList();update();});
function resetDemo(){replayLoadId++;$('replaySource').value='demo';$('replaySourceStatus').textContent='Synthetic demonstration selected.';loaded={gsr:null,bas:null,half:1,matchId:null};match=createDemo();loadMatch();};
$('importBtn').onclick=()=>$('importDialog').showModal();$('chooseFiles').onclick=()=>$('fileInput').click();
$('fileInput').onchange=async e=>{
  replayLoadId++;const status=$('importStatus'),half=Number($('halfSelect').value);setPlaying(false);status.textContent='Reading files…';
  try{
    const staging=half===loaded.half?{...loaded}:{gsr:null,bas:null,half,matchId:null};
    let added=0,onlyProfiles=true;for(const file of e.target.files){if(file.size>150*1024*1024)throw Error(`${file.name} exceeds 150 MB. Trim the file first.`);const nameHalf=file.name.match(/(1st|2nd)/i);if(nameHalf&&(nameHalf[1].toLowerCase()==='1st'?1:2)!==half)throw Error('The GSR file does not match the selected half.');const id=file.name.match(/^(\d{6})/)?.[1];if(id&&staging.matchId&&staging.matchId!==id)throw Error('Files belong to different matches. Reset the demo before importing a new match.');if(id)staging.matchId=id;
      const data=JSON.parse(await file.text());if(data.half!=null&&Number(data.half)!==half)throw Error('The file metadata does not match the selected half.');const kind=classify(data);if(kind!=='profiles'){staging[`${kind}Synthetic`]=data.synthetic===true;staging.sourceSynthetic=Boolean(staging.gsrSynthetic||staging.basSynthetic);}if(kind!=='profiles')onlyProfiles=false;staging[kind]=kind==='gsr'?normalizeGSR(data):kind==='profiles'?normalizeProfiles(data):normalizeBAS(data,half);added++;}
    if(!added)return;if(onlyProfiles){profiles={...profiles,...staging.profiles};loaded.profiles=profiles;profileKey='';buildRoster();renderProfile();status.textContent='Player profiles loaded.';$('importDialog').close();return;}
    loaded=staging;match={frames:loaded.gsr??[],events:loaded.bas??[],duration:Math.max(1,loaded.gsr?.at(-1)?.t??0,loaded.bas?.at(-1)?.t??0),half,profiles:staging.profiles??{},synthetic:false,sourceSynthetic:staging.sourceSynthetic,ballMode:'none',home:'Left team',away:'Right team',title:loaded.matchId?`Match ${loaded.matchId} · Local replay`:'Imported match · Local replay'};loadMatch();status.textContent=`Loaded ${match.frames.length} position frames and ${match.events.length} events.`;if(loaded.gsr&&loaded.bas)$('importDialog').close();
  }catch(err){status.textContent=`Import failed: ${err.message}`;}finally{e.target.value='';}
};
document.addEventListener('keydown',e=>{
  const target=e.target;
  const editing=target instanceof HTMLElement&&(target.isContentEditable||target.closest('input,textarea,select,button,[role="textbox"]'));
  if(e.code==='Space'&&!e.defaultPrevented&&!e.isComposing&&!editing&&!$('importDialog').open){e.preventDefault();$('playBtn').click();}
});
new ResizeObserver(draw).observe(canvas);
function animate(now){if(last&&playing)seek(time+Math.min((now-last)/1000,.2)*Number($('speed').value));last=now;requestAnimationFrame(animate);}loadMatch();requestAnimationFrame(animate);


function showPanel(panel){
  $('eventsPanel').hidden=panel!=='events';$('playerPanel').hidden=panel!=='player';
  $('eventsTab').setAttribute('aria-selected',String(panel==='events'));$('playerTab').setAttribute('aria-selected',String(panel==='player'));
}
function buildRoster(){
  const roster=new Map();for(const frame of match.frames)for(const p of frame.players)if(p.role!=='referee')roster.set(p.id,p);
  const select=$('playerPicker');select.replaceChildren(new Option('Select a player on the pitch',''));
  for(const team of ['left','right',null]){const group=document.createElement('optgroup');group.label=teamName(team);for(const p of roster.values())if(p.team===team){const profile=profiles[p.id];group.append(new Option(`${p.number!=null?'#'+p.number+' · ':''}${profile?.name??'Player '+p.id}`,p.id));}if(group.children.length)select.append(group);}
}
function selectPlayer(id){selectedPlayer=id||null;profileKey='';$('playerPicker').value=id??'';showPanel('player');renderProfile();draw();window.dispatchEvent(new Event('touchline:contextchange'));}
function node(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text!=null)el.textContent=text;return el;}
function metric(label,value,note){const box=node('div','profile-metric');box.append(node('span','',label),node('strong','',value));if(note)box.append(node('small','',note));return box;}
function renderProfile(){
  if(!selectedPlayer)return;
  const key=`${selectedPlayer}-${Math.floor(time*4)}`;if(profileKey===key)return;profileKey=key;
  const stats=playerStats(match,selectedPlayer,time),p=stats.position??match.frames.find(f=>f.players.some(p=>p.id===selectedPlayer))?.players.find(p=>p.id===selectedPlayer),profile=profiles[selectedPlayer];
  const root=$('playerContent');root.replaceChildren();
  const header=node('div','profile-header'),avatar=node('div','player-avatar',p?.number??'•'),name=node('div');avatar.classList.toggle('blue',teamIdentity(match,p?.team).isBlue);
  name.append(node('span','section-kicker',teamName(p?.team)),node('h2','',profile?.name??`Player ${selectedPlayer}`),node('p','',profile?.position??(p?.role==='goalkeeper'?'Goalkeeper':'Position not supplied')));header.append(avatar,name);root.append(header);
  root.append(node('p','profile-source',profile?.bioSynthetic?'Simulated bio & history · real player ID':profile?.source??'GSR identity · historical profile not supplied'));
  const bio=node('div','player-bio');bio.append(node('span','',profile?.age?`${profile.age} years`:'Age unavailable'),node('span','',profile?.foot?`${profile.foot}-footed`:'Foot unavailable'));root.append(bio);
  const section=node('section','profile-section');section.append(node('div','profile-section-title',`THIS REPLAY · ${clock(time)}`));
  const grid=node('div','profile-grid');
  grid.append(metric('Pass attempts',stats.passes),metric('Pass completion',stats.known?`${Math.round(stats.completed/stats.known*100)}%`:'—',stats.known?`${stats.completed}/${stats.known} known outcomes${stats.known<stats.passes?' · partial coverage':''}`:'Outcome labels unavailable'),metric('Shots / goals',`${stats.shots} / ${stats.goals}`),metric('Tracked distance',`${Math.round(stats.distance)} m`,'Within loaded frames only'));
  section.append(grid);root.append(section);
  const history=node('section','profile-section');history.append(node('div','profile-section-title',profile?.historySynthetic?'SIMULATED HISTORY':'HISTORICAL MATCHES'));
  if(profile?.history?.length){const h=historyStats(profile.history),summary=node('div','history-summary');summary.append(node('strong','',h.passes?`${(h.completed/h.passes*100).toFixed(1)}%`:'—'),node('span','',`pass completion · ${h.matches} ${profile?.historySynthetic?'example':'previous'} matches`));history.append(summary);
    for(const row of profile.history){const line=node('div','history-row'),left=node('div');left.append(node('strong','',row.match??'Previous match'),node('small','',`${row.completed??0}/${row.passes??0} passes · ${row.shots??0} shots · ${row.goals??0} goals`));const bar=node('span','history-bar');bar.style.setProperty('--completion',`${row.passes?row.completed/row.passes*100:0}%`);line.append(left,bar);history.append(line);}
  }else history.append(node('p','empty','No linked historical data. Import a profiles JSON to add names, attributes and past-match statistics.'));
  root.append(history);
  const recent=node('section','profile-section');recent.append(node('div','profile-section-title','RECENT ACTIONS'));
  if(!stats.events.length)recent.append(node('p','empty','No recorded actions yet at this replay time.'));
  for(const e of stats.events.slice(-4).reverse()){const b=node('button','profile-action',`${clock(e.t)}   ${e.label}`);b.onclick=()=>seek(e.t);recent.append(b);}root.append(recent);
}
function pointerPosition(event){const rect=canvas.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};}
function playerAtPointer(pos){if(!geometry)return null;let nearest=null,minimum=16;for(const p of atTime(match.frames,time)){if(p.role==='referee')continue;const x=geometry.x0+(p.x+52.5)*geometry.scale,y=geometry.y0+(p.y+34)*geometry.scale,d=Math.hypot(pos.x-x,pos.y-y);if(d<minimum){minimum=d;nearest=p;}}return nearest;}
canvas.onclick=event=>{const player=playerAtPointer(pointerPosition(event));if(player)selectPlayer(player.id);};
canvas.onpointermove=event=>{canvas.style.cursor=playerAtPointer(pointerPosition(event))?'pointer':'default';};
$('eventsTab').onclick=()=>showPanel('events');$('playerTab').onclick=()=>showPanel('player');$('playerPicker').onchange=e=>selectPlayer(e.target.value);
mountChat({getContext:()=>buildReplaySnapshot({match,profiles,time,selectedPlayer,directions}),getSummary:()=>({matchId:match.title,half:match.half,time,playerName:profiles[selectedPlayer]?.name??(selectedPlayer?`Player ${selectedPlayer}`:null)}),onSeek:seek});

mountMoveForecast(()=>({match,profiles,time,directions}));
miniPitch=mountFloatingPitch({canvas,getState:()=>({match,time,playing}),getGeometry:()=>geometry,onTogglePlay:()=>$('playBtn').click()});

let replayLoadId=0;const realReplayCache=new Map();
async function chooseReplay(value){
  const id=++replayLoadId;setPlaying(false);
  if(value==='demo'){resetDemo();return;}
  const half=Number(value),status=$('replaySourceStatus');status.textContent=`Loading half ${half}…`;
  try{
    const replay=realReplayCache.get(half)??await fetchRealReplay(half);
    if(id!==replayLoadId)return;
    realReplayCache.set(half,replay);match=replay;loaded={gsr:null,bas:null,half,matchId:'117092'};loadMatch();
    status.textContent=`Half ${half} loaded · ${match.frames.length.toLocaleString()} position snapshots · ${match.events.length.toLocaleString()} events. Select the other half above for the rest of the match.`;
  }catch(error){if(id!==replayLoadId)return;status.textContent=`${error.message} Choose a replay again to retry. The existing replay is unchanged.`;}
}
$('replaySource').onchange=e=>{void chooseReplay(e.target.value);};
void chooseReplay('1');
