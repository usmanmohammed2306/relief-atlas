import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { AppError, type Actor } from './service.js';

const Attributes=z.object({UserAttributes:z.array(z.object({Name:z.string().min(1).max(100),Value:z.string().max(2048)})).max(64)});
const sessions=new Map<string,ReturnType<typeof createCognitoAuthenticator>>();

export function cognitoConfig(env:NodeJS.ProcessEnv=process.env){
  const region=env.AWS_REGION||env.AWS_DEFAULT_REGION||'';
  const pool=env.COGNITO_USER_POOL_ID||'',client=env.COGNITO_CLIENT_ID||'',domain=env.COGNITO_DOMAIN||'';
  if(!/^us-(?:east|west)-[12]$/.test(region)||!new RegExp(`^${region}_[A-Za-z0-9]+$`).test(pool)||
    !/^[a-z0-9]{1,128}$/.test(client)||!new RegExp(`^https://[a-z0-9-]+\\.auth\\.${region}\\.amazoncognito\\.com$`).test(domain)){
    throw new AppError(503,'Authentication is not configured.');
  }
  return {region,pool,client,domain,issuer:`https://cognito-idp.${region}.amazonaws.com/${pool}`};
}

export function createCognitoAuthenticator(config:ReturnType<typeof cognitoConfig>,dependencies:{keys?:JWTVerifyGetKey;fetcher?:typeof fetch}={}){
  const keys=dependencies.keys??createRemoteJWKSet(new URL(`${config.issuer}/.well-known/jwks.json`),{timeoutDuration:5000,cooldownDuration:30000});
  const fetcher=dependencies.fetcher??fetch;
  return async function authenticate(token:string):Promise<Actor>{
    if(token.length>16384)throw new AppError(401,'Your session expired. Sign in again.');
    let subject:string;
    try{
      const {payload}=await jwtVerify(token,keys,{issuer:config.issuer,algorithms:['RS256'],
        requiredClaims:['exp','iat','sub','client_id','token_use','scope'],maxTokenAge:'1h',clockTolerance:5});
      if(payload.token_use!=='access'||payload.client_id!==config.client||typeof payload.sub!=='string'||
        payload.sub.length>200||typeof payload.scope!=='string'||!payload.scope.split(' ').includes('aws.cognito.signin.user.admin')){
        throw new AppError(401,'Your session expired. Sign in again.');
      }
      subject=payload.sub;
    }catch(error){
      if(error instanceof AppError)throw error;
      const code=typeof error==='object'&&error!==null&&'code' in error?String(error.code):'';
      const rejected=code.startsWith('ERR_JWT_')||['ERR_JWS_INVALID','ERR_JWS_SIGNATURE_VERIFICATION_FAILED','ERR_JOSE_ALG_NOT_ALLOWED','ERR_JWKS_NO_MATCHING_KEY'].includes(code);
      throw new AppError(rejected?401:503,rejected?'Your session expired. Sign in again.':'Authentication is temporarily unavailable. Try again.');
    }
    // Signature validation alone cannot establish revocation. Check the current
    // access token with Cognito on every request, using no IAM credentials.
    let response:Response;
    try{
      response=await fetcher(`https://cognito-idp.${config.region}.amazonaws.com/`,{
        method:'POST',headers:{'Content-Type':'application/x-amz-json-1.1','X-Amz-Target':'AWSCognitoIdentityProviderService.GetUser'},
        body:JSON.stringify({AccessToken:token}),signal:AbortSignal.timeout(5000)
      });
    }catch{throw new AppError(503,'Authentication is temporarily unavailable. Try again.');}
    if(response.status===401||response.status===403)throw new AppError(401,'Your session expired. Sign in again.');
    if(response.status===400){
      let code='';try{code=String((await response.json()).__type||'').split('#').at(-1)||'';}catch{/* Malformed provider diagnostics remain unavailable. */}
      const rejected=['NotAuthorizedException','UserNotFoundException','UserNotConfirmedException','PasswordResetRequiredException'].includes(code);
      throw new AppError(rejected?401:503,rejected?'Your session expired. Sign in again.':'Authentication is temporarily unavailable. Try again.');
    }
    if(!response.ok)throw new AppError(503,'Authentication is temporarily unavailable. Try again.');
    let value:unknown;
    try{value=await response.json();}catch{throw new AppError(503,'Authentication is temporarily unavailable. Try again.');}
    const parsed=Attributes.safeParse(value);
    if(!parsed.success)throw new AppError(503,'Authentication is temporarily unavailable. Try again.');
    const attributes=parsed.data.UserAttributes;
    if(new Set(attributes.map(a=>a.Name)).size!==attributes.length)throw new AppError(503,'Authentication is temporarily unavailable. Try again.');
    const user=Object.fromEntries(attributes.map(a=>[a.Name,a.Value]));
    if(user.sub!==subject)throw new AppError(401,'Your session expired. Sign in again.');
    if(user.email_verified!=='true')throw new AppError(401,'A verified email is required.');
    if(!z.email().max(320).safeParse(user.email).success)throw new AppError(503,'Authentication is temporarily unavailable. Try again.');
    return {id:`cognito:${config.pool}:${subject}`,email:user.email.toLowerCase(),displayName:user.name?.slice(0,200)||user.email.split('@')[0]};
  };
}

export async function authenticateCognito(token:string):Promise<Actor>{
  const config=cognitoConfig(),key=JSON.stringify(config);
  let authenticate=sessions.get(key);
  if(!authenticate){
    if(sessions.size>=4)sessions.clear();
    authenticate=createCognitoAuthenticator(config);sessions.set(key,authenticate);
  }
  return authenticate(token);
}
