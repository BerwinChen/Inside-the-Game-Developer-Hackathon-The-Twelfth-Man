import {apiURL} from './api-client.js';
import {ROLE_LABELS} from './player-roles.js';
import {teamIdentity} from './team-identity.js';
import {createForecastEngine} from './forecast-kernel.js';
import {prepareForecast} from './forecast-adapter.js';
import {buildGroundedSimulation} from './forecast-grounded.js';
import {estimateLiveInput} from './forecast-live.js';
import {clock} from './model.js';
import {buildForecastDemo,latestDemoMove} from './forecast-demo.js';
const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!=null)el.textContent=text;return el;};
export function mountMoveForecast(getState){
  const root=document.getElementById('forecastMount');
  root.innerHTML=`<section class="move-forecast" aria-label="Completed-move forecast"><div class="forecast-heading"><div><span class="section-kicker">GOAL & SHOT FORECAST</span><h2>The next few seconds.</h2></div><span class="forecast-demo-badge">SYNTHETIC INPUTS</span></div><p class="forecast-intro"></p><p class="forecast-coverage"></p><button type="button" class="forecast-export" hidden>Export inferred inputs ↧</button><label class="forecast-mode"><input type="checkbox" checked> Live estimate · updates every second</label><p class="forecast-live-warning" hidden>Estimated inputs · Unvalidated rolling use of a completed-move model. These values are not calibrated real-match probabilities.</p><div class="forecast-subject" hidden></div><p class="forecast-status" role="status"></p><div class="forecast-values"></div><p class="forecast-timing"></p><details class="forecast-assumptions"><summary>Input assumptions &amp; model limits</summary><p class="forecast-assumption-copy"></p><p>Goal and shot models are independent. Source coordinates come from the current or earlier observed frame.</p></details><details class="forecast-evidence" hidden><summary>How this action was inferred</summary><p></p></details><div class="forecast-access" hidden><label>Forecast access code <input type="password" autocomplete="off"></label></div><button type="button" class="forecast-retry" hidden>Retry forecast ↗</button></section>`;
  const status=root.querySelector('.forecast-status'),values=root.querySelector('.forecast-values'),timing=root.querySelector('.forecast-timing'),retry=root.querySelector('.forecast-retry'),access=root.querySelector('.forecast-access'),liveToggle=root.querySelector('.forecast-mode input');
  const assumptions=root.querySelector('.forecast-assumptions');assumptions.append(root.querySelector('.forecast-coverage'),root.querySelector('.forecast-export'));
  let data=null,identity=null,key='',result=null,current=null,requestId=0,lastClock='',cache=new Map(),engine=null,enginePromise=null,simulationDirectionKey='';
  const percent=v=>`${(v*100).toFixed(2)}%`;
  async function ensureEngine(){
    if(engine)return engine;
    if(!enginePromise){const code=access.querySelector('input').value.trim();enginePromise=(async()=>{
      const response=await fetch(apiURL('/api/forecast-parameters'),{headers:code?{Authorization:`Bearer ${code}`}:{}});
      if(response.status===401)access.hidden=false;
      const payload=await response.json();if(!response.ok)throw Error(payload.error??'Forecast model is unavailable.');
      const alertCopy=make('p','forecast-alert-rules',`30s alerts: Possible goal above ${(payload.config.thresholds.goal*100).toFixed(4)}%; Possible shot above ${(payload.config.thresholds.shot*100).toFixed(4)}%. Saved validation forecast-record FPR: about 7.84%; not established for simulated or rolling inputs.`);
      assumptions.querySelector('.forecast-alert-rules')?.remove();assumptions.append(alertCopy);
      return createForecastEngine(payload);
    })().catch(error=>{enginePromise=null;throw error;});}
    engine=await enginePromise;return engine;
  }
  function render(){
    values.replaceChildren();const subject=root.querySelector('.forecast-subject');subject.hidden=!result||!current;if(!result){root.querySelector('.forecast-evidence').hidden=true;return;}
    const team=teamIdentity(getState().match,current.team);subject.textContent=`${team.name} · Team probabilities`;subject.dataset.team=team.key;values.dataset.team=team.key;values.style.setProperty('--forecast-team-color',team.color);
    const table=make('table','forecast-table'),caption=make('caption','sr-only',`${team.name}: cumulative goal and shot probabilities within the next 1, 3 and 30 seconds`),head=make('thead'),header=make('tr');
    const corner=make('th','','Outcome');corner.scope='col';header.append(corner);
    for(const seconds of [1,3,30]){const th=make('th','',`Next ${seconds}s`);th.scope='col';header.append(th);}head.append(header);table.append(caption,head);
    const body=make('tbody');for(const [field,title] of [['goal','Goal'],['shot','Shot']]){
      const row=make('tr'),label=make('th','',title);label.scope='row';row.append(label);
      for(const seconds of [1,3,30]){
        const cell=make('td','',percent(result[field][seconds])),alert=seconds===30&&result.alerts?.[field]===true;
        const message=field==='goal'?'Possible goal':'Possible shot';
        cell.setAttribute('aria-label',`${team.name} ${field==='goal'?'scores':'takes a shot'} within ${seconds} seconds: ${percent(result[field][seconds])}${alert?` · ${message}`:''}`);
        if(alert){cell.classList.add('forecast-triggered');cell.append(make('span','forecast-alert',message));}
        row.append(cell);
      }body.append(row);
    }table.append(body);values.append(table);
  }

  function updateTiming(time){
    const stamp=`${Math.floor(time)}:${current?.id??''}`;if(stamp===lastClock)return;lastClock=stamp;
    timing.textContent=current?`From ${clock(current.origin)} · Probability within each future window${!liveToggle.checked&&time>current.origin+30?' · Previous action forecast':''}`:'';
  }
  function setModeCopy(state){
    const live=liveToggle.checked;
    const grounded=data?.sourceTrackingReal;
    root.querySelector('.forecast-export').hidden=!grounded;
    root.querySelector('.forecast-demo-badge').textContent=live?'EXPERIMENTAL ESTIMATE':grounded?'SIMULATED ENRICHMENT':data?'SYNTHETIC INPUTS':'ENRICHMENT REQUIRED';
    root.querySelector('.forecast-live-warning').hidden=!live&&!grounded;
    root.querySelector('.forecast-live-warning').textContent=live?'Estimated inputs · not calibrated match probabilities.':'Real tracking + simulated action inputs · unvalidated estimates.';
    root.querySelector('.forecast-coverage').textContent=grounded?`${data.summary.simulatedCompleted} simulated completions · ${data.summary.simulatedFailed} simulated losses · ${data.summary.unresolved} unresolved actions excluded`:'';
    root.querySelector('.forecast-intro').textContent='For the team in estimated possession, not an individual player.';
    root.querySelector('.forecast-assumption-copy').textContent=live&&grounded?'Where available, simulated receipt identifies a holder proxy; otherwise the last observed actor is used. Current player motion over 2s proxies a carry. The preceding 5s of simulated completed moves supplies history. Current opponent proximity proxies pressure. Inputs are unverified and the rolling use is outside the original model contract. Missing or stale evidence suppresses estimates.':live?'The last pass/carry actor remains an unverified holder proxy while current tracking is continuous, until a new event updates or interrupts the hypothesis. No fixed action-age cutoff is used. Trailing 2s player movement is treated as a carry. Opponent distance below 3m proxies pressure. The player profile supplies the model role; unassigned roles suppress predictions. Recent action labels and actor displacement proxy move history. This rolling input is outside the original model contract and has not been validated. Playback pauses do not create new estimates.':grounded?'Recipients are selected from plausible teammates using distance, space and passing-corridor clearance. A same-team actor observed before simulated arrival can constrain receipt; an intervening opponent move implies simulated loss. Ground/high/cross travel speeds are assumed at 12/18/16 m/s. Carries use trailing movement up to 2s. The shared player-profile role selects the saved role-group abilities. Pressure is proximity and closing-speed based. Team changes, restarts and unresolved moves delimit inferred possessions. Endpoints are player positions, not measured ball contacts. Original source outcomes remain unknown.':'Built-in demo only: fictional trajectories, recipients, pressure and possession; pass duration 1.2s, carry duration 2.4s. Real matches need verified enriched inputs for this mode. Probabilities are anchored to completed actions.';
  }
  async function calculate(input,state,calculationKey){
    const id=++requestId;retry.hidden=true;
    if(cache.has(calculationKey)){const saved=cache.get(calculationKey);result=saved.result;status.textContent=saved.status;const evidence=root.querySelector('.forecast-evidence');evidence.hidden=!saved.evidence;evidence.querySelector('p').textContent=saved.evidence??'';render();return;}
    if(!engine){result=null;render();status.textContent='Loading model once for browser inference…';}
    try{
      const predict=await ensureEngine();if(id!==requestId)return;
      
      if(input.live)result=predict([input.record],[1,3,30],true)[0];
      else{
        const relevant=data.moves.filter(m=>m.endTime<=input.move.endTime&&m.endTime>=input.move.endTime-5&&m.possessionId===input.move.possessionId);
        const conversion=prepareForecast({...data,moves:relevant,asOfSeconds:input.move.endTime});
        const index=conversion.mapping.findIndex(p=>p.id===input.move.id);if(index<0)throw Error('This action has incomplete forecast inputs.');
        result=predict([conversion.records[index]],[1,3,30],true)[0];
      }
      const profile=state.profiles[input.playerId],holder=profile?.name??`Player ${input.playerId}`,roleLabel=ROLE_LABELS[input.live?input.roleBaseline:(input.move.receiverRole??input.move.playerRole??data.roles?.[input.playerId])]??'Unknown role';
      status.textContent=`${clock(input.origin)} · Based on ${holder} · ${roleLabel}${input.live?` (estimated possession${input.possessionEvidenceAgeSeconds>5?`; last action ${Math.floor(input.possessionEvidenceAgeSeconds)}s ago`:''})`:''}`;
      const evidence=root.querySelector('.forecast-evidence');evidence.hidden=!input.move?.provenance;
      if(input.move?.provenance){const p=input.move.provenance;evidence.querySelector('p').textContent=`Recipient: ${p.receiver}. Duration: ${(input.move.endTime-input.move.startTime).toFixed(2)}s (${p.duration}). Role: ${input.move.receiverRole??input.move.playerRole} (${p.role}). Nearest opponent: ${p.pressureEvidence.nearestOpponentM.toFixed(1)}m; closing: ${p.pressureEvidence.closingMps.toFixed(1)}m/s. Outcome: ${p.outcome}. Coordinates are observed player positions; ball association is inferred.`;}

      cache.set(calculationKey,{result,status:status.textContent,evidence:evidence.hidden?null:evidence.querySelector('p').textContent});if(cache.size>400)cache.delete(cache.keys().next().value);render();
    }catch(error){if(id!==requestId)return;result=null;render();status.textContent=error.message;retry.hidden=false;}
  }
  function update(){
    const state=getState();
    const directionKey=`${state.directions?.left}:${state.directions?.right}`;
    if(identity!==state.match||simulationDirectionKey!==directionKey){identity=state.match;simulationDirectionKey=directionKey;cache.clear();data=state.match.synthetic?buildForecastDemo(state.match,state.profiles):state.match.realSource?buildGroundedSimulation(state.match,state.directions):null;key='';result=null;current=null;requestId++;render();setModeCopy(state);void ensureEngine().then(()=>{key='';update();}).catch(()=>{});}
    if(liveToggle.checked){
      const nextKey=`live:${Math.floor(state.time)}:${state.directions?.left}:${state.directions?.right}`;if(nextKey===key){updateTiming(state.time);return;}key=nextKey;
      const input=estimateLiveInput({...state,simulatedEnrichment:data?.sourceTrackingReal?data:null});
      if(!input.available){requestId++;result=null;current=null;render();timing.textContent='';status.textContent=input.reason;retry.hidden=true;return;}
      current={id:input.id,origin:input.origin,team:input.team};updateTiming(state.time);
      void calculate({...input,live:true},state,nextKey);return;
    }
    if(!data){if(key==='unavailable')return;key='unavailable';requestId++;result=null;current=null;render();status.textContent='Verified action inputs are incomplete. Enable Experimental live estimate to use clearly labeled tracking assumptions.';timing.textContent='';retry.hidden=true;return;}
    const move=latestDemoMove(data,state.time);current=move?{id:move.id,origin:move.endTime,team:move.team}:null;updateTiming(state.time);
    const nextKey=move?.id??'before-first';if(nextKey===key)return;key=nextKey;
    if(!move){requestId++;result=null;render();status.textContent=data.sourceTrackingReal?'Waiting for a simulated completed action. Press Play or select a later event.':'Waiting for the first completed pass at 00:03. Select that event or press Play.';retry.hidden=true;return;}
    void calculate({move,origin:move.endTime,playerId:move.receiverId??move.playerId,team:move.team,label:move.label==='Drive'?'Carry':move.label},state,nextKey);
  }
  liveToggle.onchange=()=>{requestId++;key='';lastClock='';result=null;current=null;root.querySelector('.forecast-evidence').hidden=true;render();setModeCopy(getState());update();};

  root.querySelector('.forecast-export').onclick=()=>{if(!data?.sourceTrackingReal)return;const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`soccertrack-117092-half-${getState().match.half}-inferred.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  retry.onclick=()=>{key='';update();};window.addEventListener('touchline:contextchange',update);window.addEventListener('touchline:matchchange',update);update();
}
