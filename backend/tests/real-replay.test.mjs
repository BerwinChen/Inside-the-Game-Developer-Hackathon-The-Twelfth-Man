import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRealReplay} from '../../frontend/real-replay.js';
import {atTime,normalizeBAS,classify} from '../../frontend/model.js';
import {buildReplaySnapshot} from '../../frontend/chat-context.js';
import {validateSnapshot} from '../chat-tools.js';
const root=new URL('../../frontend/replays/',import.meta.url);
const read=name=>JSON.parse(readFileSync(new URL(name,root)));
test('full source halves retain actual coverage, 2085 events and unknown outcomes',()=>{
  let duration=0,count=0;
  for(const suffix of ['1st','2nd']){
    const match=createRealReplay(read(`117092_${suffix}_gsr.json`),read(`117092_${suffix}_bas.json`),read(`117092_${suffix}_profiles.json`));
    duration+=match.duration;count+=match.events.length;
    assert.equal(match.synthetic,false);assert.ok(match.duration>2690);assert.ok(match.events.every(e=>e.t<match.duration&&e.passComplete===null));
    assert.ok(match.frames.every(f=>f.t<match.duration));assert.ok(match.frames.some(f=>f.players.length===22));
    assert.ok(Object.values(match.profiles).every(p=>p.history.length===5&&p.historySynthetic&&p.bioSynthetic));
    assert.ok(read(`117092_${suffix}_profiles.json`).profiles.every(p=>!p.history.length));
    const time=match.duration-1,player=match.frames.at(-1).players[0];
    const snapshot=buildReplaySnapshot({match,profiles:match.profiles,time,selectedPlayer:player.id,directions:match.directions});
    assert.ok(snapshot.players.some(p=>p.id===player.id));assert.equal(snapshot.synthetic,false);assert.equal(snapshot.half,match.half);assert.ok(snapshot.events.every(e=>e.t<=time));validateSnapshot(snapshot);
  }
  assert.equal(count,2085);assert.ok(Math.abs(duration-5396.96)<1e-9);
});
test('release v1.2 actions and uppercase labels are accepted without invented success',()=>{
  const raw={actions:[{gameTime:'2 - 00:02',label:'HIGH PASS',position:'2000',player_id:'7',team:'right'}]};assert.equal(classify(raw),'bas');const events=normalizeBAS(raw,2);assert.equal(events[0].label,'High Pass');assert.equal(events[0].t,2);assert.equal(events[0].passComplete,null);
});
test('a missing initial position is not filled using a future frame',()=>{
  assert.deepEqual(atTime([{t:.04,players:[{id:'a',x:0,y:0}]}],0),[]);
});

 test('event score counts goals causally and reverses previous-half sides',async()=>{
  const {replayScore}=await import('../../frontend/replay-score.js');
  const first=createRealReplay(read('117092_1st_gsr.json'),read('117092_1st_bas.json'),read('117092_1st_profiles.json'));
  assert.deepEqual(replayScore(first,1696),{home:0,away:0});
  assert.deepEqual(replayScore(first,1697),{home:1,away:0});
  assert.deepEqual(replayScore(first,first.duration),{home:2,away:1});
  const second=createRealReplay(read('117092_2nd_gsr.json'),read('117092_2nd_bas.json'),read('117092_2nd_profiles.json'),read('117092_1st_bas.json'));
  assert.deepEqual(replayScore(second,0),{home:1,away:2});
  assert.deepEqual(replayScore(second,second.duration),{home:1,away:3});
  for(const id of Object.keys(first.profiles))if(second.profiles[id]){assert.deepEqual(first.profiles[id].history,second.profiles[id].history);assert.equal(first.profiles[id].age,second.profiles[id].age);}
 });

test('color identities stay stable across halftime and profile names follow their team',async()=>{
 const {teamIdentity}=await import('../../frontend/team-identity.js');
 const first=createRealReplay(read('117092_1st_gsr.json'),read('117092_1st_bas.json'),read('117092_1st_profiles.json'));
 const second=createRealReplay(read('117092_2nd_gsr.json'),read('117092_2nd_bas.json'),read('117092_2nd_profiles.json'));
 assert.equal(first.home,'Green Team');assert.equal(first.away,'Blue Team');
 assert.equal(second.home,'Blue Team');assert.equal(second.away,'Green Team');
 assert.equal(first.profiles['467247'].name,'Blue Team #1');assert.equal(second.profiles['467247'].name,'Blue Team #1');
 for(const id of Object.keys(first.profiles))if(second.profiles[id])assert.equal(teamIdentity(first,first.profiles[id].team).key,teamIdentity(second,second.profiles[id].team).key);
});

test('all six shared roles agree across profiles, completed moves, live inputs and ability lookup',async()=>{
 const {MODEL_ROLES,ROLE_LABELS}=await import('../../frontend/player-roles.js');
 const {buildGroundedSimulation}=await import('../../frontend/forecast-grounded.js');
 const {estimateLiveInput}=await import('../../frontend/forecast-live.js');
 const {forecastParameters, predictForecast}=await import('../forecast-model.js');
 const roles=new Set();let checked=0;
 for(const half of ['1st','2nd']){
  const match=createRealReplay(read(`117092_${half}_gsr.json`),read(`117092_${half}_bas.json`),read(`117092_${half}_profiles.json`));
  for(const p of Object.values(match.profiles)){assert(MODEL_ROLES.includes(p.modelRole));assert.equal(p.position,ROLE_LABELS[p.modelRole]);assert(forecastParameters.skills.roles[p.modelRole]);roles.add(p.modelRole);}
  const data=buildGroundedSimulation(match);
  for(const move of data.moves){const id=move.receiverId??move.playerId;assert.equal(move.receiverRole??move.playerRole,match.profiles[id].modelRole);}
  for(let time=4;time<match.duration;time+=17){
   const input=estimateLiveInput({match,time,directions:match.directions,simulatedEnrichment:data});if(!input.available)continue;
   assert.equal(input.record.role,match.profiles[input.playerId].modelRole);
   const explicit={features:{...input.record.features,...forecastParameters.skills.roles[input.record.role]}};
   assert.deepEqual(predictForecast([input.record]),predictForecast([explicit]));checked++;
  }
 }
 assert.equal(roles.size,6);assert(checked>100);
});
