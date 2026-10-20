import { z } from 'zod';
import { nextTimeInZone } from './time.js';

export const TaskType = z.enum(['meal', 'visit', 'ride']);
export type TaskType = z.infer<typeof TaskType>;
export const ExtractedTask = z.object({
  type: TaskType,
  title: z.string().min(4).max(120),
  dueAt: z.iso.datetime({ offset: true })
});
export type ExtractedTask = z.infer<typeof ExtractedTask>;

export function fallbackExtract(text: string,timeZone='America/Phoenix',now=new Date()): ExtractedTask {
  const lower = text.toLowerCase();
  const type: TaskType = /ride|drive|pickup|pick up|appointment|transport/.test(lower) ? 'ride' : /visit|check.?in|see (dad|mom|mum|him|her)/.test(lower) ? 'visit' : 'meal';
  const time = lower.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/);
  let hour = type === 'meal' ? 18 : 16;
  let minute=0;
  if (time) hour = Number(time[1]) % 12 + (time[3] === 'pm' ? 12 : 0);
  if (time?.[2]) minute=Number(time[2]);
  const dayOffset = /tomorrow/.test(lower) ? 1 : 0;
  const dueAt = nextTimeInZone(hour,minute,dayOffset,timeZone,now).toISOString();
  const title = type === 'meal' ? 'Bring a meal' : type === 'ride' ? 'Provide a ride' : 'Visit and check in';
  return { type, title, dueAt };
}

export async function extractTask(text: string,timeZone='America/Phoenix'): Promise<{ task: ExtractedTask; source: 'manual-fallback' }> {
  return {task:fallbackExtract(text,timeZone),source:'manual-fallback'};
}

export function safeBrief(type: TaskType, _title: string): string {
  const label = type === 'meal' ? 'meal drop-off' : type === 'ride' ? 'ride coordination' : 'visit/check-in';
  return `Help requested: ${label}. Please accept only if you can follow through.`;
}
