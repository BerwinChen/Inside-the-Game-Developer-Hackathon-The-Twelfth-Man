// Each room owns its history and draft. Only the active room is sent to the API.
export function createConversations(ids){
  const rooms=new Map(ids.map(id=>[id,{history:[],draft:'',scrollTop:0,view:null}]));
  return {
    get(id){if(!rooms.has(id))throw Error('Unknown conversation.');return rooms.get(id);},
    record(id,question,answer){const room=this.get(id);room.history.push({role:'user',content:question},{role:'assistant',content:answer.slice(0,6000)});room.history=room.history.slice(-12);while(room.history.reduce((n,m)=>n+m.content.length,0)>22000)room.history.splice(0,2);},
    clear(id){const room=this.get(id);room.history=[];room.draft='';room.scrollTop=0;room.view=null;},
    reset(){for(const id of rooms.keys())this.clear(id);}
  };
}
