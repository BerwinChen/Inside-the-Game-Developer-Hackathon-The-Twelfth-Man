import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAPI} from '../web-api.js';
import {createServer} from '../server.js';
const env={ALLOWED_WEB_ORIGINS:'https://twelfth-man.example'};
const ctx={waitUntil(){}};
test('Azure adapter rejects foreign origins before invoking any backend',async()=>{
  let calls=0;const handler={fetch(){calls++;return new Response('ok');}};
  const res=await handleAPI(new Request('https://api.example/api/chat',{headers:{Origin:'https://foreign.example'}}),env,ctx,handler);
  assert.equal(res.status,403);assert.equal(calls,0);assert.equal(res.headers.get('access-control-allow-origin'),null);
});
test('Azure adapter authorizes preflight and retains streaming gateway responses',async()=>{
  const headers={Origin:'https://twelfth-man.example','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type, authorization'};
  const preflight=await handleAPI(new Request('https://api.example/api/chat',{method:'OPTIONS',headers}),env,ctx,{});
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),headers.Origin);
  const handler={fetch(request){assert.equal(request.headers.get('origin'),null);assert.equal(request.headers.get('authorization'),'Bearer sample');return new Response('data: {"type":"done"}\n\n',{headers:{'Content-Type':'text/event-stream'}});}};
  const res=await handleAPI(new Request('https://api.example/api/chat',{headers:{Origin:headers.Origin,Authorization:'Bearer sample'}}),env,ctx,handler);
  assert.match(res.headers.get('content-type'),/text\/event-stream/);assert.match(await res.text(),/done/);
});
test('Node HTTP server exposes actual health and config without credentials',async()=>{
  const server=createServer({AI_BACKEND:'foundry',AZURE_CLIENT_SECRET:'private-value'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const base=`http://127.0.0.1:${server.address().port}`;
    assert.equal((await (await fetch(base+'/healthz')).json()).status,'ready');
    const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(await page.text(),/TWELFTH MAN/i);
    for(const route of ['/backend/worker.js','/.dev.vars','/stat_model/README.md','/%2eenv'])assert.equal((await fetch(base+route)).status,404);
    const sameOrigin=await fetch(base+'/api/chat',{method:'POST',headers:{Origin:base}});assert.equal(sameOrigin.status,503);
    const config=await fetch(base+'/api/config');assert.equal(config.status,200);assert(!(await config.text()).includes('private-value'));
    assert.equal((await fetch(base+'/api/chat',{method:'POST',headers:{Origin:'https://foreign.example'}})).status,403);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
