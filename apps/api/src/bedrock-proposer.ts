import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { z } from 'zod';
import type { ProposalProvider, ProviderResponse, proposalMessages } from './proposals.js';

export const modelInputTokenAllowance=8192,modelOutputTokenLimit=1024;
export type ModelLimits={maxCalls:number;dailyMicros:number;inputUsdPerMillion:number;outputUsdPerMillion:number;timeoutMs:number};
export type BedrockConfig=ModelLimits&{region:string;modelId:string};
const positive=(value:string|undefined,max:number)=>z.coerce.number().positive().max(max).parse(value);
export function readBedrockConfig(env:NodeJS.ProcessEnv=process.env):BedrockConfig|undefined {
  if(!env.RELIEF_PROPOSER||env.RELIEF_PROPOSER==='deterministic')return;
  if(env.RELIEF_PROPOSER!=='bedrock')throw new Error('Unknown proposer configuration');
  if(env.RELIEF_MODEL_APPROVAL!=='owner-approved-fictional-trial')throw new Error('Model use requires owner-approved account, price, budget and fictional-data checks');
  const region=z.string().regex(/^(?:us|eu|ap|ca|sa|me|af|il|mx)-(?:[a-z]+-)+\d$/).parse(env.AWS_REGION);
  const modelId=z.string().min(3).max(160).regex(/^[a-z0-9][a-z0-9.-]*(?::\d+)?$/).parse(env.RELIEF_MODEL_ID);
  if(/^(?:us|eu|global|apac)\./.test(modelId))throw new Error('Cross-region inference profiles require a separate architecture and cost review');
  return {region,modelId,maxCalls:z.coerce.number().int().min(1).max(100).parse(env.RELIEF_MODEL_MAX_CALLS_PER_DAY),
    dailyMicros:Math.floor(positive(env.RELIEF_MODEL_DAILY_USD,5)*1e6),
    inputUsdPerMillion:positive(env.RELIEF_MODEL_INPUT_USD_PER_MILLION,1000),
    outputUsdPerMillion:positive(env.RELIEF_MODEL_OUTPUT_USD_PER_MILLION,1000),timeoutMs:10000};
}
// Injectable send seam tests the actual SDK command without network or credentials.
type Send=(command:ConverseCommand,signal:AbortSignal)=>Promise<unknown>;
export function bedrockProvider(config:BedrockConfig,send?:Send):ProposalProvider {
  let client:BedrockRuntimeClient|undefined;
  return {source:'bedrock',modelId:config.modelId,async invoke(input:ReturnType<typeof proposalMessages>,signal:AbortSignal):Promise<ProviderResponse>{
    const command=new ConverseCommand({modelId:config.modelId,system:[{text:input.system}],
      messages:[{role:'user',content:[{text:input.user}]}],inferenceConfig:{maxTokens:modelOutputTokenLimit,temperature:0}});
    if(!send)client??=new BedrockRuntimeClient({region:config.region,maxAttempts:1,
      endpoint:`https://bedrock-runtime.${config.region}.amazonaws.com`});
    const result=await (send?send(command,signal):client!.send(command,{abortSignal:signal}));
    const envelope=z.object({stopReason:z.literal('end_turn'),usage:z.object({inputTokens:z.number().int().nonnegative().max(modelInputTokenAllowance),
      outputTokens:z.number().int().nonnegative().max(modelOutputTokenLimit)}),
      output:z.object({message:z.object({role:z.literal('assistant'),content:z.array(z.strictObject({text:z.string().max(16000)})).min(1).max(8)})})}).parse(result);
    const text=envelope.output.message.content.map(part=>part.text).join('');
    if(Buffer.byteLength(text)>16000)throw new Error('Model response too large');
    return {raw:JSON.parse(text),...envelope.usage};
  }};
}
