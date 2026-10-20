// datetime-local omits the offset. Resolve it in the browser's timezone only
// when exactly one instant matches, rather than accepting Date's DST guessing.
export function deadlineInstant(value:string):string|null {
  if(!value)return null;
  const parts=value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if(!parts)throw new Error('Choose a complete local date and time.');
  const [,year,month,day,hour,minute]=parts.map(Number);
  const target=Date.UTC(year,month-1,day,hour,minute);
  const offsets=new Set([-48,-24,0,24,48].map(hours=>new Date(target+hours*3600_000).getTimezoneOffset()));
  const matches=[...offsets].map(offset=>new Date(target+offset*60000)).filter(date=>
    date.getFullYear()===year&&date.getMonth()===month-1&&date.getDate()===day&&date.getHours()===hour&&date.getMinutes()===minute);
  if(matches.length!==1)throw new Error('This local time is repeated or does not exist because clocks change. Choose another time.');
  return matches[0].toISOString();
}
