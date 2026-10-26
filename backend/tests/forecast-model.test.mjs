import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {predictForecast,convertAndPredict,forecastParameters} from '../forecast-model.js';
import {createForecastEngine} from '../../frontend/forecast-kernel.js';
import worker from '../worker.js';
const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url)));
const input=read('../../frontend/samples/forecast-moves.json');
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`);
test('frozen artifacts still match Python configuration checksums',()=>{
  const root='../../stat_model/src/football_value/models/';
  const config=read(root+'config.json');for(const item of [...Object.values(config.models),config.role_skills])assert.equal(createHash('sha256').update(readFileSync(new URL(root+item.file,import.meta.url))).digest('hex'),item.sha256);
});
test('Worker port matches actual Python sample predictions',()=>{
  const expected=read('../../frontend/samples/forecast-output.json'),actual=convertAndPredict(input);assert.equal(actual.predictions.length,3);assert.equal(actual.synthetic,true);
  actual.predictions.forEach((p,i)=>{for(const target of ['goal','shot'])for(const h of [1,3,30])close(p[target][h],expected[i][target][h]);});
});
test('all horizons stay cumulative and alerts always use 30 seconds',()=>{
  const records=read('../../frontend/samples/forecast-model-input.json');
  const all=predictForecast(records,Array.from({length:30},(_,i)=>i+1),true),one=predictForecast(records,[1],true);
  all.forEach((p,i)=>{assert.deepEqual(p.alerts,one[i].alerts);for(const target of ['goal','shot'])for(let h=1;h<=30;h++){assert.ok(p[target][h]>=0&&p[target][h]<=1);if(h>1)assert.ok(p[target][h]>=p[target][h-1]);}});
  assert.throws(()=>predictForecast(records,[3.9]),/integer seconds/);
});
test('saved alert cutoffs use strict greater-than on 30s, independently for each target',()=>{
  const records=read('../../frontend/samples/forecast-model-input.json');
  const probabilities=predictForecast(records,[1,3,30],true);
  for(const p of probabilities)for(const target of ['goal','shot'])assert.equal(p.alerts[target],p[target][30]>forecastParameters.config.thresholds[target]);
  const p=probabilities[0];
  const equal=createForecastEngine({...forecastParameters,config:{...forecastParameters.config,thresholds:{goal:p.goal[30],shot:p.shot[30]}}});
  assert.deepEqual(equal([records[0]],[1],true)[0].alerts,{goal:false,shot:false});
  const mixed=createForecastEngine({...forecastParameters,config:{...forecastParameters.config,thresholds:{goal:p.goal[30]-1e-10,shot:p.shot[30]+1e-10}}});
  assert.deepEqual(mixed([records[0]],[3],true)[0].alerts,{goal:true,shot:false});
});
const ctx={waitUntil(){}};
const env={ASSETS:{fetch:async()=>new Response('asset')}};
const req=(body,headers={})=>new Request('https://test.invalid/api/forecast',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
test('actual Worker exposes both models, predicts without OpenAI and protects optional access',async()=>{
  const registry=await (await worker.fetch(new Request('https://test.invalid/api/models'),env,ctx)).json();assert.equal(registry.markov.status,'active');assert.equal(registry.completedMove.status,'ready');
  const response=await worker.fetch(req(input),env,ctx);assert.equal(response.status,200);assert.equal((await response.json()).predictions.length,3);
  assert.equal((await worker.fetch(req(input,{origin:'https://foreign.invalid'}),env,ctx)).status,403);
  assert.equal((await worker.fetch(req(input),{...env,CHAT_ACCESS_TOKEN:'secret'},ctx)).status,401);
});
test('invalid inputs fail and missing real-world features stay blocked',async()=>{
  assert.equal((await worker.fetch(req({...input,moves:Array(201).fill(input.moves[0])}),env,ctx)).status,400);
  const partial=structuredClone(input);delete partial.moves[0].underPressure;const result=await (await worker.fetch(req(partial),env,ctx)).json();assert.equal(result.complete,false);assert.ok(result.blocked[0].reasons.some(s=>s.includes('underPressure')));assert.equal(result.predictions.length,2);
});

test('browser parameter loading reuses access control and requires no OpenAI key',async()=>{
  const request=()=>new Request('https://test.invalid/api/forecast-parameters');
  const response=await worker.fetch(request(),env,ctx);assert.equal(response.status,200);const parameters=await response.json();assert.equal(parameters.goal.max_horizon,30);assert.equal(parameters.config.features.length,13);
  assert.equal((await worker.fetch(request(),{...env,CHAT_ACCESS_TOKEN:'secret'},ctx)).status,401);
  const allowed=new Request('https://test.invalid/api/forecast-parameters',{headers:{Authorization:'Bearer secret'}});assert.equal((await worker.fetch(allowed,{...env,CHAT_ACCESS_TOKEN:'secret'},ctx)).status,200);
});
