import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemo} from '../../frontend/model.js';
import {demoProfiles} from '../../frontend/analytics.js';
import {buildForecastDemo,latestDemoMove} from '../../frontend/forecast-demo.js';
import {convertAndPredict} from '../forecast-model.js';
test('synthetic replay enrichment produces complete causal inputs for every successful move',()=>{
  const data=buildForecastDemo(createDemo(),demoProfiles());
  assert.equal(data.synthetic,true);assert.equal(latestDemoMove(data,2.99),null);assert.equal(latestDemoMove(data,3).endTime,3);
  for(const move of data.moves.filter(m=>m.completed)){
    const result=convertAndPredict({...data,moves:data.moves.filter(m=>m.endTime<=move.endTime),asOfSeconds:move.endTime});
    assert.equal(result.blocked.length,0,JSON.stringify(result.blocked));
    const latest=result.predictions.find(p=>p.id===move.id);assert.ok(latest);assert.ok(result.predictions.every(p=>p.endTimeSeconds<=move.endTime));
    for(const field of ['goal','shot'])assert.ok(latest[field][1]<=latest[field][3]&&latest[field][3]<=latest[field][30]);
  }
  assert.equal(latestDemoMove(data,54).endTime,47,'Failed pass must not create a completed-move forecast');
});
test('enrichment refuses imported real data and separates simulated turnovers',()=>{
  assert.throws(()=>buildForecastDemo({...createDemo(),synthetic:false},demoProfiles()),/built-in demo/);
  const {moves}=buildForecastDemo(createDemo(),demoProfiles());assert.notEqual(moves.find(m=>m.endTime===29).possessionId,moves.find(m=>m.endTime===41).possessionId);
});
