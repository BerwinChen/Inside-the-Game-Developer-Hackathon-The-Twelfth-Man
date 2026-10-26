import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRealReplay} from '../../frontend/real-replay.js';
import {buildGroundedSimulation} from '../../frontend/forecast-grounded.js';
import {prepareForecast,MODEL_ROLES} from '../../frontend/forecast-adapter.js';
import {predictForecast} from '../forecast-model.js';
const root=new URL('../../frontend/replays/',import.meta.url);
const load=part=>{const read=kind=>JSON.parse(readFileSync(new URL(`117092_${part}_${kind}.json`,root)));return createRealReplay(read('gsr'),read('bas'),read('profiles'));};
test('both halves produce finite model inputs with explicit inferred provenance and no raw outcome changes',()=>{
  let total=0;
  for(const part of ['1st','2nd']){
    const match=load(part),original=JSON.stringify(match.events),data=buildGroundedSimulation(match),conversion=prepareForecast(data);
    assert.equal(JSON.stringify(match.events),original);assert.ok(match.events.every(e=>e.passComplete===null));assert.equal(data.synthetic,true);assert.equal(data.sourceTrackingReal,true);assert.equal(conversion.blocked.length,0);
    assert.equal(data.summary.sourceMoveEvents,data.summary.simulatedCompleted+data.summary.simulatedFailed+data.summary.unresolved);
    assert.equal(conversion.records.length,data.summary.simulatedCompleted);total+=conversion.records.length;
    for(const move of data.moves){assert.ok(move.endTime>move.startTime);assert.ok(move.endTime<match.duration);assert.equal(move.availableAt,move.endTime);assert.ok(move.provenance.sourcePositionTimes.start<=move.endTime&&move.provenance.sourcePositionTimes.end<=move.endTime);assert.ok(MODEL_ROLES.includes(move.receiverRole??move.playerRole));if(move.receiverId)assert.notEqual(move.receiverId,move.playerId);}
    for(let i=0;i<conversion.records.length;i+=150){const record=conversion.records[i];assert.ok(Object.values(record.features).every(Number.isFinite));const output=predictForecast([record])[0];assert.ok(output.goal[1]<=output.goal[3]&&output.goal[3]<=output.goal[30]);}
  }
  assert.ok(total>1500);
});
test('future observations cannot alter already available inferred inputs',()=>{
  const full=load('1st'),time=60;
  const past={...full,frames:full.frames.filter(f=>f.t<=time),events:full.events.filter(e=>e.t<=time)};
  const available=data=>data.moves.filter(m=>m.endTime<=time);
  assert.deepEqual(available(buildGroundedSimulation(past)),available(buildGroundedSimulation(full)));
});
test('per-action five-second conversion agrees with full simulated history',()=>{
  const data=buildGroundedSimulation(load('1st')),full=prepareForecast(data);
  for(const index of [0,25,100,500]){
    const move=data.moves.find(m=>m.id===full.mapping[index].id),window=data.moves.filter(m=>m.possessionId===move.possessionId&&m.endTime>=move.endTime-5&&m.endTime<=move.endTime),result=prepareForecast({...data,moves:window,asOfSeconds:move.endTime});
    const row=result.mapping.findIndex(m=>m.id===move.id);assert.deepEqual(result.records[row],full.records[index]);
  }
});
