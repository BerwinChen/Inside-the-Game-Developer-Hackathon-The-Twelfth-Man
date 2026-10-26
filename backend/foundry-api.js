import {readSSE} from './chat-api.js';

export const usesFoundry=env=>env.AI_BACKEND==='foundry';
export const foundryConfigured=env=>Boolean(env.FOUNDRY_ENDPOINT&&env.AZURE_TENANT_ID&&env.AZURE_CLIENT_ID&&env.AZURE_CLIENT_SECRET);

function endpoint(env){
  const url=new URL(env.FOUNDRY_ENDPOINT);
  if(url.protocol!=='https:'||url.hostname!=='ai4soccer.services.ai.azure.com'||url.pathname!=='/api/projects/inside-the-game/agents/twelfth-man-team/endpoint/protocols/invocations')throw Error('foundry_configuration');
  url.searchParams.set('api-version','v1');return url.href;
}

export async function foundryRequest(env,body,fetcher=fetch,signal){
  if(!foundryConfigured(env)||!/^[-\da-f]{36}$/i.test(env.AZURE_TENANT_ID))throw Error('foundry_configuration');
  const tokenResponse=await fetcher(`https://login.microsoftonline.com/${env.AZURE_TENANT_ID}/oauth2/v2.0/token`,{method:'POST',signal,headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:env.AZURE_CLIENT_ID,client_secret:env.AZURE_CLIENT_SECRET,scope:'https://ai.azure.com/.default'})});
  if(!tokenResponse.ok){await tokenResponse.body?.cancel();throw Error('upstream_auth');}
  const token=await tokenResponse.json();if(typeof token.access_token!=='string')throw Error('upstream_auth');
  const response=await fetcher(endpoint(env),{method:'POST',signal,headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok){await response.body?.cancel();throw Error([401,403].includes(response.status)?'upstream_auth':response.status===429?'upstream_rate_limit':'upstream_error');}
  return response;
}

export async function checkFoundry(env,fetcher=fetch,signal){
  const response=await foundryRequest(env,{healthCheck:true},fetcher,signal);
  const status=await response.json();
  if(status.backend!=='foundry'||status.status!=='ready'||Object.keys(status.agents??{}).length!==4)throw Error('upstream_error');
  return {backend:'foundry',status:'ready',agents:status.agents};
}

export async function runFoundryChat(body,env,emit,fetcher=fetch,signal){
  emit({type:'status',text:'Connecting to Foundry agents…'});
  const response=await foundryRequest(env,{...body,stream:true},fetcher,signal);
  let done=false;
  for await(const event of readSSE(response.body)){
    if(event.type==='error')throw Error('upstream_error');
    emit(event);if(event.type==='done')done=true;
  }
  if(!done)throw Error('upstream_incomplete');
}
