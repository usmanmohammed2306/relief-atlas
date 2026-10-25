import {BedrockRuntimeClient,ConverseCommand,type Message} from '@aws-sdk/client-bedrock-runtime';
import {z} from 'zod';
import {readBedrockConfig,type BedrockConfig} from './bedrock-proposer.js';
import {wireTools,agentMaxInputTokens,agentMaxOutputTokens,type AgentMessage,type AgentProvider} from './agent-contract.js';

export function readAgentConfig(env:NodeJS.ProcessEnv=process.env):BedrockConfig|undefined{
  if(!env.RELIEF_AGENT||env.RELIEF_AGENT==='disabled')return;
  if(env.RELIEF_AGENT!=='bedrock')throw new Error('Unknown agent configuration');
  // Reuse explicit regional access, price and budget requirements. Does not enable the old proposer.
  return readBedrockConfig({...env,RELIEF_PROPOSER:'bedrock'});
}
type Send=(command:ConverseCommand,signal:AbortSignal)=>Promise<unknown>;
export function bedrockAgent(config:BedrockConfig,send?:Send):AgentProvider{
  let client:BedrockRuntimeClient|undefined;
  return {source:'bedrock',modelId:config.modelId,async invoke(input,signal){
    const command=new ConverseCommand({modelId:config.modelId,system:[{text:input.system}],
      messages:input.messages as Message[],inferenceConfig:{maxTokens:agentMaxOutputTokens,temperature:0},
      toolConfig:{tools:wireTools.map(tool=>({toolSpec:{name:tool.name,description:tool.description,inputSchema:{json:JSON.parse(JSON.stringify(tool.inputSchema))}}}))}});
    if(!send)client??=new BedrockRuntimeClient({region:config.region,maxAttempts:1,endpoint:`https://bedrock-runtime.${config.region}.amazonaws.com`});
    const result=await(send?send(command,signal):client!.send(command,{abortSignal:signal}));
    const block=z.union([z.strictObject({text:z.string().max(12000)}),z.strictObject({toolUse:z.strictObject({toolUseId:z.string().min(1).max(100),name:z.string().min(1).max(64),input:z.unknown()})})]);
    const decoded=z.object({stopReason:z.enum(['tool_use','end_turn']),usage:z.object({inputTokens:z.number().int().min(0).max(agentMaxInputTokens),outputTokens:z.number().int().min(0).max(agentMaxOutputTokens)}),output:z.object({message:z.object({role:z.literal('assistant'),content:z.array(block).min(1).max(4)})})}).parse(result);
    if(Buffer.byteLength(JSON.stringify(decoded.output.message))>16000)throw new Error('Agent response too large');
    return {message:decoded.output.message as AgentMessage,stop:decoded.stopReason,...decoded.usage};
  }};
}
