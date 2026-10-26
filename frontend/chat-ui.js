import {apiURL} from './api-client.js';
import {createConversations} from './chat-threads.js';
import {AGENTS,agentById} from './chat-agents.js';
import {clock} from './model.js';
import {renderMarkdown,safeURL,sourceLink as link} from './chat-markdown.js';

const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!=null)el.textContent=text;return el;};
export function renderAnswer(parent,parts){
  parent.replaceChildren();const sources=new Map();
  for(const part of parts){const block=make('div','chat-answer-text'),text=part.text??'';let cursor=0,markdown='';const refs=[];
    const citations=(part.annotations??[]).filter(a=>safeURL(a.url)).sort((a,b)=>a.start_index-b.start_index);
    for(const a of citations){sources.set(a.url,a.title??'Source');if(!Number.isInteger(a.start_index)||!Number.isInteger(a.end_index)||a.start_index<cursor||a.end_index<=a.start_index||a.end_index>text.length)continue;
      markdown+=text.slice(cursor,a.start_index);const excerpt=text.slice(a.start_index,a.end_index);refs.push({text:excerpt.includes('')?`[Source ${sources.size}]`:excerpt,url:a.url,title:a.title});markdown+=`\uE000${refs.length-1}\uE001`;cursor=a.end_index;
    }
    markdown+=text.slice(cursor);renderMarkdown(block,markdown.replace(/cite[^]+/g,''),refs);parent.append(block);
  }
  if(sources.size){const list=make('div','chat-web-sources');list.append(make('span','','Web sources'));for(const [url,title] of sources)list.append(link(title,url));parent.append(list);}
}

async function* streamEvents(body){
  if(!body)throw Error('The connection returned an empty response.');
  const reader=body.getReader(),decoder=new TextDecoder();let buffer='',size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>3*1024*1024)throw Error('The response is too large.');buffer+=decoder.decode(value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');let cut;while((cut=buffer.indexOf('\n\n'))!==-1){const block=buffer.slice(0,cut);buffer=buffer.slice(cut+2);const data=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(data)yield JSON.parse(data);}}}
  finally{try{await reader.cancel();}catch{}reader.releaseLock();}
}

