export const labels = {Pass:'Pass',Drive:'Carry',Header:'Header','High Pass':'High pass',Out:'Out',Cross:'Cross','Throw In':'Throw-in',Shot:'Shot','Ball Player Block':'Block','Player Successful Tackle':'Tackle','Free Kick':'Free kick',Goal:'Goal'};
export const clock = t => `${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;
const formations = [[-48,0],[-31,-24],[-34,-8],[-34,9],[-31,24],[-15,-18],[-18,0],[-13,18],[3,-23],[8,0],[3,23]];
export function createDemo() {
  const spec = [[3,'Pass',6,7],[9,'Pass',7,8],[15,'Drive',8,8],[22,'High Pass',8,11],[29,'Cross',11,10],[34,'Shot',10,10],[36,'Ball Player Block',3,3],[41,'Pass',3,6],[47,'Drive',6,6],[54,'Pass',6,9],[61,'Player Successful Tackle',2,2],[66,'Pass',2,7],[73,'Pass',7,9],[80,'Drive',9,9],[87,'Cross',9,10],[93,'Header',10,10],[94,'Goal',10,10],[104,'Pass',10,7],[111,'Pass',7,6],[117,'Drive',6,6]];
  const events=spec.map(([t,label,n,to],i)=>({t,label,team:i>=6&&i<=9||i>=17?'right':'left',playerId:`${i>=6&&i<=9||i>=17?'right':'left'}-${n}`,number:n,to, id:`demo-${i}`,half:1,passComplete:['Pass','High Pass','Cross'].includes(label)?i!==9:null}));
  const frames=[];
  for(let frame=0;frame<=600;frame++){const t=frame/5;const ev=[...events].reverse().find(e=>e.t<=t);const attack=ev?.team==='right'?-1:1;const shift=8*Math.sin(t*.065)+4*attack;
    const players=[];for(const team of ['left','right'])for(let j=0;j<11;j++){const side=team==='left'?1:-1;const base=formations[j];players.push({id:`${team}-${j+1}`,number:j+1,team,role:j===0?'goalkeeper':'player',x:side*base[0]+(j?shift:shift*.12)+Math.sin(t*.19+j*1.7)*1.8,y:side*base[1]+Math.cos(t*.15+j)*2.1});}
    players.push({id:'ref',team:null,number:null,role:'referee',x:shift-5,y:7+Math.sin(t*.12)*6});
    frames.push({t:+t.toFixed(2),players});
  }
  return {frames,events,duration:120,half:1,synthetic:true,ballMode:'illustration',home:'North FC',away:'South FC',title:'The game, beyond the scoreline.'};
}
export function normalizeBAS(data,half=1){
  const rows=Array.isArray(data)?data:(data.annotations??data.actions);
  if(!Array.isArray(rows))throw Error('BAS requires an annotations array.');
  const events=rows.filter(r=>r.label&&(!r.gameTime||Number(r.gameTime.split(' - ')[0])===half)).map((r,i)=>{
    const t=r.t!=null?Number(r.t):Number(r.position)/1000;
    if(!Number.isFinite(t)||t<0)throw Error('Invalid event time. Supply t in seconds or position in milliseconds.');
    const label=Object.keys(labels).find(key=>key.toUpperCase()===String(r.label).toUpperCase())??r.label;
    return {id:`bas-${i}`,t,label,team:r.team??null,playerId:r.player_id==null?null:String(r.player_id),half,number:r.jersey_number??null,passComplete:typeof r.pass_complete==='boolean'?r.pass_complete:typeof r.passComplete==='boolean'?r.passComplete:null};
  }).sort((a,b)=>a.t-b.t);
  if(!events.length)throw Error('No action events for this half.');
  return events;
}
export function normalizeGSR(data){
  // Released SoccerTrack files use prefixed frame IDs. Derive local time from
  // the images table / lowest image ID, never from the full prefixed number.
  if(Array.isArray(data.frames)){
    const frames=data.frames.map(f=>({t:Number(f.t),players:f.players.map(p=>({...p,id:String(p.id),x:Number(p.x),y:Number(p.y)}))}));
    return validateFrames(frames);
  }
  const rows=Array.isArray(data)?data:data.annotations;
  if(!Array.isArray(rows))throw Error('GSR requires an annotations or frames array.');
  const fps=Number(data.info?.frame_rate??25);if(!(fps>0))throw Error('Invalid GSR frame rate.');
  const ids=(data.images?.length?data.images:rows).map(r=>Number(r.image_id??r.id)).filter(Number.isFinite);
  const origin=ids.reduce((a,b)=>Math.min(a,b),Infinity);
  const imageTimes=new Map((data.images??[]).map(r=>[String(r.image_id??r.id),(Number(r.image_id??r.id)-origin)/fps]));
  const groups=new Map();
  for(const r of rows){if(r.supercategory&&r.supercategory!=='object')continue;const a=r.attributes??r;const box=r.bbox_pitch??{};const x=Number(r.x??box.x_bottom_middle),y=Number(r.y??box.y_bottom_middle);if(!Number.isFinite(x)||!Number.isFinite(y))continue;
    const t=r.t!=null?Number(r.t):imageTimes.get(String(r.image_id))??(Number(r.image_id)-origin)/fps;
    if(!Number.isFinite(t)||t<0)continue;
    const p={id:String(a.player_id??r.track_id??r.id),number:a.jersey_number??a.jersey??null,team:a.team_side??a.team??null,role:a.role??'player',x,y};
    if(!groups.has(t))groups.set(t,[]);groups.get(t).push(p);
  }
  return validateFrames([...groups].map(([t,players])=>({t,players})));
}
function validateFrames(frames){
  if(!frames.length)throw Error('No valid player positions found.');
  for(const f of frames){if(!Number.isFinite(f.t)||f.t<0||!Array.isArray(f.players)||f.players.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw Error('Position data contains invalid times or coordinates.');}
  return frames.sort((a,b)=>a.t-b.t);
}
export function atTime(frames,t){
  if(!frames.length||t<frames[0].t)return [];
  let lo=0,hi=frames.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(frames[mid].t<=t)lo=mid;else hi=mid-1;}
  const a=frames[lo],b=frames[Math.min(lo+1,frames.length-1)];
  if(b.t-a.t>1||a===b)return a.players;
  const u=Math.max(0,Math.min(1,(t-a.t)/(b.t-a.t||1))),next=new Map(b.players.map(p=>[p.id,p]));
  return a.players.map(p=>{const q=next.get(p.id)??p;return {...p,x:p.x+(q.x-p.x)*u,y:p.y+(q.y-p.y)*u};});
}
export function classify(data){
  if(Array.isArray(data.profiles))return 'profiles';
  if(Array.isArray(data.frames))return 'gsr';
  const r=(Array.isArray(data)?data:(data.annotations??data.actions))?.find(r=>r.label||r.bbox_pitch||r.x!=null||r.supercategory==='object');
  if(r?.label)return 'bas';if(r&&(r.bbox_pitch||r.x!=null))return 'gsr';
  throw Error('Unrecognized file. Choose GSR, BAS or player profiles JSON.');
}
