import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Actor } from './service.js';
import { ReliefService } from './service.js';
import { AtlasService } from './atlas.js';
import { localDateKey } from './time.js';
import { observe, planReceipt, type Observer } from './telemetry.js';

const asText=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}]});

export function createMcpServer(service:ReliefService,atlas:AtlasService,actor:Actor,observer?:Observer,requestId?:string):McpServer {
  const mcp=new McpServer({name:'relief-atlas',version:'1.0.0'});
  const result=(tool:string,value:unknown,plan=false)=>{
    observe(observer,{kind:'mcp_tool',requestId,tool,...(plan?planReceipt(value):{})});
    return asText(value);
  };
  mcp.registerTool('create_atlas_plan',{
    description:'Prepare up to five separate nonmedical tasks for organizer review. Never contacts helpers.',
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true},
    inputSchema:{householdId:z.string(),request:z.string().min(4).max(1000),
      useModel:z.boolean().optional().describe('Explicit consent to send only this request text to the configured model provider; disabled by default'),
      proposalKey:z.uuid().optional().describe('Required replay key for opt-in model drafting; never an approval key')}
  },async ({householdId,request,useModel,proposalKey})=>result('create_atlas_plan',await atlas.create(actor,householdId,request,{useModel,proposalKey}),true));
  mcp.registerTool('rehearse_decline',{
    description:'Read-only hypothetical: show what happens if one selected helper declines. Never changes real offers or sends outreach.',
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
    inputSchema:{planId:z.string(),excludedMembershipId:z.string()}
  },async ({planId,excludedMembershipId})=>result('rehearse_decline',await atlas.rehearse(actor,planId,excludedMembershipId)));
  mcp.registerTool('get_request_status',{
    description:'Read the verified status of a care request.',
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
    inputSchema:{requestId:z.string()}
  },async ({requestId})=>result('get_request_status',await service.requestStatus(actor,requestId)));
  mcp.registerTool('get_today_coverage',{
    description:'List care tasks due today, including at-risk or uncovered tasks.',
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
    inputSchema:{householdId:z.string()}
  },async ({householdId})=>{
    const board=await service.board(actor,householdId);
    const today=localDateKey(new Date(),board.timezone);
    return result('get_today_coverage',board.requests.filter(item=>localDateKey(new Date(item.due_at),board.timezone)===today).map(item=>({id:item.id,title:item.title,dueAt:item.due_at,status:item.status,atRisk:item.atRisk,acceptedBy:item.accepted_name || null})));
  });
  mcp.registerTool('get_household_summary',{
    description:'Summarize current coverage without private task details.',
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
    inputSchema:{householdId:z.string()}
  },async ({householdId})=>{
    const board=await service.board(actor,householdId);
    const totals={seeking:0,accepted:0,pendingConfirmation:0,confirmed:0,uncovered:0};
    for (const item of board.requests) {
      if (item.status==='seeking') totals.seeking++;
      if (item.status==='accepted') totals.accepted++;
      if (item.status==='helper_reported_done') totals.pendingConfirmation++;
      if (item.status==='confirmed_done') totals.confirmed++;
      if (item.status==='uncovered') totals.uncovered++;
    }
    return result('get_household_summary',totals);
  });
  return mcp;
}
