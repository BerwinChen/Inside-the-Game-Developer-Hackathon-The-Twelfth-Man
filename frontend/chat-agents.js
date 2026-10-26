// Shared public identities; server prompts and credentials stay in chat-api.js.
export const AGENTS=[
  {id:'auto',name:'Twelfth Man',label:'Twelfth Man',description:'Your host and general football companion. A private conversation, separate from every expert and the discussion room.'},
  {id:'coach',name:'AI Coach',label:'AI Coach',description:'Tactics, positioning and practical coaching suggestions.'},
  {id:'referee',name:'Rules Expert',label:'Rules Expert',description:'Football rules, refereeing decisions and the evidence a decision needs.'},
  {id:'data',name:'Data Analyst',label:'Data Analyst',description:'Player statistics, comparisons and forecast interpretation.'}
];
export const agentById=id=>AGENTS.find(a=>a.id===id);
