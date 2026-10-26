import {unifyProfileRole} from './player-roles.js';
import {atTime} from './model.js';

export const isPass = e => ['Pass','High Pass','Cross'].includes(e.label);
const names = ['Oliver Reed','Theo Brooks','Lucas Hart','Noah Ellis','Leo Clarke','Ethan Cole','Adam Hayes','Finn Walsh','Max Bennett','Alex Mercer','Jamie Ross','Daniel Quinn','Oscar Blake','Sam Palmer','Jack Foster','Harry Lane','Charlie West','Ben Archer','Toby Grant','Luke Mason','Ryan Shaw','Jude Carter'];
const positions = ['Goalkeeper','Left back','Center back','Center back','Right back','Left midfield','Central midfield','Right midfield','Left wing','Striker','Right wing'];
export function demoProfiles() {
  return Object.fromEntries(names.map((name,i)=>{
    const n=i%11+1, team=i<11?'left':'right';
    const history=Array.from({length:5},(_,j)=>{const passes=18+(i*13+j*7)%51,completed=Math.round(passes*(.72+((i+j)%7)*.03));return {match:`Previous match ${5-j}`,passes,completed,shots:n>=9?(i+j)%4:0,goals:n>=9&&j===i%5?1:0,minutes:90};});
    return [`${team}-${n}`,unifyProfileRole({id:`${team}-${n}`,name,position:positions[n-1],age:21+i%10,foot:i%4===0?'Left':'Right',number:n,team,history,source:'Fictional profile · simulated history'})];
  }));
}
export function playerStats(match,id,t) {
  const events=match.events.filter(e=>e.t<=t&&String(e.playerId)===String(id));
  const passes=events.filter(isPass),known=passes.filter(e=>typeof e.passComplete==='boolean');
  let distance=0,previous=null;
  for(const frame of match.frames){if(frame.t>t)break;const p=frame.players.find(p=>p.id===id);if(p&&previous&&frame.t-previous.t<=1)distance+=Math.hypot(p.x-previous.x,p.y-previous.y);previous=p?{...p,t:frame.t}:null;}
  return {events,passes:passes.length,known:known.length,completed:known.filter(e=>e.passComplete).length,shots:events.filter(e=>e.label==='Shot').length,goals:events.filter(e=>e.label==='Goal').length,tackles:events.filter(e=>e.label==='Player Successful Tackle').length,distance,position:atTime(match.frames,t).find(p=>p.id===id)};
}
export function historyStats(rows){
  const result={matches:rows.length,passes:0,completed:0,shots:0,goals:0};
  for(const row of rows)for(const key of ['passes','completed','shots','goals'])result[key]+=row[key]??0;
  return result;
}
export function normalizeProfiles(data){
  if(!Array.isArray(data.profiles))throw Error('Profiles JSON requires a profiles array.');
  const profiles={};for(const p of data.profiles){if(p.id==null)throw Error('Each profile requires an id matching the GSR player ID.');
    if(p.history!=null&&!Array.isArray(p.history))throw Error('Profile history must be an array.');
    for(const h of p.history??[]){for(const k of ['passes','completed','shots','goals'])if(h[k]!=null&&(!Number.isFinite(h[k])||h[k]<0))throw Error('Historical statistics must be nonnegative numbers.');if((h.completed??0)>(h.passes??0))throw Error('Completed passes cannot exceed attempted passes.');}
    profiles[String(p.id)]=unifyProfileRole({...p,id:String(p.id),source:p.source??'User-provided profile'});
  }return profiles;
}
export function zoneAt(model,x,y,direction=1){
  const col=Math.min(model.nx-1,Math.max(0,Math.floor((direction*x+52.5)/105*model.nx)));
  const row=Math.min(model.ny-1,Math.max(0,Math.floor((direction*y+34)/68*model.ny)));
  const i=row*model.nx+col;
  return {i,col,row,value:model.values[i],samples:model.counts[i],shotRate:model.shots[i]?model.goals[i]/model.shots[i]:null,passRate:model.passes[i]?model.completed[i]/model.passes[i]:null};
}
