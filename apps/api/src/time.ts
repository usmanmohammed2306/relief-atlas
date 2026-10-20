type LocalParts={year:number;month:number;day:number;hour:number;minute:number};

function localParts(date:Date,timeZone:string):LocalParts {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const get=(type:string)=>Number(parts.find(part=>part.type===type)?.value);
  return {year:get('year'),month:get('month'),day:get('day'),hour:get('hour'),minute:get('minute')};
}

function localInstant(local:LocalParts,timeZone:string):Date {
  const target=Date.UTC(local.year,local.month-1,local.day,local.hour,local.minute);
  // Sample offsets on both sides of a daylight-saving transition. A repeated
  // clock time has two matches; a skipped time has none. Neither may be guessed.
  const offsets=new Set<number>();
  for(const hours of [-48,-24,0,24,48]) {
    const sample=target+hours*3600_000;
    const observed=localParts(new Date(sample),timeZone);
    offsets.add(Date.UTC(observed.year,observed.month-1,observed.day,observed.hour,observed.minute)-sample);
  }
  const matches=[...offsets].map(offset=>new Date(target-offset)).filter(candidate=>{
    const observed=localParts(candidate,timeZone);
    return Object.keys(local).every(key=>observed[key as keyof LocalParts]===local[key as keyof LocalParts]);
  });
  if(matches.length!==1)throw new Error('This local time is ambiguous or does not exist. Please choose another time.');
  return matches[0];
}

export function nextTimeInZone(hour:number,minute:number,dayOffset:number,timeZone:string,now=new Date(),rollIfPast=true):Date {
  if(!Number.isInteger(hour)||!Number.isInteger(minute)||!Number.isInteger(dayOffset)||hour<0||hour>23||minute<0||minute>59)throw new Error('Invalid time.');
  const today=localParts(now,timeZone);
  const day=new Date(Date.UTC(today.year,today.month-1,today.day+dayOffset));
  let result=localInstant({year:day.getUTCFullYear(),month:day.getUTCMonth()+1,day:day.getUTCDate(),hour,minute},timeZone);
  if(result<=now&&rollIfPast)result=nextTimeInZone(hour,minute,dayOffset+1,timeZone,now,false);
  return result;
}

export function localDateKey(date:Date,timeZone:string):string {
  const {year,month,day}=localParts(date,timeZone);
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
