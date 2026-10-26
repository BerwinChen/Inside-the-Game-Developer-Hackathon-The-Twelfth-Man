// Create a deployment staging directory containing runtime files only.
import {mkdir,copyFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
const destination=process.argv[2];
if(!destination||!path.isAbsolute(destination))throw Error('Provide an absolute staging directory outside the repository.');
const target=path.resolve(destination);
if(target===path.parse(target).root||target===repo||target.startsWith(repo+path.sep)||target.length<12)throw Error('Unsafe staging directory.');
// Do not remove existing directories: packaging must never destroy user files.
await mkdir(target,{recursive:false});
async function copy(relative){const to=path.join(target,relative);await mkdir(path.dirname(to),{recursive:true});await copyFile(path.join(repo,relative),to);}
for(const name of ['server.js','web-api.js','static-assets.js','worker.js','foundry-api.js','chat-api.js','chat-tools.js','forecast-model.js','markov-model.json','wrangler.jsonc'])await copy('backend/'+name);
async function publicFiles(dir){for(const entry of await readdir(path.join(repo,dir),{withFileTypes:true})){if(entry.isDirectory())await publicFiles(dir+'/'+entry.name);else await copy(dir+'/'+entry.name);}}
await publicFiles('frontend/dist');
for(const name of ['goal_model.json','shot_model.json','role_skills.json','config.json'])await copy('stat_model/src/football_value/models/'+name);
// Shared modules imported by the API are also included at their source paths.
for(const name of ['analytics.js','model.js','player-enrichment.js','player-roles.js','team-identity.js','forecast-kernel.js','forecast-adapter.js','chat-agents.js'])await copy('frontend/'+name);
await writeFile(path.join(target,'package.json'),JSON.stringify({name:'twelfth-man',private:true,type:'module',author:'berwin',engines:{node:'22.x'},scripts:{start:'node backend/server.js'}},null,2)+'\n');
console.log('Prepared Azure runtime package without credentials, local state or development dependencies.');
