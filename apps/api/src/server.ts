import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z, ZodError } from 'zod';
import type { Database } from './db.js';
import { createDatabase,prepareSchema,seedDemo } from './db.js';
import { authenticate,demoEnabled } from './auth.js';
import { createMcpServer } from './mcp.js';
import { AppError,ReliefService } from './service.js';
import { UnavailableDates } from './availability.js';
import { AtlasService,AtlasTasks } from './atlas.js';
import { deliveryMode,startWorker } from './worker.js';
import { securityConfig } from './security.js';
import { runReliabilityLab } from './reliability-lab.js';
import { ProposalService } from './proposal-service.js';
import { bedrockProvider, readBedrockConfig } from './bedrock-proposer.js';
import { observe, operationalId, planReceipt, type Observation, type Observer } from './telemetry.js';

try { process.loadEnvFile(); } catch { /* The deployment environment supplies variables. */ }
if (process.env.NODE_ENV==='production' && demoEnabled() && process.env.DEMO_PUBLIC_CONFIRM!=='fictional-data-only') throw new Error('Public demo mode requires DEMO_PUBLIC_CONFIRM=fictional-data-only and an isolated fictional database.');

const Preview=z.object({householdId:z.string(),text:z.string().min(4).max(1000)});
const PlanInput=Preview.extend({useModel:z.boolean().optional(),proposalKey:z.uuid().optional()});
export async function createApp(db:Database,options:{worker?:boolean;proposals?:ProposalService;observer?:Observer;logStream?:{write:(line:string)=>void}}={}) {
  deliveryMode();
  const security=securityConfig();
  const app=Fastify({logger:{redact:['req.headers.authorization','req.headers.cookie'],
    // URL queries and route parameters can contain private text. Operational
    // receipts below use registered route templates, never the incoming URL.
    serializers:{req:(request:{method?:string})=>({method:request.method}),res:(reply:{statusCode?:number})=>({statusCode:reply.statusCode})},
    ...(options.logStream?{stream:options.logStream}:{})},trustProxy:security.trustProxy,bodyLimit:32*1024,
    requestIdHeader:false,genReqId:()=>randomUUID()});
  const operationalObserver:Observer=event=>{
    observe(options.observer,event);
    app.log.info({operation:event},'Operational receipt');
  };
  const receipts=new WeakMap<object,Pick<Observation,'planId'|'careRequestIds'>>();
  const service=new ReliefService(db);
  const config=options.proposals?undefined:readBedrockConfig();
  const proposals=options.proposals||(config?new ProposalService(db,bedrockProvider(config),config):undefined);
  const atlas=new AtlasService(db,service,proposals);
  await app.register(cors,{origin:security.origin,allowedHeaders:['content-type','authorization','x-demo-user','mcp-protocol-version','mcp-session-id'],methods:['GET','POST','PUT','PATCH','DELETE','OPTIONS']});
  app.addHook('onSend',async(request,reply,payload)=>{
    reply.header('x-request-id',request.id);
    for(const [name,value] of Object.entries(security.headers))reply.header(name,value);
    if (request.url.startsWith('/api/')||request.url.startsWith('/mcp')) reply.header('cache-control','no-store');
    const route=request.routeOptions.url;
    if(reply.statusCode<300&&typeof payload==='string'&&route&&[
      '/api/atlas/plans','/api/atlas/plans/:id','/api/atlas/plans/:id/approve','/api/atlas/requests/:id/recover','/api/simulate'
    ].includes(route)){
      try{
        const receipt=planReceipt(JSON.parse(payload));
        if(route==='/api/atlas/plans/:id/approve')receipt.planId=operationalId((request.params as {id?:string}).id);
        receipts.set(request,receipt);
      }catch{/* A logging failure must not change the response. */}
    }
    return payload;
  });
  app.addHook('onResponse',async(request,reply)=>{
    observe(operationalObserver,{kind:'http',requestId:request.id,route:request.routeOptions.url,
      method:request.method,statusCode:reply.statusCode,durationMs:reply.elapsedTime,...receipts.get(request)});
  });
  const buckets=new Map<string,{count:number;reset:number}>();
  app.addHook('onRequest',async request=>{
    if(request.url==='/api/health'||request.url==='/api/ready')return;
    const key=request.ip;
    const now=Date.now();
    const bucket=buckets.get(key);
    if(!bucket&&buckets.size>=10_000){
      for(const [ip,value] of buckets)if(value.reset<=now)buckets.delete(ip);
      if(buckets.size>=10_000)throw new AppError(429,'Server is busy. Try again shortly.');
    }
    if (!bucket||bucket.reset<now) buckets.set(key,{count:1,reset:now+60_000});
    else if (++bucket.count>120) throw new AppError(429,'Too many requests. Try again shortly.');
  });
  app.setErrorHandler((error,request,reply)=>{
    const providedStatus=typeof error==='object'&&error!==null&&'statusCode' in error?error.statusCode:undefined;
    const status=error instanceof AppError?error.status:error instanceof ZodError?422:typeof providedStatus==='number'&&providedStatus>=400&&providedStatus<500?providedStatus:500;
    if (status===500) {
      const code=typeof error==='object'&&error!==null&&'code' in error?String(error.code):'';
      request.log.error({errorType:error instanceof Error?error.name:'UnknownError',...( /^[A-Z0-9_]{1,40}$/.test(code)?{code}:{})},'Request failed; use the request ID for investigation.');
    }
    reply.code(status).send({error:status===500?'Something went wrong. Please try again.':error instanceof AppError||error instanceof ZodError?error.message:'Invalid request. Check the request body and size.'});
  });
  app.get('/api/health',async()=>({ok:true,demo:demoEnabled()}));
  app.get('/api/ready',async(_request,reply)=>{
    try{await db.query('SELECT 1');return {ok:true};}
    catch{return reply.code(503).send({ok:false,error:'Database unavailable'});}
  });
  app.get('/api/public-config',async()=>({supabaseUrl:process.env.SUPABASE_URL||'',supabaseAnonKey:process.env.SUPABASE_ANON_KEY||'',deliveryMode:deliveryMode(),model:{available:!!proposals,source:proposals?.provider.source||'disabled'}}));
  app.get('/api/me',async request=>service.me(await authenticate(request)));
  app.post('/api/households',async request=>{
    const actor=await authenticate(request);await service.upsertUser(actor);
    return service.createHousehold(actor,z.object({name:z.string().min(2).max(80),careRecipientName:z.string().min(1).max(60),consentAttested:z.boolean(),timezone:z.string().min(3)}).parse(request.body));
  });
  app.get<{Params:{id:string}}>('/api/households/:id/circle',async request=>service.circle(await authenticate(request),request.params.id));
  app.get<{Params:{id:string};Querystring:{type:string}}>('/api/households/:id/eligible',async request=>service.eligibleFor(await authenticate(request),request.params.id,request.query.type));
  app.post<{Params:{id:string}}>('/api/households/:id/invitations',async request=>service.invite(await authenticate(request),request.params.id,z.object({email:z.email()}).parse(request.body).email));
  app.post<{Params:{id:string}}>('/api/households/:id/join',async request=>service.join(await authenticate(request),request.params.id));
  app.patch<{Params:{id:string}}>('/api/households/:id/preferences',async request=>service.preferences(await authenticate(request),request.params.id,z.object({taskTypes:z.array(z.enum(['meal','visit','ride'])),quietStart:z.number().int().min(0).max(23),quietEnd:z.number().int().min(0).max(23),timezone:z.string().min(3),optedIn:z.boolean(),unavailableDates:UnavailableDates.optional()}).parse(request.body)));
  app.delete<{Params:{id:string;membershipId:string}}>('/api/households/:id/members/:membershipId',async request=>service.removeHelper(await authenticate(request),request.params.id,request.params.membershipId));
  app.post('/api/requests/preview',async request=>{const input=Preview.parse(request.body);return service.preview(await authenticate(request),input.householdId,input.text);});
  app.get<{Params:{id:string}}>('/api/drafts/:id',async request=>service.getDraft(await authenticate(request),request.params.id));
  app.post('/api/atlas/plans',async request=>{const input=PlanInput.parse(request.body);return atlas.create(await authenticate(request),input.householdId,input.text,input);});
  app.get<{Params:{id:string}}>('/api/atlas/plans/:id',async request=>atlas.get(await authenticate(request),request.params.id));
  app.get<{Params:{id:string}}>('/api/atlas/households/:id/drafts',async request=>atlas.drafts(await authenticate(request),request.params.id));
  app.put<{Params:{id:string}}>('/api/atlas/plans/:id',async request=>{const input=z.object({previousDigest:z.string().length(64),tasks:AtlasTasks}).parse(request.body);return atlas.update(await authenticate(request),request.params.id,input.previousDigest,input.tasks);});
  app.post<{Params:{id:string}}>('/api/atlas/plans/:id/approve',async request=>atlas.approve(await authenticate(request),request.params.id,z.object({digest:z.string().length(64)}).parse(request.body).digest));
  app.post<{Params:{id:string}}>('/api/atlas/plans/:id/rehearse',async request=>atlas.rehearse(await authenticate(request),request.params.id,z.object({excludedMembershipId:z.string()}).parse(request.body).excludedMembershipId));
  app.post<{Params:{id:string}}>('/api/atlas/requests/:id/recover',async request=>atlas.recover(await authenticate(request),request.params.id));
  app.get<{Params:{id:string}}>('/api/atlas/requests/:id/timeline',async request=>atlas.timeline(await authenticate(request),request.params.id));
  app.get<{Params:{id:string}}>('/api/atlas/households/:id/operations',async request=>atlas.operations(await authenticate(request),request.params.id));
  let activeLab:ReturnType<typeof runReliabilityLab>|null=null;
  let lastLabStarted=0;
  app.post('/api/demo/reliability-lab',async request=>{
    if(!demoEnabled()||deliveryMode()!=='simulated')throw new AppError(404,'Not found');
    const actor=await authenticate(request);
    const membership=await db.query("SELECT id FROM memberships WHERE user_id=$1 AND role='organizer' AND status='active' LIMIT 1",[actor.id]);
    if(!membership.rows.length)throw new AppError(403,'Only an organizer can run the fictional lab.');
    if(activeLab)throw new AppError(409,'A fictional drill is already running. Wait for its result.');
    if(Date.now()-lastLabStarted<30_000)throw new AppError(429,'Wait 30 seconds between fictional drills.');
    lastLabStarted=Date.now();
    // The runner creates its own databases. It never receives this household database.
    activeLab=runReliabilityLab({demoEnabled:true});
    try{return await activeLab;}finally{activeLab=null;}
  });
  app.post('/api/requests',async()=>{throw new AppError(410,'Direct dispatch is disabled. Review and approve an Atlas plan.');});
  app.post<{Params:{id:string}}>('/api/offers/:id/respond',async request=>service.offerResponse(await authenticate(request),request.params.id,z.object({response:z.enum(['accept','decline'])}).parse(request.body).response));
  app.post<{Params:{id:string}}>('/api/requests/:id/helper-complete',async request=>service.helperComplete(await authenticate(request),request.params.id));
  app.post<{Params:{id:string}}>('/api/requests/:id/organizer-confirm',async request=>service.organizerConfirm(await authenticate(request),request.params.id,z.object({decision:z.enum(['confirm','dispute'])}).parse(request.body).decision));
  app.post<{Params:{id:string}}>('/api/requests/:id/helper-cancel',async request=>service.helperCancel(await authenticate(request),request.params.id));
  app.get<{Params:{id:string}}>('/api/requests/:id/status',async request=>service.requestStatus(await authenticate(request),request.params.id));
  app.get<{Params:{id:string}}>('/api/households/:id/board',async request=>service.board(await authenticate(request),request.params.id));
  app.route({method:['GET','POST','DELETE'],url:'/mcp',handler:async(request,reply)=>{
    const origin=request.headers.origin;
    if (origin && origin!==security.origin) throw new AppError(403,'Origin not allowed.');
    const actor=await authenticate(request);
    const mcp=createMcpServer(service,atlas,actor,operationalObserver,request.id);
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    await mcp.connect(transport);
    // Hijacked MCP responses bypass Fastify's onSend hook.
    for(const [name,value] of Object.entries(security.headers))reply.raw.setHeader(name,value);
    reply.raw.setHeader('x-request-id',request.id);
    reply.raw.setHeader('cache-control','no-store');
    reply.hijack();
    try { await transport.handleRequest(request.raw,reply.raw,request.body); }
    finally { await mcp.close(); }
  }});
  const simulateTool=async(request:Parameters<typeof authenticate>[0],name:string,args:Record<string,unknown>)=>{
    const actor=await authenticate(request);
    const bound=app.server.address();
    if(!bound||typeof bound==='string')throw new AppError(503,'The local MCP listener is unavailable.');
    const port=bound.port;
    const headers:Record<string,string>=demoEnabled()?{'x-demo-user':actor.id}:{Authorization:request.headers.authorization || ''};
    const client=new Client({name:'relief-web-simulator',version:'0.1.0'});
    const transport=new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`),{requestInit:{headers}});
    try {
      await client.connect(transport);
      const catalog=await client.listTools();
      if(!catalog.tools.some(tool=>tool.name===name))throw new Error('Requested tool is unavailable.');
      const result=await client.callTool({name,arguments:args});
      const content=(result.content as Array<{type:string;text?:string}> | undefined)?.[0];
      if (result.isError) throw new AppError(422,content?.text||'MCP tool failed');
      if (!content || content.type!=='text') throw new Error('MCP returned no result');
      return {...JSON.parse(content.text || '{}'),via:'mcp',mcpTrace:{protocol:transport.protocolVersion,server:client.getServerVersion()?.name,toolCount:catalog.tools.length,tool:name,steps:['initialize','tools/list','tools/call']}};
    } finally { await client.close(); }
  };
  app.post('/api/simulate',async request=>{
    const input=PlanInput.parse(request.body);
    return simulateTool(request,'create_atlas_plan',{householdId:input.householdId,request:input.text,useModel:input.useModel,proposalKey:input.proposalKey});
  });
  app.post('/api/simulate/rehearse',async request=>{
    const input=z.object({planId:z.string(),excludedMembershipId:z.string()}).parse(request.body);
    return simulateTool(request,'rehearse_decline',input);
  });
  app.post('/api/simulate/coverage',async request=>{
    const input=z.object({householdId:z.string()}).parse(request.body);
    return simulateTool(request,'get_household_summary',input);
  });

  const webDist=fileURLToPath(new URL('../../web/dist/',import.meta.url));
  if (existsSync(webDist)) {
    await app.register(fastifyStatic,{root:webDist,prefix:'/'});
    app.setNotFoundHandler((request,reply)=>request.url.startsWith('/api')||request.url.startsWith('/mcp')?reply.code(404).send({error:'Not found'}):reply.sendFile('index.html'));
  }else app.setNotFoundHandler((_request,reply)=>reply.code(404).send({error:'Not found'}));
  const stop=options.worker?startWorker(db,operationalObserver):()=>{};
  app.addHook('onClose',async()=>{await activeLab?.catch(()=>{});await stop();await db.close();});
  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) {
  const db=await createDatabase();
  await prepareSchema(db);
  if (demoEnabled()) await seedDemo(db);
  const app=await createApp(db,{worker:process.env.WORKER_MODE!=='external'});
  for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>{
    void app.close().catch(()=>{console.error('Graceful shutdown failed.');process.exitCode=1;});
  });
  await app.listen({host:'0.0.0.0',port:Number(process.env.PORT || 4000)});
}
