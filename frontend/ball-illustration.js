import {atTime} from './model.js';
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
// Display-only waypoints inferred from event actors. These may use the next
// event for interpolation and must never feed statistics, forecasts or AI tools.
export function createBallIllustration(match){
  const points=[];
  for(const event of match.events){
    const actor=atTime(match.frames,event.t).find(p=>p.id===String(event.playerId));
    if(event.label==='Goal'){const direction=match.directions?.[event.team]??(event.team==='right'?-1:1);points.push({t:event.t,x:direction*52.5,y:0,kind:'goal',restartTeam:event.team==='left'?'right':'left'});continue;}
    if(!actor||actor.role==='referee'||!Number.isFinite(actor.x)||!Number.isFinite(actor.y))continue;
    const direction=match.directions?.[actor.team]??(actor.team==='right'?-1:1);
    points.push({t:event.t,x:clamp(actor.x+direction*.9,-52.5,52.5),y:clamp(actor.y+.7,-34,34),actorId:actor.id});
  }
  return points;
}
export function illustrativeBallAt(points,time,players){
  if(!players.length)return null;
  if(!points.length)return {x:0,y:0,illustrative:true};
  let lo=0,hi=points.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(points[mid].t<=time)lo=mid;else hi=mid-1;}
  const a=points[lo],b=points[Math.min(lo+1,points.length-1)];
  if(time<a.t)return a.kind==='goal'?{x:0,y:0,illustrative:true}:{...a,illustrative:true};
  if(a.kind==='goal'){
    const elapsed=time-a.t,phase=b.t>a.t?Math.min(1.2,(b.t-a.t)/3):1.2;
    const u=clamp((elapsed-phase)/phase,0,1),smooth=u*u*(3-2*u);
    return {x:a.x*(1-smooth),y:0,illustrative:true,restartTeam:a.restartTeam,phase:u===1?'kickoff':'goal'};
  }
  // Long event gaps do not imply a long, slow pass. Follow the last actor
  // loosely, then blend towards the next event in a short illustrative move.
  const actor=players.find(p=>p.id===a.actorId),gap=b.t-a.t;
  const start=gap>5&&actor?{x:clamp(actor.x+.9,-52.5,52.5),y:clamp(actor.y+.7,-34,34)}:a;
  const u=gap>0?clamp((time-Math.max(a.t,b.t-3))/Math.min(gap,3),0,1):0;
  const smooth=u*u*(3-2*u);
  return {x:clamp(start.x+(b.x-start.x)*smooth,-52.5,52.5),y:clamp(start.y+(b.y-start.y)*smooth,-34,34),illustrative:true};
}
