import {unifyProfileRole} from './player-roles.js';
import {demoProfiles} from './analytics.js';
const templates=Object.values(demoProfiles());
const seedFor=id=>[...String(id)].reduce((n,c)=>(Math.imul(n,31)+c.charCodeAt(0))>>>0,7);
// Borrow the fictional demo's distributions, never another person's identity.
export function enrichPlayerProfiles(profiles,frames){
  const keepers=new Set(frames.flatMap(f=>f.players.filter(p=>p.role==='goalkeeper').map(p=>p.id)));
  return Object.fromEntries(Object.entries(profiles).map(([id,p])=>{
    if(p.history?.length)return [id,unifyProfileRole(p,keepers.has(id)?'goalkeeper':null)];
    const seed=seedFor(id),pool=templates.filter(t=>(t.position==='Goalkeeper')===keepers.has(id)),template=pool[seed%pool.length];
    const history=template.history.map((h,i)=>{
      const passes=Math.max(1,h.passes+((seed+i*7)%9)-4),completed=Math.min(passes,Math.round(passes*h.completed/h.passes));
      return {...h,match:`Example match ${i+1}`,passes,completed};
    });
    return [id,unifyProfileRole({...p,age:p.age??template.age,foot:p.foot??template.foot,
      position:p.position&&p.position!=='Position not provided'?p.position:keepers.has(id)?'Goalkeeper':`Simulated role · ${template.position}`,
      history,historySynthetic:true,bioSynthetic:true,source:'Real tracking identity · simulated bio and history based on fictional demo profiles'},keepers.has(id)?'goalkeeper':null)];
  }));
}
