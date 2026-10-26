// Source sides reverse after halftime; display identities and colors do not.
export function teamIdentity(match,side){
  if(!['left','right'].includes(side))return {name:'Unknown team',key:'unknown',color:'#b7bcb5',initial:'?',isBlue:false};
  const blue=side===(match.realSource&&match.half===2?'left':'right');
  return blue?{name:'Blue Team',key:'blue',color:'#aabde9',initial:'B',isBlue:true}:{name:'Green Team',key:'green',color:'#d8f58a',initial:'G',isBlue:false};
}
export function colorTeamNames(match){
  match.home=teamIdentity(match,'left').name;match.away=teamIdentity(match,'right').name;
  for(const profile of Object.values(match.profiles??{}))if(/^(Left|Right) team( #.*)?$/.test(profile.name??''))profile.name=`${teamIdentity(match,profile.team).name}${profile.number!=null?' #'+profile.number:''}`;
  return match;
}
