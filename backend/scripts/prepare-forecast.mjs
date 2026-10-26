import {readFile,writeFile} from 'node:fs/promises';
import {prepareForecast} from '../../frontend/forecast-adapter.js';
const [source,target,reportPath]=process.argv.slice(2);
if(!source||!target||!reportPath){console.error('Usage: node prepare-forecast.mjs enriched-bas.json model-input.json conversion-report.json');process.exitCode=1;}
else try{
  const report=prepareForecast(JSON.parse(await readFile(source,'utf8')));
  // Only the array is sent to Forecaster. Keep source mapping and readiness
  // diagnostics separately; never pretend that blocked actions were scored.
  await writeFile(target,JSON.stringify(report.records,null,2)+'\n');
  await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
  console.log(`Prepared ${report.records.length}; blocked ${report.blocked.length}; ignored ${report.ignored.length}.`);
  if(report.blocked.length)process.exitCode=2;
}catch(error){console.error(error.message);process.exitCode=1;}
