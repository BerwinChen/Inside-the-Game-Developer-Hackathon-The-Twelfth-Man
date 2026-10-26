import {colorTeamNames} from './team-identity.js';
import {enrichPlayerProfiles} from './player-enrichment.js';
import {normalizeGSR,normalizeBAS} from './model.js';
import {normalizeProfiles} from './analytics.js';
export function createRealReplay(gsr,bas,profileData,previousHalf=null){
  if(gsr.matchId!=='117092'||gsr.half!==bas.half||gsr.half!==profileData.half||gsr.synthetic!==false)throw Error('Real replay source metadata does not match.');
  const frames=normalizeGSR(gsr),events=normalizeBAS(bas,gsr.half),profiles=enrichPlayerProfiles(normalizeProfiles(profileData),frames);
  if(!(gsr.duration>frames.at(-1).t)||events.some(e=>e.t<0||e.t>=gsr.duration))throw Error('Real replay exceeds its source coverage.');
  const directions={left:1,right:-1};
  for(const team of ['left','right']){
    const keepers=frames.slice(0,10).flatMap(f=>f.players.filter(p=>p.team===team&&p.role==='goalkeeper').map(p=>p.x)).sort((a,b)=>a-b);
    if(keepers.length)directions[team]=keepers[Math.floor(keepers.length/2)]>0?-1:1;
  }
  let scoreAtStart={home:0,away:0};
  if(gsr.half===2&&previousHalf?.half===1&&previousHalf.matchId===gsr.matchId){for(const e of normalizeBAS(previousHalf,1))if(e.label==='Goal'){if(e.team==='right')scoreAtStart.home++;else if(e.team==='left')scoreAtStart.away++;}}
  return colorTeamNames({recordedGoals:true,scoreAtStart,id:`soccertrack-117092-half-${gsr.half}`,title:`SoccerTrack 117092 · Half ${gsr.half}`,half:gsr.half,home:'Left team',away:'Right team',frames,events,profiles,duration:gsr.duration,synthetic:false,sourceSynthetic:false,ballMode:'none',realSource:true,sampleFps:gsr.sampleFps,directions});
}
export async function fetchRealReplay(half,fetcher=fetch){
  if(![1,2].includes(half))throw Error('Select first or second half.');
  const suffix=half===1?'1st':'2nd';
  const [gsr,bas,profiles,previousHalf]=await Promise.all(['gsr','bas','profiles',...(half===2?['previous']:[])].map(async kind=>{const r=await fetcher(kind==='previous'?'./replays/117092_1st_bas.json':`./replays/117092_${suffix}_${kind}.json`);if(!r.ok)throw Error('Full-match files are unavailable. Please retry.');return r.json();}));
  return createRealReplay(gsr,bas,profiles,previousHalf);
}
