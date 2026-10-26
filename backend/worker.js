// @ts-check
import {forecastInfo,forecastParameters,convertAndPredict} from './forecast-model.js';
import probabilityModel from './markov-model.json' with {type:'json'};
import {InputError} from './chat-tools.js';
import {readJSON,validateChatBody,runChat,publicError} from './chat-api.js';
import {usesFoundry,foundryConfigured,checkFoundry,runFoundryChat} from './foundry-api.js';

/** @param {unknown} data @param {number} [status] */
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
/** @param {Request} request @param {string | undefined} expected */
async function authorized(request,expected){
  if(!expected)return true;
  const supplied=request.headers.get('authorization')?.replace(/^Bearer /,'')??'';
  /** @param {string} value */
  const hash=async value=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
  const [a,b]=await Promise.all([hash(supplied),hash(expected)]);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}

/** @type {ExportedHandler<Cloudflare.Env>} */
export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
    if(url.pathname==='/api/config'&&request.method==='GET')return json({configured:usesFoundry(env)?foundryConfigured(env):Boolean(env.OPENAI_API_KEY?.trim()),backend:usesFoundry(env)?'foundry':'openai',model:usesFoundry(env)?'gpt-5-mini':env.OPENAI_MODEL,webSearch:!usesFoundry(env)&&env.WEB_SEARCH_ENABLED==='true',requiresAccessCode:Boolean(env.CHAT_ACCESS_TOKEN)});
    if(url.pathname==='/api/backend-health'&&request.method==='GET'){
      if(!await authorized(request,env.CHAT_ACCESS_TOKEN))return json({error:'Enter the chat access code provided by the owner.'},401);
      if(!usesFoundry(env))return json({backend:'openai',status:'configured'});
      if(env.CHAT_RATE_LIMITER){const {success}=await env.CHAT_RATE_LIMITER.limit({key:'foundry-health'});if(!success)return json({error:'Please wait before checking the connection again.'},429);}
      try{return json(await checkFoundry(env,fetch,AbortSignal.timeout(45000)));}catch{return json({backend:'foundry',status:'unavailable',error:'Foundry connection could not be verified.'},503);}
    }
    if(url.pathname==='/api/models'&&request.method==='GET')return json({markov:{id:'markov-possession',status:'active',scope:'Location-only scoring potential before a modeled possession ends.'},completedMove:forecastInfo});
    if(url.pathname==='/api/forecast-parameters'){
      if(request.method!=='GET')return json({error:'Use GET for model parameters.'},405);
      if(!await authorized(request,env.CHAT_ACCESS_TOKEN))return json({error:'Enter the access code provided by the owner.',code:'access_required'},401);
      return json(forecastParameters);
    }
    if(url.pathname==='/api/forecast'){
      if(request.method!=='POST')return json({error:'Use POST with enriched BAS moves.'},405);
      const origin=request.headers.get('origin');if(origin&&origin!==url.origin)return json({error:'Cross-origin forecast requests are not allowed.'},403);
      if(!await authorized(request,env.CHAT_ACCESS_TOKEN))return json({error:'Enter the access code provided by the owner.',code:'access_required'},401);
      if(env.CHAT_RATE_LIMITER){const {success}=await env.CHAT_RATE_LIMITER.limit({key:'completed-move-forecast'});if(!success)return json({error:'Too many forecast requests. Please wait a minute.'},429);}
      let body;try{body=await readJSON(request);}catch(error){return json({error:error instanceof InputError?error.message:'Invalid forecast request.'},400);}
      try{return json(convertAndPredict(body));}catch(error){return json({error:error instanceof Error?error.message:'Invalid forecast input.'},400);}
    }
    if(url.pathname!=='/api/chat')return json({error:'Endpoint not found.'},404);
    if(request.method!=='POST')return json({error:'Use POST for chat.'},405);
    const origin=request.headers.get('origin');if(origin&&origin!==url.origin)return json({error:'Cross-origin chat requests are not allowed.'},403);
    if(!await authorized(request,env.CHAT_ACCESS_TOKEN))return json({error:'Enter the chat access code provided by the owner.',code:'access_required'},401);
    if(usesFoundry(env)?!foundryConfigured(env):!env.OPENAI_API_KEY?.trim())return json({error:'The AI backend is not configured.',code:'missing_api_key'},503);
    // A shared, approximate per-location cap protects this prototype's API spend.
    // It is not a strict global billing limit or a replacement for authentication.
    if(env.CHAT_RATE_LIMITER){const {success}=await env.CHAT_RATE_LIMITER.limit({key:'touchline-chat'});if(!success)return json({error:'The chat is receiving too many requests. Please wait a minute.'},429);}
    let body;try{body=validateChatBody(await readJSON(request));}catch(error){return json({error:error instanceof InputError?error.message:'Invalid chat request.'},400);}
    if(usesFoundry(env)&&body.mode==='assist')return json({error:'Use direct chat or the discussion room with Foundry.'},400);
    const encoder=new TextEncoder(),abort=new AbortController();
    const timeout=setTimeout(()=>abort.abort(),usesFoundry(env)?125000:90000);
    const cancel=()=>abort.abort();request.signal.addEventListener('abort',cancel,{once:true});
    const stream=new ReadableStream({
      start(controller){
        let closed=false;
        /** @param {Record<string, unknown>} event */
        const emit=event=>{if(!closed&&!abort.signal.aborted)try{controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));}catch{closed=true;abort.abort();}};
        const work=(async()=>{
          try{if(usesFoundry(env))await runFoundryChat(body,env,emit,fetch,abort.signal);else await runChat(body,env,probabilityModel,emit,fetch,abort.signal);}
          catch(error){if(!closed)try{controller.enqueue(encoder.encode(`data: ${JSON.stringify({type:'error',error:publicError(error)})}\n\n`));}catch{} }
          finally{clearTimeout(timeout);request.signal.removeEventListener('abort',cancel);if(!closed){closed=true;try{controller.close();}catch{}}}
        })();
        ctx.waitUntil(work);
      },
      cancel(){clearTimeout(timeout);abort.abort();request.signal.removeEventListener('abort',cancel);}
    });
    return new Response(stream,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
};
