import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareForecast} from '../../frontend/forecast-adapter.js';
const example=()=>JSON.parse(readFileSync(new URL('../../frontend/samples/forecast-moves.json',import.meta.url)));
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
test('real model schema: ten numeric features plus supported role, no fabricated abilities',()=>{
  const result=prepareForecast(example());assert.equal(result.blocked.length,0);assert.equal(result.records.length,3);
  const config=JSON.parse(readFileSync(new URL('../../stat_model/src/football_value/models/config.json',import.meta.url)));
  assert.deepEqual(Object.keys(result.records[0].features),config.features.slice(0,10));
  const f=result.records[0].features;close(f.goal_distance_m,42.5);close(f.goal_angle_rad,2*Math.atan(3.66/42.5));close(f.move_speed_mps,5);
  assert.equal(result.records[0].role,'central_midfield');assert.equal(result.records[2].role,'striker');
});
test('five-second history stays in the same possession, half and replay cutoff',()=>{
  const input=example();input.asOfSeconds=6;
  const r=prepareForecast(input);assert.equal(r.records.length,2);assert.equal(r.records[1].features.recent_5s_count,2);close(r.records[1].features.recent_5s_forward_m,20);
  input.moves[1].possessionId='new';assert.equal(prepareForecast(input).records[1].features.recent_5s_count,1);
  input.moves[1].possessionId='left-1';input.moves[1].half=2;assert.equal(prepareForecast(input).records[1].features.recent_5s_count,1);
});
test('opposite attacking directions and normalized coordinates give equal features',()=>{
  const input=example(),original=prepareForecast(input);
  for(const m of input.moves){m.direction=-1;for(const p of [m.start,m.end]){p.x=-p.x;p.y=-p.y;}}
  const rotated=prepareForecast(input);for(let i=0;i<3;i++)for(const name of Object.keys(original.records[i].features))close(original.records[i].features[name],rotated.records[i].features[name]);
  input.coordinateSystem='normalized';for(const m of input.moves)for(const p of [m.start,m.end]){p.x=(p.x+52.5)/105;p.y=(p.y+34)/68;}
  const normalized=prepareForecast(input);for(let i=0;i<3;i++)for(const name of Object.keys(original.records[i].features))close(original.records[i].features[name],normalized.records[i].features[name]);
});
test('unknown pressure or role is blocked, never converted to zero or a default role',()=>{
  const input=example();delete input.moves[0].underPressure;delete input.roles['left-9'];
  const r=prepareForecast(input);assert.equal(r.records.length,1);assert.equal(r.blocked.length,2);assert.ok(r.blocked[0].reasons.some(s=>s.includes('underPressure')));
});
test('unknown recent outcomes block dependent forecasts; failed moves do not count',()=>{
  const input=example();delete input.moves[0].completed;assert.equal(prepareForecast(input).records.length,1);
  input.moves[0].completed=false;const r=prepareForecast(input);assert.equal(r.records.length,2);assert.equal(r.records[0].features.recent_5s_count,1);
});
test('reject zero duration and out-of-pitch positions; preserve backward progress',()=>{
  const input=example();input.moves[0].endTime=1;input.moves[1].end.x=90;const r=prepareForecast(input);assert.equal(r.records.length,0);
  const backward=example();backward.moves=[backward.moves[0]];backward.moves[0].end.x=-10;const f=prepareForecast(backward).records[0].features;assert.equal(f.forward_progress_m,-10);assert.equal(f.move_speed_mps,5);
});
test('partial selected-player history must not masquerade as complete possession history',()=>{
  const input=example();delete input.completeMoveHistory;assert.throws(()=>prepareForecast(input),/completeMoveHistory/);
});

test('unlocated source moves cannot silently disappear from recent history',()=>{
  const input=example();delete input.moves[0].possessionId;
  assert.equal(prepareForecast(input).records.length,0);
});
