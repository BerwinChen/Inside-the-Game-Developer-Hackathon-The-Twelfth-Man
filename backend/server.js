import http from 'node:http';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import worker from './worker.js';
import {handleAPI} from './web-api.js';
import {staticAsset} from './static-assets.js';

export function createServer(environment=process.env){
  const defaults=JSON.parse(readFileSync(new URL('./wrangler.jsonc',import.meta.url),'utf8')).vars;
  // Approximate per-process cap, matching the existing prototype gateway policy.
  const windows=new Map();
  const limiter={async limit({key}){const now=Date.now();let value=windows.get(key);if(!value||now-value.start>=60000){value={start:now,count:0};windows.set(key,value);}return {success:++value.count<=15};}};
  const env={...defaults,...environment,CHAT_RATE_LIMITER:limiter,ASSETS:{fetch:staticAsset}};
  return http.createServer(async(req,res)=>{
    const abort=new AbortController();
    const cancel=()=>{if(!res.writableEnded)abort.abort();};
    req.once('aborted',cancel);res.once('close',cancel);
    try{
      const origin=environment.PUBLIC_ORIGIN||(environment.WEBSITE_HOSTNAME?`https://${environment.WEBSITE_HOSTNAME}`:`http://${req.headers.host||'localhost'}`);
      const init={method:req.method,headers:req.headers,signal:abort.signal};
      if(req.method!=='GET'&&req.method!=='HEAD'){init.body=Readable.toWeb(req);init.duplex='half';}
      const request=new Request(new URL(req.url,origin),init);
      const response=await handleAPI(request,env,{waitUntil:promise=>promise.catch(()=>{})},worker);
      res.writeHead(response.status,Object.fromEntries(response.headers));
      res.flushHeaders();
      if(response.body&&req.method!=='HEAD')await pipeline(Readable.fromWeb(response.body),res);else res.end();
    }catch{
      if(!res.headersSent){res.writeHead(500,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'The API request could not be completed.'}));}
      else res.destroy();
    }finally{req.removeListener('aborted',cancel);res.removeListener('close',cancel);}
  });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const port=Number(process.env.PORT||8080);
  const server=createServer();
  server.requestTimeout=150000;
  server.listen(port,'0.0.0.0',()=>console.log(`Twelfth Man API listening on port ${port}`));
  process.once('SIGTERM',()=>server.close());
}
