import { z } from 'zod';
import { TaskType, safeBrief } from './ai.js';
import { nextTimeInZone } from './time.js';

export const AtlasTask = z.object({
  type: TaskType,
  title: z.string().min(4).max(120),
  brief: z.string().min(4).max(300),
  dueAt: z.iso.datetime({offset:true}).nullable(),
  recipientIds: z.array(z.string()).max(5),
  location: z.string().max(200),
  instructions: z.string().max(1000),
  warnings: z.array(z.string())
});
export type AtlasTask = z.infer<typeof AtlasTask>;

const actions=/\b(?:bring|deliver|drop off|check on|check in(?: on)?|visit|drive|pick up|give (?:him|her|dad|mom) a ride)\b/gi;
const weekdays=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

function segments(text:string):string[] {
  const matches=[...text.matchAll(actions)];
  if (!matches.length) return [text.trim()];
  return matches.map((match,index)=>text.slice(match.index!,index+1<matches.length?matches[index+1].index:text.length).replace(/[\s,;]+(?:and|then)\s*$/i,'').trim());
}

export function explicitDue(segment:string,timeZone:string,now:Date):string|null {
  const lower=segment.toLowerCase();
  const times=[...lower.matchAll(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/g)];
  const days=[...lower.matchAll(/\b(today|tonight|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g)];
  // Alternatives, ranges and named foreign zones need an explicit organizer
  // choice. Taking the first match would invent a fact from an ambiguous ask.
  if(times.length!==1||days.length!==1||/\b(or|between|next|est|edt|cst|cdt|mst|mdt|pst|pdt|utc|gmt)\b|\d{4}-\d{2}-\d{2}/.test(lower))return null;
  const time=times[0];
  const hour=Number(time[1])%12+(time[3]==='pm'?12:0);
  const minute=Number(time[2]||0);
  let offset:number;
  if (/\btomorrow\b/.test(lower)) offset=1;
  else if (/\btoday\b|\btonight\b/.test(lower)) offset=0;
  else {
    const named=weekdays.findIndex(day=>new RegExp(`\\b${day}\\b`).test(lower));
    if (named<0) return null;
    const todayName=new Intl.DateTimeFormat('en-US',{timeZone,weekday:'long'}).format(now).toLowerCase();
    offset=(named-weekdays.indexOf(todayName)+7)%7;
  }
  try {
    const due=nextTimeInZone(hour,minute,offset,timeZone,now,false);
    if (due<=now && offset===0) {
      if (/\btoday\b|\btonight\b/.test(lower)) return null;
      return nextTimeInZone(hour,minute,7,timeZone,now,false).toISOString();
    }
    return due>now?due.toISOString():null;
  } catch { return null; }
}

export function draftFromEvidence(type:AtlasTask['type'],quote:string,timeZone:string,now:Date):AtlasTask {
  const title=type==='meal'?'Bring a meal':type==='visit'?'Visit and check in':'Provide a ride';
  const dueAt=explicitDue(quote,timeZone,now);
  return {type,title,brief:safeBrief(type,title),dueAt,recipientIds:[],location:'',instructions:'',
    warnings:dueAt?[]:['An exact day and time are required. Choose them before approval.']};
}

export function parseAtlasTasks(text:string,timeZone:string,now=new Date()):AtlasTask[] {
  const parts=segments(text);
  if (parts.length>5) throw new Error('Describe at most five separate tasks.');
  if (!/\b(meal|dinner|lunch|breakfast|food|bring|deliver|visit|check on|check in|ride|drive|pick up)\b/i.test(text)) throw new Error('Describe a meal, visit, or ride.');
  return parts.map(part=>{
    const lower=part.toLowerCase();
    const type=TaskType.parse(/\b(ride|drive|pick up|pickup|transport)\b/.test(lower)?'ride':/\b(visit|check on|check in)\b/.test(lower)?'visit':'meal');
    const title=type==='meal'?'Bring a meal':type==='visit'?'Visit and check in':'Provide a ride';
    const dueAt=explicitDue(part,timeZone,now);
    const warnings=dueAt?[]:['An exact day and time are required. Choose them before approval.'];
    return {type,title,brief:safeBrief(type,title),dueAt,recipientIds:[],location:'',instructions:'',warnings};
  });
}