export function mountChat({getContext,getSummary,onSeek}) {
  const root=document.getElementById('chatMount');
  root.innerHTML=`<section class="chat-section" aria-label="Football assistant">
    <div class="chat-heading"><div class="chat-brand"><span class="chat-mark">✦</span><div><span class="section-kicker">FOUR MINDS. YOUR FOOTBALL TEAM.</span><h2>Twelfth Man conversations</h2></div></div><div class="chat-heading-actions"><span id="chatConnection" class="chat-connection">Connecting…</span><button id="chatClear" class="chat-icon-button" title="Clear this conversation" aria-label="Clear current conversation">↻</button></div></div>
    <nav class="chat-agent-tabs" aria-label="Independent agent conversations">${AGENTS.map((a,i)=>`<button type="button" data-room="${a.id}" aria-pressed="${i===0}"><span class="chat-tab-symbol">${['✦','↗','⚑','▥'][i]}</span><span>${a.name}</span><small>${['Host','Tactics','Laws of the game','Stats & probability'][i]}</small></button>`).join('')}</nav>
    <button type="button" id="chatDiscussion" class="chat-discussion-toggle" data-room="discussion" aria-pressed="false"><span>◎ <strong>Discussion room</strong></span><span>All four · Two rounds + host summary ↗</span></button>
    <div class="chat-room-heading"><div><h3 id="chatRoomName"></h3><p id="chatAgentDescription"></p></div><span id="chatRoomPrivacy">Independent chat</span></div>
    <div id="chatContext" class="chat-context"></div>
    <div id="chatMessages" class="chat-messages" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions"></div>
    <div class="chat-suggestions" aria-label="Suggested questions"></div>
    <form id="chatForm"><label class="sr-only" for="chatInput">Ask a football question</label><div class="chat-compose"><textarea id="chatInput" maxlength="3000" rows="2" placeholder="Ask your football companion…"></textarea><button id="chatSend" type="submit" aria-label="Send message">↑</button><button id="chatStop" type="button" aria-label="Stop response" hidden>■</button></div><div class="chat-options"><label><input id="chatSearch" type="checkbox" checked> Allow web search</label><span>Enter to send · Shift + Enter for a new line</span></div><div id="chatAccess" class="chat-access" hidden><label for="chatAccessCode">Chat access code</label><input id="chatAccessCode" type="password" autocomplete="off" placeholder="Provided by the owner"></div></form>
    <div class="chat-footer"><span>Separate chats are kept while this page stays open. Private conversations are not shared with the discussion room. AI questions share the captured replay data with the AI service.</span><button id="chatReconnect">Check connection ↗</button></div>
  </section>`;
  const $=id=>root.querySelector('#'+id),messages=$('chatMessages'),input=$('chatInput');
  const rooms=createConversations([...AGENTS.map(a=>a.id),'discussion']);
  let activeRoom='auto',controller=null,requestId=0,lastContext='';
  const identity=id=>id==='discussion'?{name:'Discussion room',description:'Coach, Rules Expert and Data Analyst share independent views, respond to each other, then Twelfth Man summarizes.'}:agentById(id);
  const suggestions={
    auto:[['Match overview','Give me a short overview of this replay at the captured time.'],['Football basics','Explain a football concept that helps me understand this match.']],
    coach:[['Coach this moment','Give one evidence-based observation about the selected player and two conditional coaching suggestions.'],['Passing options','What should I consider when choosing a safe pass? Separate general advice from observed facts.']],
    referee:[['Explain offside','Explain the offside rule with a simple example.'],['Can we judge this?','What evidence would you need to make a refereeing decision from this replay?']],
    data:[['Selected player','Tell me about the selected player, including historical passing and current-match performance.'],['Goal forecast',"Explain the goal and shot forecast shown on this page. Do not invent numerical predictions."]],
    discussion:[['Discuss this moment','Discuss the selected player at the captured replay time: coaching options, relevant rules and what the data supports. Respond to one another before the host summarizes.'],['Debate the probability','Discuss how to interpret the goal and shot forecasts for coaching, separating evidence from estimates.']]
  };
  function welcome(room){const info=identity(room),card=make('div','chat-welcome');card.append(make('span','chat-welcome-symbol',room==='discussion'?'◎':'✦'),make('h3','',room==='discussion'?'Bring the team into the conversation.':`Talk with ${info.name}.`),make('p','',room==='discussion'?'One shared question. Independent views, a peer discussion, and a clear summary.':info.description));rooms.get(room).view.append(card);}
  function switchRoom(id){
    if(controller||id===activeRoom&&rooms.get(id).view)return;
    const previous=rooms.get(activeRoom);previous.draft=input.value;previous.scrollTop=messages.scrollTop;activeRoom=id;const state=rooms.get(id),info=identity(id);
    if(!state.view){state.view=make('div','chat-thread');welcome(id);}messages.replaceChildren(state.view);input.value=state.draft;messages.scrollTop=state.scrollTop;
    $('chatRoomName').textContent=info.name;$('chatAgentDescription').textContent=info.description;$('chatRoomPrivacy').textContent=id==='discussion'?'Shared discussion':'Independent chat';
    input.placeholder=id==='discussion'?'Give the team a topic to discuss…':`Message ${info.name}…`;
    root.querySelectorAll('[data-room]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.room===id)));
    const list=root.querySelector('.chat-suggestions');list.replaceChildren();for(const [label,question] of suggestions[id]){const b=make('button','',label+' ↗');b.type='button';b.dataset.question=question;b.onclick=()=>{input.value=question;input.focus();};list.append(b);}
  }
  function refreshContext(){const c=getSummary(),text=`HALF ${c.half} · ${clock(c.time)}  /  ${c.playerName??'No player selected'}`;if(lastContext!==text){$('chatContext').textContent=text;lastContext=text;}}
  function busy(value){$('chatSend').hidden=value;$('chatStop').hidden=!value;input.disabled=value;$('chatForm').setAttribute('aria-busy',String(value));root.querySelectorAll('[data-room],[data-question]').forEach(b=>b.disabled=value);}
  function row(role,text,name='TWELFTH MAN',view=rooms.get(activeRoom).view){const item=make('article',`chat-message ${role}`);item.append(make('span','chat-message-role',role==='user'?'YOU':name.toUpperCase()));const content=make('div','chat-message-content',text);item.append(content);view.append(item);messages.scrollTop=messages.scrollHeight;return {item,content};}
  let foundryAnnounced=false;
  async function checkConnection(){
    try{const r=await fetch(apiURL('/api/config'),{cache:'no-store'});if(!r.ok)throw Error();const config=await r.json();$('chatConnection').textContent=config.configured?'AI connected':'Setup pending';$('chatConnection').classList.toggle('connected',config.configured);$('chatConnection').title=config.configured?`${config.backend==='foundry'?'Foundry':'OpenAI'} connection configured`:'The owner needs to configure the server credentials.';$('chatAccess').hidden=!config.requiresAccessCode;$('chatSearch').disabled=!config.webSearch;if(!config.webSearch)$('chatSearch').checked=false;
      if(config.backend==='foundry'&&config.configured){
        $('chatConnection').textContent='Connecting to Foundry…';
        const code=$('chatAccessCode').value.trim(),health=await fetch(apiURL('/api/backend-health'),{cache:'no-store',headers:code?{Authorization:`Bearer ${code}`}:{}}),verified=await health.json();
        if(!health.ok||verified.backend!=='foundry'||verified.status!=='ready')throw Error('foundry_unavailable');
        $('chatConnection').textContent='Foundry connected';$('chatConnection').title='Four independent Foundry agents · gpt-5-mini';
        if(!foundryAnnounced){console.info('successfully switch  foundry agent');foundryAnnounced=true;}
      }
    }
    catch(error){$('chatConnection').classList.remove('connected');$('chatConnection').textContent=error.message==='foundry_unavailable'?'Foundry unavailable':'Worker not connected';$('chatConnection').title='Check the backend connection or enter your access code, then retry.';}
  }
  function clear(all=false){requestId++;controller?.abort();controller=null;busy(false);if(all)rooms.reset();else rooms.clear(activeRoom);input.value='';switchRoom(activeRoom);refreshContext();}
  async function send(question){
    if(controller||!question.trim())return;
    const room=activeRoom,state=rooms.get(room),discussion=room==='discussion';state.view.querySelector('.chat-welcome')?.remove();
    const id=++requestId,snapshot=getContext(),captured=getSummary();controller=new AbortController();busy(true);input.value='';state.draft='';row('user',question);
    const discussionLog=make('div','chat-discussion-log');if(discussion)state.view.append(discussionLog);
    const answer=row('assistant',discussion?'Gathering independent views…':'Reading your question…',discussion?'Twelfth Man · Host summary':identity(room).name),meta=make('div','chat-message-meta',`Replay ${clock(snapshot.time)} · ${captured.playerName??'No player selected'}`),trace=make('div','chat-data-sources'),teamTrace=make('div','chat-agent-trace');teamTrace.setAttribute('aria-label','Participating agents');answer.item.append(teamTrace,meta,trace);
    let streamed='',finished=false;const transcript=[];
    try{
      const access=$('chatAccessCode').value.trim(),r=await fetch(apiURL('/api/chat'),{method:'POST',headers:{'Content-Type':'application/json',...(access?{Authorization:`Bearer ${access}`}:{})},body:JSON.stringify({message:question,history:state.history.slice(-12),snapshot,agent:discussion?'auto':room,mode:discussion?'discussion':'direct',allowSearch:$('chatSearch').checked}),signal:controller.signal});
      if(!r.ok){const error=await r.json().catch(()=>({}));throw Error(error.error??`Chat returned status ${r.status}.`);}
      for await(const event of streamEvents(r.body)){
        if(id!==requestId)return;
        if(event.type==='agent'){
          const info=agentById(event.agent);if(info){let badge=teamTrace.querySelector(`[data-agent="${info.id}"]`);if(!badge){badge=make('span','chat-agent-badge');badge.dataset.agent=info.id;teamTrace.append(badge);}badge.dataset.state=event.state;badge.textContent=`${info.name} · ${event.state==='done'?'Done':event.state==='error'?'Unavailable':'Working'}`;}
        }
        if(discussion&&event.type==='discussion_phase')discussionLog.append(make('div','chat-discussion-phase',event.text));
        if(discussion&&event.type==='discussion_message'){
          const info=agentById(event.agent);if(info){const reply=row('assistant','',`${info.name} · ${event.phase==='review'?'Peer response':'Opening view'}`,discussionLog);reply.item.classList.add('chat-expert-reply');reply.item.dataset.agent=info.id;
            if(event.error){reply.item.classList.add('chat-error');reply.content.textContent=event.error;transcript.push(`${info.name} (${event.phase}): unavailable.`);}
            else{renderAnswer(reply.content,event.parts??[]);transcript.push(`${info.name} (${event.phase}): ${(event.parts??[]).map(p=>p.text).join('\n')}`);}
          }
        }
        if(event.type==='reset'){streamed='';answer.content.textContent='Thinking';}
        if(event.type==='status'&&!streamed)answer.content.textContent=event.text;
        if(event.type==='delta'){streamed+=event.text;renderAnswer(answer.content,[{text:streamed}]);}
        if(event.type==='source'&&!Array.from(trace.children).some(c=>c.textContent===event.label))trace.append(make('span','',event.label));
        if(event.type==='error')throw Error(event.error);
        if(event.type==='done'){
          finished=true;renderAnswer(answer.content,event.parts);const text=event.parts.map(p=>p.text).join('\n');
          // Preserve each voice for this room's follow-ups without copying private chats.
          const prior=transcript.map(t=>t.slice(0,650)).join('\n\n');rooms.record(room,question,discussion?`${prior}\n\nTwelfth Man (summary): ${text.slice(0,1800)}`:text);
          if(event.moments?.length){const moments=make('div','chat-replay-moments');moments.append(make('span','','Replay moments'));for(const m of event.moments){if(typeof m.t!=='number'||m.t<0||m.t>snapshot.time)continue;const b=make('button','',`${clock(m.t)} · ${m.label}`);b.type='button';b.onclick=()=>onSeek(m.t);moments.append(b);}answer.item.append(moments);}
        }
        messages.scrollTop=messages.scrollHeight;
      }
      if(!finished)throw Error('The connection ended before the answer was complete. Please retry.');
    }catch(error){if(id!==requestId)return;answer.item.classList.add('chat-error');for(const badge of teamTrace.children){if(badge.dataset.state==='working'){badge.dataset.state='error';badge.textContent=`${agentById(badge.dataset.agent).name} · ${error.name==='AbortError'?'Stopped':'Unavailable'}`;}}answer.content.textContent=error.name==='AbortError'?'Response stopped. You can ask another question.':error.message;}
    finally{if(id===requestId){controller=null;busy(false);input.focus();}}
  }
  $('chatForm').onsubmit=e=>{e.preventDefault();void send(input.value);};input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();void send(input.value);}};
  root.querySelectorAll('[data-room]').forEach(b=>b.onclick=()=>switchRoom(b.dataset.room));
  $('chatStop').onclick=()=>controller?.abort();$('chatClear').onclick=()=>clear();$('chatReconnect').onclick=()=>{void checkConnection();};
  window.addEventListener('touchline:contextchange',()=>refreshContext());window.addEventListener('touchline:matchchange',()=>clear(true));
  switchRoom('auto');refreshContext();void checkConnection();
}
