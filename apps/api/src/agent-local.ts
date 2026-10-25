import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AgentAnswer,wireTools,agentMaxInputTokens,agentMaxOutputTokens,type AgentMessage,type AgentProvider} from './agent-contract.js';
import type {ModelLimits} from './bedrock-proposer.js';
export type LocalAgentConfig=ModelLimits&{origin:string;modelId:string};
export function readLocalAgentConfig(env:NodeJS.ProcessEnv=process.env):LocalAgentConfig|undefined{
 if(env.RELIEF_AGENT!=='ollama')return;
 const endpoint=new URL(env.RELIEF_LOCAL_ORIGIN||'http://127.0.0.1:11434');
 if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||endpoint.username||endpoint.password||endpoint.pathname!=='/'||endpoint.search||endpoint.hash)throw new Error('Local inference must use a literal loopback HTTP origin.');
 const modelId=z.string().regex(/^[a-z0-9][a-z0-9._-]*:[a-z0-9._-]+$/).max(100).parse(env.RELIEF_LOCAL_MODEL||'qwen3:4b-instruct');
 if(/cloud/i.test(modelId))throw new Error('Cloud-routed models are forbidden in local mode.');
 return {origin:endpoint.origin,modelId,maxCalls:z.coerce.number().int().min(4).max(100).parse(env.RELIEF_LOCAL_MAX_CALLS_PER_DAY||'32'),dailyMicros:5_000_000,inputUsdPerMillion:0,outputUsdPerMillion:0,timeoutMs:90000};
}
async function boundedJson(response:Response,limit:number){
 if(!response.ok||!response.body)throw new Error('Local inference unavailable');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>limit)throw new Error('Local response too large');chunks.push(part.value);}}
 finally{await reader.cancel().catch(()=>{});}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function localAgent(config:LocalAgentConfig,send:typeof fetch=fetch):AgentProvider{
 let verified=false;
 return {source:'local',modelId:config.modelId,async invoke(input,signal){
  if(!verified){
   const metadata=await boundedJson(await send(config.origin+'/api/show',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:config.modelId}),signal,redirect:'error'}),200000);
   if(metadata.remote_host||metadata.remote_model||!Array.isArray(metadata.capabilities)||!metadata.capabilities.includes('tools')||!metadata.details?.quantization_level)throw new Error('A local tool-capable model is required.');
   verified=true;
  }
  const messages:Record<string,unknown>[]=[{role:'system',content:input.system+'\n/no_think\nCall the needed tools without narrating reasoning. When ready, call present_plan with the final answer fields. This is a response formatter, not an action. Do not mix it with other tool calls. The adapter converts it to the required final JSON.'}],names=new Map<string,string>();
  for(const message of input.messages){
   const text=message.content.flatMap(block=>'text'in block?[block.text]:[]).join('');
   const calls=message.content.flatMap(block=>'toolUse'in block?[block.toolUse]:[]);
   const results=message.content.flatMap(block=>'toolResult'in block?[block.toolResult]:[]);
   if(results.length){for(const result of results){const name=names.get(result.toolUseId);if(!name)throw new Error('Missing local tool correlation');messages.push({role:'tool',tool_name:name,content:JSON.stringify(result.content.map(item=>item.json))});}}
   else{for(const call of calls)names.set(call.toolUseId,call.name);messages.push({role:message.role,content:text,...(calls.length?{tool_calls:calls.map(call=>({function:{name:call.name,arguments:call.input}}))}:{})});}
  }
  const raw=await boundedJson(await send(config.origin+'/api/chat',{method:'POST',headers:{'content-type':'application/json'},redirect:'error',signal,
   body:JSON.stringify({model:config.modelId,messages,tools:[...wireTools.map(tool=>({type:'function',function:{name:tool.name,description:tool.description,parameters:tool.inputSchema}})),{type:'function',function:{name:'present_plan',description:'Format the final grounded answer after checking facts. Does not execute, approve or send anything.',parameters:z.toJSONSchema(AgentAnswer)}}],stream:false,think:false,keep_alive:'5m',options:{temperature:0,seed:0,num_ctx:8192,num_predict:agentMaxOutputTokens}})}),20000);
  const decoded=z.object({model:z.literal(config.modelId),done:z.literal(true),done_reason:z.literal('stop'),prompt_eval_count:z.number().int().min(0).max(agentMaxInputTokens),eval_count:z.number().int().min(0).max(agentMaxOutputTokens),message:z.object({role:z.literal('assistant'),content:z.string().max(12000),tool_calls:z.array(z.object({function:z.object({name:z.string().min(1).max(64),arguments:z.record(z.string(),z.unknown())})})).max(4).optional()})}).parse(raw);
  const proposed=decoded.message.tool_calls||[];
  // A premature formatter mixed with reads is discarded, never presented.
  // Execute only the requested read calls, then let the model see fresh results.
  const calls=proposed.length>1?proposed.filter(call=>call.function.name!=='present_plan'):proposed;const content:AgentMessage['content']=[];
  if(calls.some(call=>call.function.name==='present_plan')){if(calls.length!==1)throw new Error('Invalid final formatter batch');const answer=AgentAnswer.parse(calls[0].function.arguments);return {message:{role:'assistant',content:[{text:JSON.stringify(answer)}]},stop:'end_turn',inputTokens:decoded.prompt_eval_count,outputTokens:decoded.eval_count};}
  if(decoded.message.content)content.push({text:decoded.message.content});
  for(const call of calls)content.push({toolUse:{toolUseId:`local_${randomUUID()}`,name:call.function.name,input:call.function.arguments}});
  if(!content.length)throw new Error('Empty local model response');
  return {message:{role:'assistant',content},stop:calls.length?'tool_use':'end_turn',inputTokens:decoded.prompt_eval_count,outputTokens:decoded.eval_count};
 }};
}
