import { z } from 'zod';
import { localDateKey } from './time.js';

// These are task dates in the helper's declared timezone, not contact hours.
export const UnavailableDates=z.array(z.iso.date()).max(60).transform(dates=>[...new Set(dates)].sort());

export function taskDateAllowed(preferences:Record<string,unknown>,dueAt:unknown):boolean {
  const dates=UnavailableDates.safeParse(preferences.unavailable_dates??[]);
  if(!dates.success||typeof dueAt!=='string'&&!(dueAt instanceof Date))return false;
  const instant=new Date(dueAt);
  if(!Number.isFinite(instant.getTime()))return false;
  try{return !dates.data.includes(localDateKey(instant,String(preferences.timezone)));}
  catch{return false;}
}
