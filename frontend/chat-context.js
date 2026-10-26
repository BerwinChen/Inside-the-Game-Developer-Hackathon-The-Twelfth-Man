import {replayScore} from './replay-score.js';
import {atTime} from './model.js';
import {playerStats} from './analytics.js';

// Only a compact, current-time snapshot leaves the browser. Never send frames,
// future events, the raw historical dataset, credentials or local file paths.
export function buildReplaySnapshot({match,profiles,time,selectedPlayer,directions}) {
  const positions=atTime(match.frames,time),roster=new Map();
  for(const frame of match.frames){if(frame.t>time)break;for(const p of frame.players)if(p.role!=='referee')roster.set(p.id,p);}
  const activeIds=new Set(positions.map(p=>p.id));
  const players=[...roster.values()].sort((a,b)=>Number(b.id===selectedPlayer)-Number(a.id===selectedPlayer)||Number(activeIds.has(b.id))-Number(activeIds.has(a.id))).slice(0,32).map(p=>{
    const stats=playerStats(match,p.id,time),profile=profiles[p.id],position=positions.find(q=>q.id===p.id);
    return {id:p.id,number:p.number??null,team:p.team??null,name:profile?.name??`Player ${p.id}`,
      role:profile?.modelRole??profile?.position??p.role,age:profile?.age??null,foot:profile?.foot??null,
      source:profile?.source??'Imported identity; historical profile unavailable',
      history:profile?.history?.slice(-10)??[],position:position?{x:position.x,y:position.y}:null,
      stats:{passes:stats.passes,known:stats.known,completed:stats.completed,shots:stats.shots,goals:stats.goals,tackles:stats.tackles,distance:stats.distance}};
  });
  const past=match.events.filter(e=>e.t<=time),events=past.slice(-120).map(e=>({id:e.id,t:e.t,label:e.label,team:e.team??null,playerId:e.playerId??null,passComplete:e.passComplete??null}));
  return {matchId:match.id??match.title,home:match.home,away:match.away,half:match.half,time,
    synthetic:Boolean(match.synthetic||match.sourceSynthetic),selectedPlayerId:selectedPlayer,
    directions:{...directions},players,events,totalPastEvents:past.length,
    score:replayScore(match,time)};
}
