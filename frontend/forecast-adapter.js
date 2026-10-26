// Pure conversion layer; usable in Node and in the browser/Workers.
// Input is enriched BAS, not raw video. No success, pressure or possession
// labels are inferred from tracking proximity or later events.
import {MODEL_ROLES} from './player-roles.js';
export {MODEL_ROLES} from './player-roles.js';
const PASS=new Set(['Pass','High Pass','Cross']);
const CARRY=new Set(['Drive','Carry']);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const identity=v=>(typeof v==='string'&&v.trim()!=='')||(typeof v==='number'&&Number.isFinite(v));
function point(p,system){
  if(!p||!finite(p.x)||!finite(p.y))return null;
  const x=system==='center_meters'?(p.x+52.5)/105:p.x;
  const y=system==='center_meters'?(p.y+34)/68:p.y;
  return x>=0&&x<=1&&y>=0&&y<=1?{x,y}:null;
}
function geometry(move,system){
  const start=point(move.start,system),end=point(move.end,system);
  if(!start||!end||![1,-1].includes(move.direction))return null;
  // Rotate both axes to put the attacking goal at (105, 34).
  const orient=p=>move.direction===1?p:{x:1-p.x,y:1-p.y};
  const a=orient(start),b=orient(end),dx=(b.x-a.x)*105,dy=(b.y-a.y)*68;
  const gx=(1-b.x)*105,gy=(.5-b.y)*68;
  // Angle between vectors to the posts; atan2 handles positions on the goal line.
  const cross=Math.abs(gx*7.32),dot=gx*gx+gy*gy-3.66*3.66;
  return {goal_distance_m:Math.hypot(gx,gy),goal_angle_rad:Math.atan2(cross,dot),lateral_squared:(b.y-.5)**2,forward_progress_m:dx,distance:Math.hypot(dx,dy)};
}
/**
 * Input: {coordinateSystem, completeMoveHistory, moves, roles?, asOfSeconds?}.
 * moves must contain every pass/carry attempt for the included possessions,
 * including unsuccessful attempts. Times are action START and END seconds in
 * a single replay clock per half. possessionId must change at each turnover.
 * Returns Forecaster-ready records, provenance, blocked rows and ignored rows.
 */
export function prepareForecast(input){
  if(!input||!Array.isArray(input.moves))throw Error('Provide an enriched BAS moves array.');
  if(!['center_meters','normalized'].includes(input.coordinateSystem))throw Error('Declare coordinateSystem: center_meters or normalized.');
  if(input.completeMoveHistory!==true)throw Error('completeMoveHistory must be true: provide all moves, not only selected-player events.');
  const cutoff=input.asOfSeconds??Infinity;if(!(cutoff===Infinity||finite(cutoff)&&cutoff>=0))throw Error('Invalid asOfSeconds.');
  const report={synthetic:input.synthetic===true,records:[],mapping:[],blocked:[],ignored:[],warnings:['Pressure, outcomes, receiver roles and possession labels require verified source data. GSR player coordinates are not automatically treated as ball/action endpoints.']};
  const entries=input.moves.map((m,index)=>{
    if(!m||typeof m!=='object'||Array.isArray(m))throw Error(`Move ${index} must be an object.`);
    const label=m.label??m.type,kind=PASS.has(label)?'pass':CARRY.has(label)?'carry':null;
    const completed=m.completed??m.pass_complete??m.passComplete;
    return {m,index,id:m.id??`move-${index}`,kind,completed,g:geometry(m,input.coordinateSystem)};
  });
  // Forecast geometry is causal: only moves ending at/before this prediction
  // enter the five-second history, never those ending later in the replay.
  for(const entry of entries){
    const {m,index,id,kind,completed,g}=entry;
    if(!kind){report.ignored.push({index,id,reason:'Not a pass/carry forecast landmark.'});continue;}
    if(completed===false){report.ignored.push({index,id,reason:'Unsuccessful move.'});continue;}
    if(finite(m.endTime)&&m.endTime>cutoff){report.ignored.push({index,id,reason:'After the captured replay time.'});continue;}
    const reasons=[];
    if(completed!==true)reasons.push('completed: an explicit successful outcome is required');
    if(!finite(m.startTime)||!finite(m.endTime)||m.startTime<0||m.endTime<=m.startTime)reasons.push('startTime/endTime: require a positive duration in seconds');
    if(!identity(m.team))reasons.push('team: missing');
    if(!identity(m.possessionId))reasons.push('possessionId: missing');
    if(![1,2].includes(m.half))reasons.push('half: must be 1 or 2');
    if(!g)reasons.push('start/end/direction: require pitch coordinates and attack direction (+1 or -1)');
    if(typeof m.underPressure!=='boolean')reasons.push('underPressure: an explicit boolean is required');
    const holder=kind==='pass'?m.receiverId:m.playerId;
    const role=kind==='pass'?(m.receiverRole??input.roles?.[holder]):(m.playerRole??input.roles?.[holder]);
    if(!MODEL_ROLES.includes(role))reasons.push(`${kind==='pass'?'receiverRole':'playerRole'}: require one of the six model roles`);
    // Reject incomplete recent history instead of silently undercounting it.
    const recent=entries.filter(e=>e.kind&&e.completed!==false&&e.m.team===m.team&&e.m.half===m.half&&e.m.possessionId===m.possessionId&&(!finite(e.m.endTime)||e.m.endTime>=m.endTime-5&&e.m.endTime<=m.endTime));
    if(recent.some(e=>e.completed!==true||!e.g||!finite(e.m.endTime)||e.m.direction!==m.direction))reasons.push('recent_5s: incomplete outcomes, geometry or inconsistent directions in this possession');
    if(entries.some(e=>e.kind&&e.completed!==false&&(!identity(e.m.team)||!identity(e.m.possessionId)||![1,2].includes(e.m.half)||!finite(e.m.endTime))))reasons.push('recent_5s: source contains moves with unknown time, half, team or possession; completeness cannot be verified');
    if(reasons.length){report.blocked.push({index,id,reasons});continue;}
    const features={goal_distance_m:g.goal_distance_m,goal_angle_rad:g.goal_angle_rad,lateral_squared:g.lateral_squared,is_pass:kind==='pass'?1:0,forward_progress_m:g.forward_progress_m,move_speed_mps:g.distance/(m.endTime-m.startTime),is_cross:(m.label??m.type)==='Cross'?1:0,recent_5s_count:recent.length,recent_5s_forward_m:recent.reduce((sum,e)=>sum+e.g.forward_progress_m,0),under_pressure:m.underPressure?1:0};
    report.records.push({role,features});report.mapping.push({recordIndex:report.records.length-1,inputIndex:index,id,endTimeSeconds:m.endTime,half:m.half,team:m.team,possessionId:m.possessionId,holderId:holder??null});
  }
  return report;
}
