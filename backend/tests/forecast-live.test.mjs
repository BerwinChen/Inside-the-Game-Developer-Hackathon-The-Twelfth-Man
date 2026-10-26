import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateLiveInput,pastFrame} from '../../frontend/forecast-live.js';
import {createForecastEngine} from '../../frontend/forecast-kernel.js';
import {forecastParameters,predictForecast} from '../forecast-model.js';
const state=()=>({time:4,directions:{left:1,right:-1},match:{profiles:{p:{modelRole:'central_midfield'}},events:[{t:3,label:'Pass',team:'left',playerId:'p'}],frames:Array.from({length:6},(_,t)=>({t,players:[{id:'p',x:t,y:0,team:'left',role:'player'},{id:'q',x:t+2,y:0,team:'right',role:'player'}]}))}});
test('rolling proxy uses only past tracking and past actor data',()=>{
  const s=state(),a=estimateLiveInput(s);assert.equal(a.available,true);assert.equal(a.sourceFrameTime,4);assert.equal(a.record.features.under_pressure,1);assert.equal(a.roleBaseline,'central_midfield');
  s.match.frames.push({t:10,players:[{id:'p',x:50,y:20,team:'left'}]});s.match.events.push({t:9,label:'Goal',team:'right',playerId:'future'});
  assert.deepEqual(estimateLiveInput(s),a);assert.equal(pastFrame(s.match.frames,.5).t,0);
});
test('stale tracking, unknown holder and dead balls suppress an estimate',()=>{
  const s=state();s.time=9;assert.equal(estimateLiveInput(s).available,false);
  s.time=4;s.match.events[0].label='Out';assert.equal(estimateLiveInput(s).available,false);
  s.match.events[0].label='Pass';s.match.events[0].playerId='missing';assert.equal(estimateLiveInput(s).available,false);
});
test('rolling movement changes locally as new tracking arrives; paused time is stable',()=>{
  const s=state(),a=estimateLiveInput(s);s.time=5;const b=estimateLiveInput(s);assert.notEqual(a.record.features.goal_distance_m,b.record.features.goal_distance_m);
  const browser=createForecastEngine(structuredClone(forecastParameters));assert.deepEqual(browser([a.record]),predictForecast([a.record]));assert.notDeepEqual(browser([a.record]),browser([b.record]));assert.deepEqual(estimateLiveInput(s),b);
});

test('a pass or carry older than five seconds can continue with fresh continuous tracking',()=>{
 for(const label of ['Pass','High Pass','Cross','Drive']){
  const s=state();s.time=12;s.match.events[0].label=label;s.match.frames=Array.from({length:14},(_,t)=>({t,players:[{id:'p',x:t,y:0,team:'left',role:'player'},{id:'q',x:t+3,y:4,team:'right',role:'player'}]}));
  const result=estimateLiveInput(s);assert.equal(result.available,true);assert.equal(result.possessionEvidenceAgeSeconds,9);assert.equal(result.origin,12);assert.equal(result.sourceFrameTime,12);
  s.match.events.push({t:11,label:'Goal',team:'left',playerId:'p'});assert.equal(estimateLiveInput(s).available,false);
 }
});
test('continuity cannot bridge missing tracking or an observed failed pass',()=>{
 const s=state();s.match.frames=s.match.frames.filter(f=>f.t!==3);assert.equal(estimateLiveInput(s).available,false);
 const failed=state();failed.match.events[0].passComplete=false;assert.equal(estimateLiveInput(failed).available,false);
 const inferred=state();inferred.match.events[0].id='pass-1';inferred.simulatedEnrichment={moves:[{sourceEventId:'pass-1',completed:false,endTime:3.5}]};assert.equal(estimateLiveInput(inferred).available,false);
});

test('a missing role does not silently become midfield and profile roles override old inferred roles',()=>{
 const s=state();delete s.match.profiles.p;assert.equal(estimateLiveInput(s).available,false);
 s.match.profiles.p={modelRole:'attacking_wide'};
 s.simulatedEnrichment={moves:[{completed:true,endTime:3.5,team:'left',playerId:'p',receiverId:'p',receiverRole:'central_midfield',possessionId:'p1',start:{x:1,y:0},end:{x:2,y:0}}]};
 assert.equal(estimateLiveInput(s).record.role,'attacking_wide');
});
