export type ScopeDecision={allowed:boolean;reason?:string;warnings:string[]};

export function checkSafetyText(input:string):string|undefined {
  const text=input.toLowerCase();
  if (/\b(911|ambulance|not breathing|chest pain|stroke|unconscious|suicid(?:e|al)?|overdose|emergency)\b/.test(text)) return 'Relief is not an emergency service. Contact local emergency services now.';
  if (/\b(medication|medicine|pill|pills|dose|dosage|prescription|insulin|injection|diagnos(?:is|e|ing)|treat(?:ment|ing)|wound care)\b/.test(text)) return 'Medication and clinical tasks are outside Relief’s first release.';
}

export function checkScope(input:string):ScopeDecision {
  const text=input.toLowerCase();
  const safety=checkSafetyText(text);
  if (safety) return {allowed:false,reason:safety,warnings:[]};
  const kinds=[/\b(meal|dinner|lunch|breakfast|food)\b/,/\b(visit|check.?in|see (dad|mom|mum|him|her))\b/,/\b(ride|drive|pickup|pick up|transport)\b/].filter(pattern=>pattern.test(text)).length;
  if (kinds===0) return {allowed:false,reason:'Describe a meal drop-off, visit/check-in, or ride.',warnings:[]};
  if (kinds>1 || /\b(mom|mum|mother)\b[\s\S]*\b(dad|father)\b|\b(dad|father)\b[\s\S]*\b(mom|mum|mother)\b/.test(text)) return {allowed:false,reason:'This sounds like more than one care gap. Create one request at a time so none is lost.',warnings:[]};
  const warnings:string[]=[];
  if (!/\b(1[0-2]|0?[1-9])(?::[0-5]\d)?\s*(am|pm)\b|\b(noon|midnight)\b/.test(text)) warnings.push('No exact time was given. Confirm or change the suggested time before sending.');
  return {allowed:true,warnings};
}
