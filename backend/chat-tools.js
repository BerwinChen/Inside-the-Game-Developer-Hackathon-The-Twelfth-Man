import {historyStats,zoneAt} from '../frontend/analytics.js';
import {clock} from '../frontend/model.js';

export class InputError extends Error {}
const str=(v,max=200)=>typeof v==='string'?v.slice(0,max):'';
function number(v,min,max,name){if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new InputError(`Invalid ${name}.`);return v;}
function optionalCount(v){return v==null?null:number(v,0,1e8,'statistic');}
export function validateSnapshot(raw) {
  if(!raw||typeof raw!=='object')throw new InputError('Replay context is missing.');
  const time=number(raw.time,0,20000,'replay time');
  if(!Array.isArray(raw.players)||raw.players.length>32||!Array.isArray(raw.events)||raw.events.length>120)throw new InputError('Replay snapshot is too large.');
  const players=raw.players.map(p=>{
    if(!p||!str(p.id)||!Array.isArray(p.history)||p.history.length>10||!p.stats)throw new InputError('Invalid player profile.');
    const stats=Object.fromEntries(['passes','known','completed','shots','goals','tackles','distance'].map(k=>[k,optionalCount(p.stats[k])]));
    if(stats.completed>stats.known||stats.known>stats.passes)throw new InputError('Inconsistent passing statistics.');
    const history=p.history.map(h=>{const row={match:str(h.match),...Object.fromEntries(['passes','completed','shots','goals','minutes'].map(k=>[k,optionalCount(h[k])]))};if(row.completed>row.passes)throw new InputError('Inconsistent historical passing statistics.');return row;});
    return {id:str(p.id),name:str(p.name),number:p.number==null?null:str(String(p.number),8),team:['left','right'].includes(p.team)?p.team:null,role:str(p.role),age:p.age==null?null:number(p.age,0,120,'age'),foot:str(p.foot,20),source:str(p.source,300),history,stats,position:p.position?{x:number(p.position.x,-80,80,'x coordinate'),y:number(p.position.y,-60,60,'y coordinate')}:null};
  });
  if(new Set(players.map(p=>p.id)).size!==players.length)throw new InputError('Duplicate player IDs.');
  const events=raw.events.map(e=>({id:str(e.id),t:number(e.t,0,time,'event timestamp'),label:str(e.label,50),team:['left','right'].includes(e.team)?e.team:null,playerId:e.playerId==null?null:str(e.playerId),passComplete:typeof e.passComplete==='boolean'?e.passComplete:null}));
  const left=raw.directions?.left===-1?-1:1;
  return {matchId:str(raw.matchId),home:str(raw.home),away:str(raw.away),half:raw.half===2?2:1,time,synthetic:raw.synthetic===true,
    selectedPlayerId:players.some(p=>p.id===raw.selectedPlayerId)?raw.selectedPlayerId:null,
    directions:{left,right:-left},players,events:events.sort((a,b)=>a.t-b.t),totalPastEvents:number(raw.totalPastEvents??events.length,events.length,1e6,'event count'),
    score:raw.score?{home:number(raw.score.home,0,100,'score'),away:number(raw.score.away,0,100,'score')}:null,
    provenance:'Browser-supplied replay snapshot, not independently verified. Synthetic flag and profile source describe the supplied data.'};
}
const ids={type:'array',items:{type:'string'},maxItems:8,description:'Player IDs, names or #numbers. Empty array means the selected player. Use list_players to resolve ambiguous names.'};
const nullableTime={type:['number','null'],description:'Time in SECONDS, never minutes. Null means the captured replay time. Statistics are only available at that captured time.'};
const tool=(name,description,properties)=>({type:'function',name,description,strict:true,parameters:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}});
export const FUNCTION_TOOLS=[
  tool('get_match_summary','Read the captured match identity, replay time, score, available data and model scope.',{}),
  tool('list_players','Resolve one or more player identities in the CURRENT replay. Does not search real-world football rosters.',{query:{type:'string',description:'Name, ID, shirt number or empty string to list the roster.'}}),
  tool('get_player_profiles','Read profiles and historical statistics for one or multiple replay players. Respect the source and synthetic labels.',{player_ids:ids}),
  tool('get_player_match_stats','Compare players using current-replay statistics, with explicit passing outcome coverage. Never infer unknown success rates.',{player_ids:ids,at_time:nullableTime}),
  tool('get_match_events','Read available past replay events. Return times that the user can jump to; never return future events.',{start_time:{type:['number','null'],description:'Replay time in seconds; null starts at zero.'},end_time:{type:['number','null'],description:'Replay time in seconds; null ends at the captured time.'},player_ids:{...ids,description:'Empty array means all players for this tool.'}}),
  tool('get_scoring_potential','Read location-only Markov scoring potential. NOT shot xG, win probability or a player-specific prediction. Null coordinates use the selected player position; no ball location is assumed.',{x:{type:['number','null'],description:'Center-origin meters, -52.5 to 52.5.'},y:{type:['number','null'],description:'Center-origin meters, -34 to 34.'},team:{type:['string','null'],enum:['left','right',null]}})
];
function resolve(snapshot,selectors,selected=true){
  if(!Array.isArray(selectors)||selectors.length>8||selectors.some(v=>typeof v!=='string'||v.length>200))throw new InputError('Provide up to eight player IDs or names.');
  if(!selectors.length){if(!selected)return snapshot.players;if(!snapshot.selectedPlayerId)throw new InputError('No player is selected. Ask the user to select a player or specify a name.');selectors=[snapshot.selectedPlayerId];}
  const result=new Map();for(const selector of selectors){const q=selector.trim().toLowerCase();if(!q)throw new InputError('Player selector is empty.');const exact=snapshot.players.filter(p=>p.id.toLowerCase()===q||p.name.toLowerCase()===q);const matches=exact.length?exact:snapshot.players.filter(p=>p.name.toLowerCase().includes(q)||String(p.number)===q.replace(/^#/,''));
    if(!matches.length)throw new InputError(`No replay player matches ${selector}.`);
    if(matches.length>1)throw new InputError(`Ambiguous player ${selector}. Choose an ID: ${matches.map(p=>`${p.name} (${p.id})`).join(', ')}.`);
    result.set(matches[0].id,matches[0]);
  }return [...result.values()];
}
export function queryTool(name,args,snapshot,model) {
  if(!args||typeof args!=='object'||Array.isArray(args))throw new InputError('Tool arguments must be an object.');
  const base={time:snapshot.time,timeUnit:'seconds',replayClock:clock(snapshot.time),clockFormat:'mm:ss',half:snapshot.half,synthetic:snapshot.synthetic,provenance:snapshot.provenance};
  if(name==='get_match_summary')return {...base,matchId:snapshot.matchId,home:snapshot.home,away:snapshot.away,score:snapshot.score,selectedPlayerId:snapshot.selectedPlayerId,players:snapshot.players.length,totalPastEvents:snapshot.totalPastEvents,eventWindowStart:snapshot.events[0]?.t??null};
  if(name==='list_players'){const q=str(args.query).trim().toLowerCase();return {...base,players:snapshot.players.filter(p=>!q||p.name.toLowerCase().includes(q)||p.id.toLowerCase().includes(q)||String(p.number)===q.replace(/^#/,'' )).map(({id,name,number,team,role})=>({id,name,number,team,role}))};}
  if(name==='get_player_profiles')return {...base,players:resolve(snapshot,args.player_ids).map(p=>({id:p.id,name:p.name,team:p.team,number:p.number,role:p.role,age:p.age,foot:p.foot,source:p.source,history:p.history,historySummary:p.history.length?historyStats(p.history):null}))};
  if(name==='get_player_match_stats'){
    if(args.at_time!=null&&(typeof args.at_time!=='number'||Math.abs(args.at_time-snapshot.time)>.05))throw new InputError('Statistics are available only at the captured replay time. Seek to the desired time and ask again.');
    return {...base,players:resolve(snapshot,args.player_ids).map(p=>({id:p.id,name:p.name,source:p.source,...p.stats,position:p.position,passCompletion:p.stats.known>0?p.stats.completed/p.stats.known:null,outcomeCoverage:p.stats.passes>0?p.stats.known/p.stats.passes:null,distanceScope:'Tracked distance within loaded frames, not full-match distance.'}))};
  }
  if(name==='get_match_events'){
    const start=args.start_time==null?0:number(args.start_time,0,snapshot.time,'start time'),end=args.end_time==null?snapshot.time:number(args.end_time,0,snapshot.time,'end time');if(start>end)throw new InputError('Event range is reversed.');
    const ids=new Set(resolve(snapshot,args.player_ids,false).map(p=>p.id));return {...base,availableWindowStart:snapshot.events[0]?.t??null,truncated:snapshot.totalPastEvents>snapshot.events.length,events:snapshot.events.filter(e=>e.t>=start&&e.t<=end&&(!args.player_ids.length||ids.has(String(e.playerId)))).slice(-30).map(e=>({...e,timeUnit:'seconds',replayClock:clock(e.t)}))};
  }
  if(name==='get_scoring_potential'){
    const selected=snapshot.players.find(p=>p.id===snapshot.selectedPlayerId);let x=args.x,y=args.y;
    if(x==null&&y==null){if(!selected?.position)throw new InputError('No position is selected. Select a player or provide pitch coordinates.');({x,y}=selected.position);}
    x=number(x,-52.5,52.5,'pitch x');y=number(y,-34,34,'pitch y');
    const team=args.team??selected?.team;if(!['left','right'].includes(team))throw new InputError('Specify which team is attacking: left or right.');
    const zone=zoneAt(model,x,y,snapshot.directions[team]);return {...base,x,y,team,direction:snapshot.directions[team],probability:zone.value,historicalActionsInZone:zone.samples,metric:'Location-only probability of scoring before a modeled possession ends',not:'Not shot xG, a player forecast, match scoring probability or win probability.',assumptions:model.meta.scope,source:model.meta.source,trainingMatches:model.meta.matches};
  }
  throw new InputError('Unknown tool.');
}
