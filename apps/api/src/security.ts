import { isIP } from 'node:net';

export function securityConfig(env:NodeJS.ProcessEnv=process.env) {
  const production=env.NODE_ENV==='production';
  const origin=new URL(env.APP_ORIGIN||'http://localhost:5173');
  if(!['https:','http:'].includes(origin.protocol)||origin.origin!==origin.href.replace(/\/$/,''))throw new Error('APP_ORIGIN must be a plain HTTP(S) origin.');
  if(production&&env.DEMO_MODE!=='true'&&(!env.APP_ORIGIN||origin.protocol!=='https:'))throw new Error('Production requires an explicit HTTPS APP_ORIGIN.');
  const auth=env.SUPABASE_URL?new URL(env.SUPABASE_URL):undefined;
  if(auth&&(auth.protocol!=='https:'||auth.username||auth.password))throw new Error('Authentication requires HTTPS without URL credentials.');
  const proxy=(env.TRUSTED_PROXY_CIDRS||'').split(',').map(value=>value.trim()).filter(Boolean);
  for(const value of proxy){
    const [host,bits,...extra]=value.split('/'),version=isIP(host);
    if(!version||extra.length||bits===undefined||!/^\d+$/.test(bits)||Number(bits)<1||Number(bits)>(version===4?32:128))throw new Error('Trust only explicit proxy IP ranges, never every forwarded header.');
  }
  const headers:Record<string,string>={
    'x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY',
    'permissions-policy':'camera=(), microphone=(), geolocation=()',
    'content-security-policy':`default-src 'self'; script-src 'self'; style-src 'self'${production?'':" 'unsafe-inline'"}; img-src 'self' data:; font-src 'self'; connect-src 'self'${auth?` ${auth.origin}`:''}${production?'':' ws: wss:'}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`
  };
  if(production&&origin.protocol==='https:')headers['strict-transport-security']='max-age=31536000';
  return {origin:origin.origin,trustProxy:proxy.length?proxy:false,headers};
}
