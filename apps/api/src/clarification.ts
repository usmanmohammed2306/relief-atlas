import type { AtlasTask } from './atlas-parser.js';

export type DeadlineClarification = {
  taskIndex:number;
  field:'dueAt';
  code:'missing_time'|'missing_day'|'exact_deadline'|'future_deadline';
  question:string;
  explanation:string;
};

/** Read-only questions, not inferred dates. Answers use the existing draft CAS. */
export function deadlineClarifications(tasks:AtlasTask[],sourceText:string,now=new Date()):DeadlineClarification[] {
  return tasks.flatMap<DeadlineClarification>((task,taskIndex)=>{
    if(task.dueAt&&Number.isFinite(Date.parse(task.dueAt))&&new Date(task.dueAt)>now)return [];
    const name=`task ${taskIndex+1}, “${task.title}”`;
    if(task.dueAt)return [{taskIndex,field:'dueAt' as const,code:'future_deadline' as const,
      question:`What future date and exact time should ${name} be due?`,
      explanation:'The saved deadline is not in the future. Correcting it changes only this draft until you save and approve.'}];
    // A single source clause can supply a word such as Friday, never an assumed
    // calendar date. For multiple tasks, avoid guessing which clause maps where.
    const source=tasks.length===1?sourceText:'';
    const days=[...source.matchAll(/\b(today|tonight|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi)];
    const times=[...source.matchAll(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/gi)];
    const ambiguous=/\b(or|between|next|est|edt|cst|cdt|mst|mdt|pst|pdt|utc|gmt)\b|\d{4}-\d{2}-\d{2}/i.test(source);
    if(!ambiguous&&days.length===1&&times.length===0)return [{taskIndex,field:'dueAt' as const,code:'missing_time' as const,
      question:`What exact time should ${name} be due?`,
      explanation:`You mentioned “${days[0][0]}”. Confirm its calendar date too. Words such as evening do not authorize Atlas to choose a time.`}];
    if(!ambiguous&&days.length===0&&times.length===1)return [{taskIndex,field:'dueAt' as const,code:'missing_day' as const,
      question:`On what date should ${name} be due?`,
      explanation:`You mentioned “${times[0][0]}”. Confirm the exact time with its date in your browser timezone.`}];
    return [{taskIndex,field:'dueAt' as const,code:'exact_deadline' as const,
      question:`What exact date and time should ${name} be due?`,
      explanation:'The deadline is missing or ambiguous. Atlas will not choose a date, time or timezone for you.'}];
  });
}
