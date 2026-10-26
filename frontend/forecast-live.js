import {profileModelRole} from './player-roles.js';
// Experimental use of a completed-move model on a tracking-derived carry proxy.
// This is deliberately separate from the verified enriched-action converter.
const moveLabels=new Set(['Pass','High Pass','Cross','Drive']);
export function pastFrame(frames,time){
  if(!frames.length||frames[0].t>time)return null;
  let lo=0,hi=frames.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(frames[mid].t<=time)lo=mid;else hi=mid-1;}return frames[lo];
}
export function estimateLiveInput({match,time,directions,simulatedEnrichment,profiles=match.profiles??{}}){
  const fail=reason=>({available:false,reason});
  const past=match.events.filter(e=>e.t<=time),action=past.at(-1);
  if(!action)return fail('Waiting for an observed ball action.');
  if(!moveLabels.has(action.label))return fail('Possession is uncertain after this action. Waiting for a pass or carry.');
  if(action.passComplete===false)return fail('The last pass was unsuccessful. Waiting for new possession evidence.');
  const failedReceipt=simulatedEnrichment?.moves.findLast(m=>m.sourceEventId===action.id&&m.completed===false&&m.endTime<=time);
  if(failedReceipt)return fail('Estimated possession changed after this pass. Waiting for a new ball action.');
  const endFrame=pastFrame(match.frames,time),startFrame=pastFrame(match.frames,time-2);
  if(!endFrame||!startFrame||time-endFrame.t>1.05)return fail('Waiting for recent tracking and two seconds of movement history.');
  const trackingWindow=match.frames.filter(f=>f.t>=startFrame.t&&f.t<=endFrame.t);
  if(trackingWindow.some((f,i)=>i>0&&f.t-trackingWindow[i-1].t>1.05))return fail('Tracking is interrupted. Waiting for continuous player observations.');
  const inferred=simulatedEnrichment?.moves.findLast(m=>m.completed===true&&m.endTime<=time&&m.endTime>=action.t&&m.team===action.team);
  const holderId=inferred?(inferred.receiverId??inferred.playerId):String(action.playerId);
  const player=endFrame.players.find(p=>p.id===holderId),start=startFrame.players.find(p=>p.id===holderId);
  if(!player||!start||player.team!==action.team||trackingWindow.some(f=>!f.players.some(p=>p.id===holderId&&p.team===action.team)))return fail('The last actor is not observed at both ends of the movement window.');
  if(Math.abs(player.x)>52.5||Math.abs(player.y)>34||Math.abs(start.x)>52.5||Math.abs(start.y)>34)return fail('The last observed actor is outside the reference pitch.');
  const direction=directions?.[player.team]??(player.team==='left'?1:-1),elapsed=endFrame.t-startFrame.t;
  if(!(elapsed>0))return fail('Movement duration is not available yet.');
  const x=direction*player.x,y=direction*player.y,gx=52.5-x,gy=-y;
  const opponents=endFrame.players.filter(p=>p.team&&p.team!==player.team&&p.role!=='referee');
  if(!opponents.length)return fail('No opposing players are observed for the pressure proxy.');
  const nearest=Math.min(...opponents.map(p=>Math.hypot(p.x-player.x,p.y-player.y)));
  // An opposition action starts a new approximate possession. Do not inspect
  // future recipients, future frames or the model's eventual outcomes.
  const lastOpposition=past.findLast(e=>e.team&&e.team!==action.team)?.t??-Infinity;
  const recent=past.filter(e=>e.t>lastOpposition&&e.t>=time-5&&e.team===action.team&&moveLabels.has(e.label));
  let progress=0;
  for(const event of recent){
    const a=pastFrame(match.frames,event.t-2),b=pastFrame(match.frames,event.t);
    const from=a?.players.find(p=>p.id===String(event.playerId)),to=b?.players.find(p=>p.id===String(event.playerId));
    if(from&&to)progress+=direction*(to.x-from.x);
  }
  const role=profileModelRole(profiles[player.id],player.role);
  if(!role)return fail('Assign one of the six model roles to this player before forecasting.');
  const groundedRecent=simulatedEnrichment?.moves.filter(m=>m.completed===true&&m.endTime<=time&&m.endTime>=time-5&&m.team===action.team&&(!inferred||m.possessionId===inferred.possessionId));
  if(groundedRecent)progress=groundedRecent.reduce((sum,m)=>sum+direction*(m.end.x-m.start.x),0);
  return {available:true,id:`live-${Math.floor(time)}`,origin:time,team:action.team,playerId:player.id,actionLabel:action.label,actionTime:action.t,possessionEvidenceAgeSeconds:time-action.t,sourceFrameTime:endFrame.t,nearestOpponentM:nearest,roleBaseline:role,
    record:{role,features:{goal_distance_m:Math.hypot(gx,gy),goal_angle_rad:Math.atan2(Math.abs(gx*7.32),gx*gx+gy*gy-3.66*3.66),lateral_squared:(y/68)**2,is_pass:0,forward_progress_m:direction*(player.x-start.x),move_speed_mps:Math.hypot(player.x-start.x,player.y-start.y)/elapsed,is_cross:0,recent_5s_count:groundedRecent?.length??recent.length,recent_5s_forward_m:progress,under_pressure:nearest<3?1:0}},
    assumptions:['A past move remains an unverified possession hypothesis while fresh continuous holder tracking is available; event age alone does not confirm possession.','Last observed actor is a holder proxy; receipt and possession are unverified.','A trailing 2s player movement is treated as a carry, not a detected completed action.','Pressure means nearest observed opponent within 3m.','The shared profile modelRole selects the saved role-group abilities; unknown roles suppress the estimate.','Recent action labels and actor displacement approximate completed-move history.','This rolling use is outside the model\'s validated completed-move input contract.']};
}
