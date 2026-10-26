export const ROLE_LABELS={goalkeeper:'Goalkeeper',centre_back:'Centre back',fullback_wingback:'Fullback / wingback',central_midfield:'Central midfield',attacking_wide:'Wide attacker',striker:'Striker'};
export const MODEL_ROLES=Object.keys(ROLE_LABELS);
const legacy={'goalkeeper':'goalkeeper','centre back':'centre_back','center back':'centre_back','left back':'fullback_wingback','right back':'fullback_wingback','fullback / wingback':'fullback_wingback','central midfield':'central_midfield','left midfield':'central_midfield','right midfield':'central_midfield','left wing':'attacking_wide','right wing':'attacking_wide','wide attacker':'attacking_wide','striker':'striker'};
export function profileModelRole(profile,trackingRole){
  if(trackingRole==='goalkeeper')return 'goalkeeper';
  for(const value of [profile?.modelRole,profile?.role,profile?.position]){
    if(Object.hasOwn(ROLE_LABELS,value??''))return value;
    const mapped=legacy[String(value??'').replace(/^Simulated role\s*·\s*/i,'').trim().toLowerCase()];if(mapped)return mapped;
  }
  return null;
}
export function unifyProfileRole(profile,trackingRole){
  const modelRole=profileModelRole(profile,trackingRole);if(!modelRole)return {...profile,modelRole:null};
  return {...profile,modelRole,position:ROLE_LABELS[modelRole],roleSource:trackingRole==='goalkeeper'?'Source goalkeeper label':profile.roleSource??(profile.bioSynthetic||String(profile.source).includes('Fictional')?'Simulated profile assignment':'Provided profile role')};
}
