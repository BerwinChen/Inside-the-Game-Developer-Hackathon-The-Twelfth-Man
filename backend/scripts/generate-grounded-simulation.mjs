import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRealReplay} from '../../frontend/real-replay.js';
import {buildGroundedSimulation} from '../../frontend/forecast-grounded.js';
import {prepareForecast} from '../../frontend/forecast-adapter.js';
const dir=new URL('../../frontend/replays/',import.meta.url),out=new URL('../data/simulated-enrichment/',import.meta.url);
await mkdir(out,{recursive:true});
for(const part of ['1st','2nd']){
  const read=async kind=>JSON.parse(await readFile(new URL(`117092_${part}_${kind}.json`,dir),'utf8'));
  const [g,b,p]=await Promise.all(['gsr','bas','profiles'].map(read));const match=createRealReplay(g,b,p),data=buildGroundedSimulation(match),conversion=prepareForecast(data);
  await writeFile(new URL(`117092_${part}_inferred.json`,out),JSON.stringify(data,null,2)+'\n');
  await writeFile(new URL(`117092_${part}_model-input.json`,out),JSON.stringify(conversion.records,null,2)+'\n');
  await writeFile(new URL(`117092_${part}_conversion-report.json`,out),JSON.stringify(conversion,null,2)+'\n');
  console.log(part,JSON.stringify({...data.summary,modelReady:conversion.records.length,blocked:conversion.blocked.length}));
}
