import {profileModelRole} from './player-roles.js';
import {atTime} from './model.js';

// Explicitly synthetic enrichment for createDemo only. Durations, pressure,
// recipients and possession boundaries are scripted assumptions, not detections.
export function buildForecastDemo(match,profiles){
  if(match.synthetic!==true)throw Error('Synthetic enrichment is available only for the built-in demo.');
  const roles=Object.fromEntries(Object.entries(profiles).map(([id,p])=>[id,profileModelRole(p)]));
  let possession=0,team=null;const moves=[];
  for(const [i,e] of match.events.entries()){
    if(team!==e.team){possession++;team=e.team;}
    const pass=['Pass','High Pass','Cross'].includes(e.label),carry=e.label==='Drive';
    if(!pass&&!carry){possession++;continue;}
    const duration=carry?2.4:1.2,startTime=Math.max(0,e.t-duration),receiverId=pass?`${e.team}-${e.to}`:null;
    const source=atTime(match.frames,startTime).find(p=>p.id===e.playerId),destination=atTime(match.frames,e.t).find(p=>p.id===(receiverId??e.playerId));
    if(!source||!destination)throw Error('Synthetic action endpoint is unavailable.');
    moves.push({id:e.id,half:match.half,team:e.team,possessionId:`demo-${possession}`,label:e.label,completed:pass?e.passComplete:true,playerId:e.playerId,receiverId,startTime,endTime:e.t,start:{x:source.x,y:source.y},end:{x:destination.x,y:destination.y},direction:e.team==='left'?1:-1,underPressure:i%3===1});
    if(e.passComplete===false)possession++;
  }
  return {synthetic:true,coordinateSystem:'center_meters',completeMoveHistory:true,roles,moves};
}
export function latestDemoMove(data,time){return data.moves.filter(m=>m.completed===true&&m.endTime<=time).at(-1)??null;}
