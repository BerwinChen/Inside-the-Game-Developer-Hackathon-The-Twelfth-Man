import {createForecastEngine} from '../frontend/forecast-kernel.js';
// The frozen Python hazard calculation, ported without refitting parameters.
// Frozen JSON stays bundled in the Worker. Authorized browser inference loads
// the same parameters through /api/forecast-parameters; no fitting occurs.
import goal from '../stat_model/src/football_value/models/goal_model.json' with {type:'json'};
import shot from '../stat_model/src/football_value/models/shot_model.json' with {type:'json'};
import skills from '../stat_model/src/football_value/models/role_skills.json' with {type:'json'};
import config from '../stat_model/src/football_value/models/config.json' with {type:'json'};
import {prepareForecast} from '../frontend/forecast-adapter.js';

export const forecastInfo={id:'completed-move-hazard-v1',status:'ready',endpoint:'/api/forecast',horizonsSeconds:[1,30],input:'Enriched BAS with verified action endpoints, durations, outcomes, possession and pressure.',scope:'Separate cumulative same-team goal and shot probabilities after a completed pass or carry.',requiresOpenAI:false};
export const forecastParameters={goal,shot,skills,config};
export const predictForecast=createForecastEngine(forecastParameters);
export function convertAndPredict(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||!Array.isArray(body.moves)||body.moves.length>200)throw Error('Provide an enriched BAS object with at most 200 moves.');
  if(body.includeAlerts!=null&&typeof body.includeAlerts!=='boolean')throw Error('includeAlerts must be boolean.');
  const conversion=prepareForecast(body);
  const predictions=predictForecast(conversion.records,body.horizons??[1,3,30],body.includeAlerts===true);
  return {model:forecastInfo.id,synthetic:conversion.synthetic,complete:conversion.blocked.length===0,predictions:predictions.map((p,i)=>({...conversion.mapping[i],...p})),blocked:conversion.blocked,ignored:conversion.ignored,warnings:conversion.warnings};
}
