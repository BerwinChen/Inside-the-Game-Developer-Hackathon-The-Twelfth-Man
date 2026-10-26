/** Azure HTTP adapter. Allow only explicitly configured frontend origins. */
export async function handleAPI(request,env,ctx,handler){
  const url=new URL(request.url),origin=request.headers.get('origin');
  if(url.pathname==='/healthz'&&request.method==='GET')return Response.json({status:'ready',service:'twelfth-man-api'});
  const allowed=new Set((env.ALLOWED_WEB_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean));
  const crossOrigin=Boolean(origin&&origin!==url.origin);
  if(crossOrigin&&!allowed.has(origin))return Response.json({error:'This origin is not allowed.'},{status:403});
  if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
  let response;
  if(request.method==='OPTIONS'){
    const method=request.headers.get('access-control-request-method');
    const headers=(request.headers.get('access-control-request-headers')||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
    if(!['GET','POST'].includes(method)||headers.some(x=>!['content-type','authorization'].includes(x)))return new Response(null,{status:403});
    response=new Response(null,{status:204,headers:{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'600'}});
  }else{
    // The origin was checked above; the portable gateway retains its own same-origin guard.
    const headers=new Headers(request.headers);headers.delete('origin');
    response=await handler.fetch(new Request(request,{headers}),env,ctx);
  }
  if(crossOrigin){response=new Response(response.body,response);response.headers.set('Access-Control-Allow-Origin',origin);response.headers.append('Vary','Origin');}
  return response;
}
