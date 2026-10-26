import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDemo,normalizeBAS,normalizeGSR,atTime} from '../../frontend/model.js';
import {demoProfiles,playerStats,historyStats,normalizeProfiles,zoneAt} from '../../frontend/analytics.js';
const match=createDemo();
assert.equal(Object.keys(demoProfiles()).length,22);
for(const profile of Object.values(demoProfiles())){const h=historyStats(profile.history);assert(h.completed<=h.passes);assert.equal(h.matches,5);}
assert.equal(playerStats(match,'left-6',2).passes,0,'Must not reveal future passes');
assert.equal(playerStats(match,'left-6',3).completed,1);
assert.equal(playerStats(match,'left-10',33).shots,0);
assert.equal(playerStats(match,'left-10',34).shots,1);
assert.equal(playerStats(match,'left-10',93).goals,0);
assert.equal(playerStats(match,'left-10',94).goals,1);
assert.equal(playerStats(match,'right-6',54).completed,0,'Failed pass stays failed');
const unknown={...match,events:normalizeBAS({annotations:[{label:'Pass',position:'1000',player_id:'left-6',gameTime:'1 - 00:01'}]})};
assert.equal(playerStats(unknown,'left-6',2).known,0,'BAS without outcomes must not imply success');
assert.throws(()=>normalizeProfiles({profiles:[{id:1,history:[{passes:5,completed:6}]}]}));
const profile=normalizeProfiles({profiles:[{id:1,name:'Example',history:[]}]});assert.equal(profile['1'].name,'Example');
const model=JSON.parse(readFileSync(new URL('../markov-model.json',import.meta.url)));
assert.equal(model.meta.matches,380);
for(let i=0;i<model.values.length;i++){
 assert(model.values[i]>=0&&model.values[i]<=1);
 assert(model.transition[i].reduce((a,b)=>a+b,0)+model.goalProbability[i]<=1+1e-10);
 const expected=model.goalProbability[i]+model.transition[i].reduce((a,p,j)=>a+p*model.values[j],0);
 assert(Math.abs(expected-model.values[i])<1e-10,'Bellman equation must hold');
}
assert.equal(zoneAt(model,45,7,1).value,zoneAt(model,-45,-7,-1).value,'Direction change rotates the map');
assert(zoneAt(model,45,0).value>zoneAt(model,-45,0).value,'Penalty-area potential should exceed defensive potential');
const gsr=normalizeGSR({images:[{image_id:'3000001'},{image_id:'3000026'}],annotations:[{image_id:'3000001',track_id:1,attributes:{player_id:7,team:'left',jersey:'9'},bbox_pitch:{x_bottom_middle:0,y_bottom_middle:2}},{image_id:'3000026',track_id:1,attributes:{player_id:7,team:'left',jersey:'9'},bbox_pitch:{x_bottom_middle:10,y_bottom_middle:2}}]});
assert.equal(atTime(gsr,.5)[0].x,5);
console.log('PASS: player history, causal replay stats, missing outcomes, profile validation, Markov probabilities, Bellman residual, direction rotation and GSR interpolation.');
