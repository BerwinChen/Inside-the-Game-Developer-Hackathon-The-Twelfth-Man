import {createReadStream} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../frontend/dist/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
export async function staticAsset(request){
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
  let name;
  try{name=decodeURIComponent(new URL(request.url).pathname);}catch{return new Response('Not found',{status:404});}
  if(name==='/')name='/index.html';
  if(name.split('/').some(part=>part.startsWith('.'))||name.includes('\\')||name.includes('\0'))return new Response('Not found',{status:404});
  const target=path.resolve(root,'.'+name);
  if(!target.startsWith(root))return new Response('Not found',{status:404});
  try{
    const info=await stat(target);if(!info.isFile())return new Response('Not found',{status:404});
    const config=JSON.parse(await readFile(path.join(root,'staticwebapp.config.json'),'utf8'));
    const headers={...config.globalHeaders,'Content-Type':types[path.extname(target)]||'application/octet-stream','Content-Length':String(info.size),'Cache-Control':'no-cache'};
    return new Response(request.method==='HEAD'?null:Readable.toWeb(createReadStream(target)),{headers});
  }catch{return new Response('Not found',{status:404});}
}
