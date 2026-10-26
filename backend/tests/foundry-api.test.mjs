import test from 'node:test';
import assert from 'node:assert/strict';
import {checkFoundry,foundryRequest,runFoundryChat} from '../foundry-api.js';
import worker from '../worker.js';

const env={AI_BACKEND:'foundry',FOUNDRY_ENDPOINT:'https://ai4soccer.services.ai.azure.com/api/projects/inside-the-game/agents/twelfth-man-team/endpoint/protocols/invocations',AZURE_TENANT_ID:'11111111-1111-1111-1111-111111111111',AZURE_CLIENT_ID:'test-client',AZURE_CLIENT_SECRET:'server-only-secret',ASSETS:{fetch:async()=>new Response('asset')}};
const ready={status:'ready',backend:'foundry',agents:{auto:'twelfth-man-host',coach:'twelfth-man-coach',referee:'twelfth-man-rules',data:'twelfth-man-data'}};
const token=()=>Response.json({access_token:'private-azure-token'});

test('Foundry uses server OAuth credentials and forwards only chat data to the fixed endpoint',async()=>{
  const calls=[];
  const fetcher=async(url,options)=>{calls.push({url,options});return calls.length===1?token():Response.json(ready);};
  const health=await checkFoundry(env,fetcher);
  assert.equal(health.status,'ready');assert.match(calls[0].url,/^https:\/\/login.microsoftonline.com\//);
  assert.equal(calls[0].options.body.get('client_secret'),env.AZURE_CLIENT_SECRET);
  assert.equal(calls[1].options.headers.Authorization,'Bearer private-azure-token');
  assert.deepEqual(JSON.parse(calls[1].options.body),{healthCheck:true});
  assert.ok(!calls[1].options.body.includes(env.AZURE_CLIENT_SECRET));
});

test('public config selects Foundry and does not expose either credential',async()=>{
  const response=await worker.fetch(new Request('https://test.invalid/api/config'),env,{});
  const config=await response.json();assert.equal(config.backend,'foundry');assert.equal(config.configured,true);assert.equal(config.model,'gpt-5-mini');assert.equal(config.webSearch,false);
  assert.ok(!JSON.stringify(config).includes('secret'));assert.equal(config.AZURE_CLIENT_ID,undefined);
});

test('SSE relay preserves independent expert reports and requires a completed response',async()=>{
  const events=[];let calls=0;
  const done={type:'done',parts:[{text:'00:12',annotations:[]}],agents:['data']};
  const fetcher=async()=>++calls===1?token():new Response(`data: ${JSON.stringify({type:'discussion_message',agent:'data',parts:[{text:'Evidence'}]})}\n\ndata: ${JSON.stringify(done)}\n\n`);
  await runFoundryChat({agent:'data',mode:'direct',message:'Clock?'},env,e=>events.push(e),fetcher);
  assert.ok(events.some(e=>e.type==='discussion_message'&&e.agent==='data'));assert.deepEqual(events.at(-1),done);
  await assert.rejects(()=>runFoundryChat({},env,()=>{},async url=>url.includes('login.microsoftonline')?token():new Response('data: {"type":"delta","text":"partial"}\n\n')),/upstream_incomplete/);
});

test('auth failures, invalid endpoints and false health reports cannot signal success',async()=>{
  await assert.rejects(()=>foundryRequest(env,{},async()=>new Response('denied',{status:401})),/upstream_auth/);
  await assert.rejects(()=>foundryRequest({...env,FOUNDRY_ENDPOINT:'https://foreign.invalid/'},{},async()=>token()),/foundry_configuration/);
  await assert.rejects(()=>checkFoundry(env,async url=>url.includes('login.microsoftonline')?token():Response.json({backend:'foundry',status:'ready',agents:{}})),/upstream_error/);
});

test('health check respects the optional chat access code',async()=>{
  const response=await worker.fetch(new Request('https://test.invalid/api/backend-health'),{...env,CHAT_ACCESS_TOKEN:'access'},{});
  assert.equal(response.status,401);
});
