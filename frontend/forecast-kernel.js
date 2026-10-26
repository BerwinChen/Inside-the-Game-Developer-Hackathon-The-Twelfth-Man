// Identical frozen hazard arithmetic for browser and Worker inference.
// Loading parameters once removes a network round trip from each prediction.
export function createForecastEngine({goal,shot,skills,config}){
for(const [target,model] of Object.entries({goal,shot})){
  if(model.model_type!=='landmark_discrete_time_hazard'||model.max_horizon!==30||model.target!==target||JSON.stringify(model.feature_names)!==JSON.stringify(config.features))throw Error('Invalid frozen forecast schema.');
  for(const name of ['mean','scale','coef','intercepts'])if(model[name].length!==(name==='intercepts'?30:13)||model[name].some(v=>!Number.isFinite(v)))throw Error('Invalid frozen forecast parameters.');
  if(model.scale.some(v=>v<=0))throw Error('Invalid forecast scaling.');
}
function predictForecast(records,horizons=[1,3,30],includeAlerts=false){
  if(!Array.isArray(records)||records.length>200)throw Error('Provide at most 200 forecast records.');
  if(!Array.isArray(horizons)||!horizons.length||horizons.length>30||horizons.some(h=>!Number.isInteger(h)||h<1||h>30))throw Error('horizons must contain integer seconds from 1 to 30.');
  return records.map(record=>{
    const role=record.role;
    if(role!=null&&!Object.hasOwn(skills.roles,role))throw Error('Unsupported holder role.');
    const values={...record.features,...(role==null?{}:skills.roles[role])};
    const row=config.features.map(name=>{if(typeof values[name]!=='number'||!Number.isFinite(values[name]))throw Error('Missing or nonfinite predictor: '+name);return values[name];});
    const result={};
    for(const [target,model] of Object.entries({goal,shot})){
      const linear=row.reduce((sum,v,i)=>sum+(v-model.mean[i])/model.scale[i]*model.coef[i],0);
      let survival=1;const probabilities=[];
      for(const intercept of model.intercepts){const eta=linear+intercept;if(!Number.isFinite(eta))throw Error('Prediction feature scale overflow.');const decay=Math.exp(-Math.abs(eta)),hazard=eta>=0?1/(1+decay):decay/(1+decay);survival*=1-hazard;probabilities.push(1-survival);}
      result[target]=Object.fromEntries(horizons.map(h=>[String(h),probabilities[h-1]]));
      if(includeAlerts)(result.alerts??={})[target]=probabilities[29]>config.thresholds[target];
    }
    return result;
  });
}
  return predictForecast;
}
