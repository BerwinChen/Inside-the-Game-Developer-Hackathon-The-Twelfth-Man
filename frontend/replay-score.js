// Real-source scores count annotated Goal events, not inferred shot outcomes.
export function replayScore(match,time){
  if(!match.synthetic&&!match.recordedGoals)return null;
  const score={home:match.scoreAtStart?.home??0,away:match.scoreAtStart?.away??0};
  for(const e of match.events){if(e.t>time)break;if(e.label!=='Goal')continue;if(e.team==='left')score.home++;else if(e.team==='right')score.away++;}
  return score;
}
