export function validUnavailableDate(value:string):boolean {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}

// Presentation only. The API rechecks the saved preference under a lock.
export function taskDateAvailability(person:{timezone?:string;unavailable_dates?:string[]},dueAt:string|null):'available'|'unavailable'|'unknown' {
  if(!dueAt||!person.timezone||!Number.isFinite(new Date(dueAt).getTime()))return 'unknown';
  const dates=person.unavailable_dates??[];
  if(!Array.isArray(dates)||dates.length>60||dates.some(date=>typeof date!=='string'||!validUnavailableDate(date)))return 'unknown';
  try{
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:person.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(dueAt));
    const part=(name:string)=>parts.find(item=>item.type===name)?.value;
    return dates.includes(`${part('year')}-${part('month')}-${part('day')}`)?'unavailable':'available';
  }catch{return 'unknown';}
}
