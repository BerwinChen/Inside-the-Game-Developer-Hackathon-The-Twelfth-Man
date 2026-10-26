import {mkdir,copyFile,readdir,rm,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.dirname(fileURLToPath(import.meta.url)),dist=path.join(root,'dist');
await mkdir(dist,{recursive:true});
// Remove only this script's generated output. Whitelist assets to exclude
// .dev.vars, worker source, raw datasets, Python scripts and node_modules.
for(const file of await readdir(dist))await rm(path.join(dist,file),{recursive:true,force:true});
const assets=['index.html','api-client.js','style.css','app.js','floating-pitch.js','model.js','analytics.js','chat-context.js','chat-ui.js','chat-agents.js','chat-threads.js','chat-markdown.js','forecast-ui.js','forecast-live.js','forecast-grounded.js','forecast-kernel.js','forecast-adapter.js','forecast-demo.js','real-replay.js','team-identity.js','player-enrichment.js','player-roles.js','replay-score.js','ball-illustration.js'];
for(const file of assets)await copyFile(path.join(root,file),path.join(dist,file));
const prepared=path.join(root,'replays');
await mkdir(path.join(dist,'replays'),{recursive:true});
for(const suffix of ['1st','2nd'])for(const kind of ['gsr','bas','profiles']){const name=`117092_${suffix}_${kind}.json`;await copyFile(path.join(prepared,name),path.join(dist,'replays',name));}
await copyFile(path.join(prepared,'coverage-report.json'),path.join(dist,'replays','coverage-report.json'));
await copyFile(path.join(root,'public-headers'),path.join(dist,'_headers'));
console.log(`Built ${assets.length} public assets. Server code and secrets are excluded.`);

const rawOrigin=process.env.TWELFTH_MAN_API_ORIGIN||'';
let apiOrigin='';
if(rawOrigin){const url=new URL(rawOrigin);if(url.protocol!=='https:'&&url.hostname!=='127.0.0.1'&&url.hostname!=='localhost')throw Error('API origin must use HTTPS.');if(url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw Error('Provide an API origin without a path or credentials.');apiOrigin=url.origin;}
await writeFile(path.join(dist,'api-config.js'),`export const API_ORIGIN=${JSON.stringify(apiOrigin)};\n`);
const connect="'self'"+(apiOrigin?' '+apiOrigin:'');
await writeFile(path.join(dist,'staticwebapp.config.json'),JSON.stringify({globalHeaders:{'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src ${connect}; object-src 'none'; base-uri 'self'; form-action 'self'`}},null,2)+'\n');
