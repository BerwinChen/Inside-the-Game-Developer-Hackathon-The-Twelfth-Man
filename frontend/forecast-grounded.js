import {profileModelRole} from './player-roles.js';
// Reproducible, tracking-grounded simulation. This never changes source labels.
// Every generated completion/recipient/role/pressure/possession remains inferred.
import {pastFrame} from './forecast-live.js';
const passes=new Set(['Pass','High Pass','Cross']);
const moves=new Set([...passes,'Drive','Carry']);
const stops=new Set(['Out','Goal','Shot','Free Kick','Throw In']);
const inside=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<=52.5&&Math.abs(p.y)<=34;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const point=p=>({x:p.x,y:p.y});
function hash(text){let n=2166136261;for(const c of String(text))n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0;}
function observed(match,time,id){const frame=pastFrame(match.frames,time);if(!frame||time-frame.t>1.05)return null;const p=frame.players.find(p=>p.id===String(id));return inside(p)?{...p,observedAt:frame.t}:null;}
function roleAt(match,time,id){
  const player=observed(match,time,id);return player?profileModelRole(match.profiles?.[id],player.role):null;
}
function pressureAt(match,time,actor){
  const frame=pastFrame(match.frames,time),opponents=frame?.players.filter(p=>p.team&&p.team!==actor.team&&p.role!=='referee'&&inside(p))??[];
  if(!opponents.length)return null;
  const closest=opponents.map(p=>({p,d:distance(actor,p)})).sort((a,b)=>a.d-b.d)[0];
  const previousActor=observed(match,time-1,actor.id),previousOpponent=observed(match,time-1,closest.p.id);
  const dt=previousActor?actor.observedAt-previousActor.observedAt:0;
  const closing=previousActor&&previousOpponent&&dt>0?(distance(previousActor,previousOpponent)-closest.d)/dt:0;
  return {value:closest.d<3||(closest.d<5&&closing>1.5),nearestOpponentM:closest.d,closingMps:closing};
}
function corridorClearance(a,b,opponents){
  const dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy;let clearance=10;
  for(const p of opponents){const u=((p.x-a.x)*dx+(p.y-a.y)*dy)/length2;if(u<=.08||u>=.92)continue;clearance=Math.min(clearance,Math.hypot(p.x-a.x-u*dx,p.y-a.y-u*dy));}return clearance;
}
function recipientAt(match,event,actor,direction){
  const frame=pastFrame(match.frames,event.t),high=event.label!=='Pass';
  const opponents=frame.players.filter(p=>p.team&&p.team!==actor.team&&inside(p));
  const candidates=frame.players.filter(p=>p.team===actor.team&&p.id!==actor.id&&p.role!=='referee'&&inside(p)).map(p=>{
    const d=distance(actor,p),clearance=corridorClearance(actor,p,opponents),space=opponents.length?Math.min(...opponents.map(q=>distance(p,q))):0;
    const forward=direction*(p.x-actor.x);
    const score=Math.min(space,8)*.3+Math.min(clearance,5)*.35+forward*.025-d*.025+(event.label==='Cross'?(Math.abs(p.y)<14?1:-1):0);
    return {p,d,score,clearance};
  }).filter(c=>c.d>=3&&c.d<=(high?65:45)&&c.clearance>=(high?.3:1)).sort((a,b)=>b.score-a.score||a.p.id.localeCompare(b.p.id));
  if(!candidates.length)return null;
  // Seeded choice among three plausible options, not an asserted true target.
  return candidates[hash(event.id)%Math.min(3,candidates.length)];
}
export function buildGroundedSimulation(match,directions=match.directions??{left:1,right:-1}){
  if(match.synthetic)throw Error('Tracking-grounded simulation expects the real source replay.');
  const rows=[],unresolved=[];let possession=0,lastTeam=null;
  for(let i=0;i<match.events.length;i++){
    const event=match.events[i],next=match.events[i+1];
    if(event.team!==lastTeam){possession++;lastTeam=event.team;}
    if(stops.has(event.label)){possession++;continue;}
    if(!moves.has(event.label))continue;
    const fail=reason=>{unresolved.push({id:event.id,sourceTime:event.t,reason});possession++;};
    const direction=directions[event.team],actor=observed(match,event.t,event.playerId);
    if(!actor||actor.team!==event.team||![1,-1].includes(direction)){fail('Actor tracking or attack direction is missing.');continue;}
    const pressure=pressureAt(match,event.t,actor);if(!pressure){fail('Pressure cannot be approximated without opposing positions.');continue;}
    const pass=passes.has(event.label);let startTime,endTime,start,end,receiverId=null,completed=true,outcome='Simulated completion',receiverMethod='Not applicable to carry',durationMethod;
    let candidate=null;
    if(pass){
      candidate=recipientAt(match,event,actor,direction);if(!candidate){fail('No physically plausible teammate/corridor candidate.');continue;}
      const speed=event.label==='Pass'?12:event.label==='Cross'?16:18;
      startTime=event.t;endTime=event.t+Math.max(.25,candidate.d/speed);start=actor;receiverId=candidate.p.id;
      receiverMethod='Seeded plausible teammate, ranked by distance, progress, space and passing corridor';durationMethod=`Assumed ${speed} m/s straight-line ball travel`;
      // A later action can constrain the simulation only once observed. No
      // event after the resulting availability time contributes a feature.
      if(next&&next.t<=endTime){
        if(next.t-startTime<.15||!moves.has(next.label)){fail('Intervening terminal/ambiguous action prevents a completed-pass estimate.');continue;}
        endTime=next.t;
        if(next.team!==event.team){completed=false;outcome='Inferred loss before simulated arrival';}
        else if(String(next.playerId)!==actor.id){receiverId=String(next.playerId);receiverMethod='Next observed same-team actor before simulated arrival (receipt proxy)';outcome='Inferred completion from next same-team action';}
        else{fail('Same actor acts again before a plausible receipt; target remains ambiguous.');continue;}
        durationMethod='Time to intervening observed action, bounded by simulated flight time; receipt-time proxy';
      }
      end=observed(match,endTime,receiverId);
      if(!end||end.team!==event.team||endTime>match.duration){fail('Simulated receiver is not observed within source coverage.');continue;}
      const speedActual=distance(start,end)/(endTime-startTime);
      if(speedActual<2||speedActual>40){fail('Implied pass speed is implausible (outside 2–40 m/s).');continue;}
    }else{
      endTime=event.t;startTime=Math.max(0,event.t-2);
      // Do not carry a player across an observed turnover or restart.
      const prior=match.events[i-1];if(prior&&(prior.team!==event.team||stops.has(prior.label)))startTime=Math.max(startTime,prior.t);
      start=observed(match,startTime,actor.id);end=actor;durationMethod='Trailing player displacement over up to 2s before the Drive annotation';
      if(!start||endTime-startTime<.15||distance(start,end)/(endTime-startTime)>12){fail('Carry displacement/duration is missing or implausible.');continue;}
    }
    const holderId=pass?receiverId:actor.id,role=roleAt(match,endTime,holderId,direction);
    if(!role){fail('No assigned model role is available for this player.');continue;}
    rows.push({id:`grounded-${event.id}`,sourceEventId:event.id,half:match.half,team:event.team,possessionId:`inferred-h${match.half}-${possession}`,label:event.label,completed,playerId:actor.id,receiverId,receiverRole:pass?role:undefined,playerRole:pass?undefined:role,startTime,endTime,start:point(start),end:point(end),direction,underPressure:pressure.value,availableAt:endTime,
      provenance:{inputType:'tracking_grounded_simulation',sourceReleaseTime:event.t,sourcePositionTimes:{start:start.observedAt,end:end.observedAt},outcome,receiver:receiverMethod,duration:durationMethod,role:'Shared player-profile modelRole; goalkeeper uses source role',pressure:'Opponent within 3m, or within 5m and closing over 1.5 m/s',pressureEvidence:pressure,possession:'Observed team changes/restarts; unresolved intervals reset inferred possession',corridorClearanceM:candidate?.clearance??null,coordinates:'Observed player coordinates, association with ball/action is inferred',validation:'Unvalidated inferred inputs, not ground truth'}});
  }
  rows.sort((a,b)=>a.endTime-b.endTime||a.startTime-b.startTime||a.id.localeCompare(b.id));
  return {synthetic:true,sourceTrackingReal:true,inputType:'tracking_grounded_simulation',coordinateSystem:'center_meters',completeMoveHistory:true,historyScope:'Complete within simulated possession segments only; unresolved source moves split segments',moves:rows,unresolved,summary:{sourceMoveEvents:match.events.filter(e=>moves.has(e.label)).length,simulatedCompleted:rows.filter(m=>m.completed).length,simulatedFailed:rows.filter(m=>!m.completed).length,unresolved:unresolved.length}};
}
