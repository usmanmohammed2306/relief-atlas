export type CognitoSettings={domain:string;clientId:string};
type Pending={verifier:string;state:string;createdAt:number;clientId:string;domain:string};
type Session={accessToken:string;refreshToken:string;expiresAt:number;clientId:string;domain:string};
const pendingKey='relief-cognito-pending',sessionKey='relief-cognito-session',revocationKey='relief-cognito-revocation';
const base64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function validate(settings:CognitoSettings){
  if(!/^https:\/\/[a-z0-9-]+\.auth\.us-(?:east|west)-[12]\.amazoncognito\.com$/.test(settings.domain)||!/^[-a-zA-Z0-9]{1,128}$/.test(settings.clientId))throw new Error('Sign-in is not configured.');
  if(location.protocol!=='https:'&&location.hostname!=='localhost'&&location.hostname!=='127.0.0.1')throw new Error('Secure sign-in requires HTTPS.');
}
export async function beginCognitoSignIn(settings:CognitoSettings){
  validate(settings);
  const verifier=base64(crypto.getRandomValues(new Uint8Array(32))),state=base64(crypto.getRandomValues(new Uint8Array(32)));
  const challenge=base64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
  sessionStorage.setItem(pendingKey,JSON.stringify({...settings,verifier,state,createdAt:Date.now()}));
  sessionStorage.removeItem(sessionKey);
  const url=new URL('/oauth2/authorize',settings.domain);
  url.search=new URLSearchParams({response_type:'code',client_id:settings.clientId,redirect_uri:`${location.origin}/`,
    scope:'openid email profile aws.cognito.signin.user.admin',state,code_challenge:challenge,code_challenge_method:'S256'}).toString();
  location.assign(url.href);
}
export async function completeCognitoSignIn(settings:CognitoSettings){
  validate(settings);
  const query=new URLSearchParams(location.search);
  if(!query.has('code')&&!query.has('error'))return;
  const code=query.get('code'),state=query.get('state'),error=query.has('error');
  // Remove callback credentials from the address bar before any network work.
  history.replaceState({},'',location.pathname);
  const raw=sessionStorage.getItem(pendingKey);sessionStorage.removeItem(pendingKey);
  let pending:Pending|null=null;
  try{pending=raw?JSON.parse(raw):null;}catch{/* A damaged local record cannot authorize a callback. */}
  if(error||!code||code.length>4096||!pending||pending.state!==state||pending.clientId!==settings.clientId||
    pending.domain!==settings.domain||typeof pending.verifier!=='string'||!/^[-_A-Za-z0-9]{43,128}$/.test(pending.verifier)||
    !Number.isFinite(pending.createdAt)||Date.now()-pending.createdAt>300000||Date.now()<pending.createdAt){
    throw new Error('Sign-in could not be verified. Please start again.');
  }
  const response=await fetch(`${settings.domain}/oauth2/token`,{method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},signal:AbortSignal.timeout(10000),
    body:new URLSearchParams({grant_type:'authorization_code',client_id:settings.clientId,code,
      code_verifier:pending.verifier,redirect_uri:`${location.origin}/`})});
  if(!response.ok)throw new Error('Sign-in could not be completed. Please start again.');
  const token=await response.json();
  if(typeof token.access_token!=='string'||!token.access_token||token.access_token.length>16384||typeof token.refresh_token!=='string'||
    !token.refresh_token||token.refresh_token.length>16384||!Number.isFinite(token.expires_in)||token.expires_in<1||token.expires_in>3600||token.token_type!=='Bearer'){
    throw new Error('Sign-in returned an invalid session. Please start again.');
  }
  sessionStorage.setItem(sessionKey,JSON.stringify({...settings,accessToken:token.access_token,refreshToken:token.refresh_token,expiresAt:Date.now()+token.expires_in*1000}));
}
export function cognitoAccessToken(settings:CognitoSettings):string|undefined{
  let value:Session|null=null;
  try{value=JSON.parse(sessionStorage.getItem(sessionKey)||'null');}catch{/* Reject damaged local state. */}
  if(!value||value.clientId!==settings.clientId||value.domain!==settings.domain||!Number.isFinite(value.expiresAt)||
    value.expiresAt<=Date.now()+5000||typeof value.accessToken!=='string'){
    sessionStorage.removeItem(sessionKey);return;
  }
  return value.accessToken;
}
export async function endCognitoSession(settings:CognitoSettings){
  validate(settings);
  let value:Session|null=null;
  try{value=JSON.parse(sessionStorage.getItem(sessionKey)||sessionStorage.getItem(revocationKey)||'null');}catch{/* Still clear local state. */}
  if(value?.clientId===settings.clientId&&value.domain===settings.domain&&typeof value.refreshToken==='string')sessionStorage.setItem(revocationKey,JSON.stringify({clientId:value.clientId,domain:value.domain,refreshToken:value.refreshToken}));
  sessionStorage.removeItem(sessionKey);sessionStorage.removeItem(pendingKey);
  if(value?.clientId===settings.clientId&&value.domain===settings.domain&&typeof value.refreshToken==='string'){
    try{
      const response=await fetch(`${settings.domain}/oauth2/revoke`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({token:value.refreshToken,client_id:settings.clientId}),signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw new Error('Revocation failed');
      sessionStorage.removeItem(revocationKey);
    }catch{throw new Error('Signed out on this device. Server session revocation could not be confirmed; retry sign-out before leaving a shared device.');}
  }
  const url=new URL('/logout',settings.domain);url.search=new URLSearchParams({client_id:settings.clientId,logout_uri:`${location.origin}/`}).toString();
  location.assign(url.href);
}
